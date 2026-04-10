from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

import httpx

from app.config import settings


@dataclass
class AIResult:
    payload: dict[str, Any]
    ai_enabled: bool
    source: str


class StructuredLLM:
    def __init__(self) -> None:
        self.enabled = settings.ai_enabled
        self.model = settings.gemini_model
        self.api_key = settings.gemini_api_key
        self.base_url = "https://generativelanguage.googleapis.com/v1beta/models"

    async def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        fallback: Callable[[], dict[str, Any]],
    ) -> AIResult:
        if not self.enabled or not self.api_key:
            return AIResult(payload=fallback(), ai_enabled=False, source="fallback")

        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    f"{self.base_url}/{self.model}:generateContent",
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": self.api_key,
                    },
                    json={
                        "contents": [
                            {
                                "role": "user",
                                "parts": [
                                    {
                                        "text": (
                                            f"{system_prompt}\n\n"
                                            f"{user_prompt}\n\n"
                                            "Return only valid JSON. Do not wrap it in markdown fences."
                                        )
                                    }
                                ],
                            }
                        ],
                        "generationConfig": {
                            "temperature": 0.2,
                            "responseMimeType": "application/json",
                        },
                    },
                )
            response.raise_for_status()
            data = response.json()
            content = data["candidates"][0]["content"]["parts"][0]["text"]
            return AIResult(payload=json.loads(content), ai_enabled=True, source=self.model)
        except Exception:
            return AIResult(payload=fallback(), ai_enabled=False, source="fallback")
