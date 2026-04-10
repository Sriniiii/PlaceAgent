from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import quote

import websockets
from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.services import PlaceAgentStore


def _gemini_ws_url() -> str:
    key = settings.resolved_gemini_live_api_key
    return f"{settings.gemini_live_websocket_url}?key={quote(key, safe='')}"


def _merge_transcript_line(transcript: list[dict], role: str, text: str) -> None:
    cleaned = (text or "").strip()
    if not cleaned:
        return
    r = "user" if role == "user" else "model"
    if transcript and transcript[-1].get("role") == r:
        transcript[-1]["text"] = (transcript[-1].get("text", "") + " " + cleaned).strip()
    else:
        transcript.append({"role": r, "text": cleaned})


def _extract_gemini_transcripts(data: dict, transcript: list[dict]) -> None:
    server = data.get("serverContent") or data.get("server_content")
    if not isinstance(server, dict):
        return
    it = server.get("inputTranscription") or server.get("input_transcription")
    if isinstance(it, dict):
        t = it.get("text") or it.get("transcript") or ""
        _merge_transcript_line(transcript, "user", str(t))
    ot = server.get("outputTranscription") or server.get("output_transcription")
    if isinstance(ot, dict):
        t = ot.get("text") or ot.get("transcript") or ""
        _merge_transcript_line(transcript, "model", str(t))


def _walk_inline_audio(obj: Any, out: list[tuple[str, str]]) -> None:
    if isinstance(obj, dict):
        inline = obj.get("inlineData") or obj.get("inline_data")
        if isinstance(inline, dict):
            mime = str(inline.get("mimeType") or inline.get("mime_type") or "audio/pcm")
            b64 = inline.get("data") or ""
            if b64:
                out.append((mime, str(b64)))
        for v in obj.values():
            _walk_inline_audio(v, out)
    elif isinstance(obj, list):
        for item in obj:
            _walk_inline_audio(item, out)


def _inline_audio_parts(data: dict) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    _walk_inline_audio(data, found)
    return found


async def run_voice_interview_session(websocket: WebSocket, store: PlaceAgentStore, student_id: str, tone: str) -> None:
    await websocket.accept()
    try:
        store.get_student(student_id)
    except KeyError:
        await websocket.send_json({"type": "error", "message": "Student not found"})
        await websocket.close(code=1008)
        return
    if not settings.voice_enabled:
        await websocket.send_json(
            {"type": "error", "message": "Voice interview requires GEMINI_API_KEY (or GEMINI_LIVE_API_KEY) to be set."}
        )
        await websocket.close(code=1008)
        return

    voice = store.create_voice_session(student_id)
    transcript: list[dict] = []
    finalized = False
    try:
        uri = _gemini_ws_url()
        system_text = (
            "You are a concise campus placement interviewer conducting a voice mock interview. "
            "Ask one focused question at a time, listen to the candidate's spoken answer, then give brief feedback. "
            f"Interview tone: {tone}. Prefer short spoken replies."
        )
        config_message = {
            "config": {
                "model": f"models/{settings.gemini_live_model}",
                "responseModalities": ["AUDIO"],
                "systemInstruction": {"parts": [{"text": system_text}]},
            }
        }

        async with websockets.connect(uri, max_size=None) as gemini_ws:
            await gemini_ws.send(json.dumps(config_message))
            await websocket.send_json({"type": "ready", "voice_session_id": voice.id})

            async def pump_gemini() -> None:
                async for raw in gemini_ws:
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    _extract_gemini_transcripts(data, transcript)
                    store.update_voice_transcript(voice.id, transcript)
                    err = data.get("error")
                    if err:
                        await websocket.send_json({"type": "error", "message": str(err)})
                    for mime, b64 in _inline_audio_parts(data):
                        await websocket.send_json({"type": "audio", "mimeType": mime, "data": b64})
                    server = data.get("serverContent") or data.get("server_content")
                    if isinstance(server, dict):
                        it = server.get("inputTranscription") or server.get("input_transcription")
                        if isinstance(it, dict):
                            tx = (it.get("text") or it.get("transcript") or "").strip()
                            if tx:
                                await websocket.send_json({"type": "transcript", "role": "user", "text": tx})
                        ot = server.get("outputTranscription") or server.get("output_transcription")
                        if isinstance(ot, dict):
                            tx = (ot.get("text") or ot.get("transcript") or "").strip()
                            if tx:
                                await websocket.send_json({"type": "transcript", "role": "model", "text": tx})

            async def pump_client() -> None:
                try:
                    while True:
                        raw = await websocket.receive_text()
                        payload = json.loads(raw)
                        if payload.get("type") == "end":
                            return
                        if payload.get("type") != "pcm":
                            continue
                        b64 = payload.get("data") or payload.get("pcm")
                        if not b64:
                            continue
                        out = {
                            "realtimeInput": {
                                "audio": {
                                    "data": b64,
                                    "mimeType": "audio/pcm;rate=16000",
                                }
                            }
                        }
                        await gemini_ws.send(json.dumps(out))
                except WebSocketDisconnect:
                    return

            pump_task = asyncio.create_task(pump_gemini())
            try:
                await pump_client()
            finally:
                pump_task.cancel()
                try:
                    await pump_task
                except asyncio.CancelledError:
                    pass

        result = await store.finalize_voice_interview(student_id, voice.id, transcript, tone)
        finalized = True
        try:
            await websocket.send_json({"type": "completed", "result": result.model_dump(mode="json")})
        except Exception:
            pass
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if not finalized and voice.id in store.voice_sessions:
            store.voice_sessions.pop(voice.id, None)
