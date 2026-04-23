const studentId = window.STUDENT_ID;

let ws = null;
let stream = null;
let audioContext = null;
let processor = null;
let mediaSource = null;
let aiPlaying = false;
let callActive = false;
let transcript = [];
let playbackChain = Promise.resolve();
let lastAudioAt = 0;
let speechFallbackTimer = null;

const canvas = document.getElementById("avatar-canvas");
const ctx = canvas.getContext("2d");

function qs(selector) {
  return document.querySelector(selector);
}

function setConnection(message, live = false) {
  qs("#connection-state").textContent = message;
  qs("#recording-badge").textContent = live ? "Recording" : message;
}

function addTranscript(role, text) {
  const clean = (text || "").trim();
  if (!clean) return;
  transcript.push({ role, text: clean });
  qs("#video-transcript").innerHTML = transcript.map((item) => `
    <div class="chat-bubble ${item.role === "model" ? "assistant" : "user"}">
      <strong>${item.role === "model" ? "AI Interviewer" : "You"}</strong>
      <p>${item.text}</p>
    </div>
  `).join("");
  qs("#video-transcript").scrollTop = qs("#video-transcript").scrollHeight;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function downsampleBuffer(buffer, inputRate, outputRate) {
  if (outputRate === inputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = accum / Math.max(count, 1);
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPcm(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function pcm16ToAudioBuffer(arrayBuffer, sampleRate = 24000) {
  const view = new DataView(arrayBuffer);
  const length = Math.floor(arrayBuffer.byteLength / 2);
  const audioBuffer = audioContext.createBuffer(1, length, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    channel[i] = view.getInt16(i * 2, true) / 32768;
  }
  return audioBuffer;
}

function playAudioBuffer(audioBuffer) {
  return new Promise((resolve) => {
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      aiPlaying = false;
      resolve();
    };
    aiPlaying = true;
    source.start();
  });
}

async function playGeminiAudio(base64, mimeType = "audio/pcm") {
  lastAudioAt = Date.now();
  if (speechFallbackTimer) {
    clearTimeout(speechFallbackTimer);
    speechFallbackTimer = null;
  }
  const arrayBuffer = base64ToArrayBuffer(base64);
  playbackChain = playbackChain.then(async () => {
    try {
      let audioBuffer;
      if (mimeType.includes("pcm")) {
        const match = mimeType.match(/rate=(\d+)/);
        const rate = match ? Number(match[1]) : 24000;
        audioBuffer = pcm16ToAudioBuffer(arrayBuffer, rate);
      } else {
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      }
      await playAudioBuffer(audioBuffer);
    } catch (error) {
      qs("#video-feedback").innerHTML = `<div class="list-item">Could not play an AI audio chunk: ${error.message}</div>`;
    }
  });
}

function speakFallback(text) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.96;
  utterance.pitch = 0.92;
  utterance.onstart = () => {
    aiPlaying = true;
  };
  utterance.onend = () => {
    aiPlaying = false;
  };
  window.speechSynthesis.speak(utterance);
}

function scheduleSpeechFallback(text) {
  if (speechFallbackTimer) {
    clearTimeout(speechFallbackTimer);
  }
  speechFallbackTimer = setTimeout(() => {
    if (Date.now() - lastAudioAt > 900) {
      speakFallback(text);
    }
  }, 950);
}

function connectSocket(tone) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}/ws/students/${studentId}/interview/voice?tone=${encodeURIComponent(tone)}`);
  ws.onopen = () => {
    setConnection("Connected", true);
  };
  ws.onclose = () => {
    if (callActive) {
      setConnection("Disconnected", false);
    }
  };
  ws.onerror = () => {
    setConnection("Connection error", false);
  };
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "ready") {
      setConnection("Live session started", true);
    }
    if (data.type === "audio") {
      playGeminiAudio(data.data, data.mimeType);
    }
    if (data.type === "transcript") {
      addTranscript(data.role, data.text);
      if (data.role === "model") {
        scheduleSpeechFallback(data.text);
      }
    }
    if (data.type === "completed") {
      renderCompletion(data.result);
    }
    if (data.type === "error") {
      qs("#video-feedback").innerHTML = `<div class="list-item">${data.message}</div>`;
      setConnection("Needs attention", false);
    }
  };
}

function startPcmStreaming() {
  mediaSource = audioContext.createMediaStreamSource(stream);
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    if (!callActive || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, audioContext.sampleRate, 16000);
    const pcm = floatTo16BitPcm(downsampled);
    ws.send(JSON.stringify({ type: "pcm", data: arrayBufferToBase64(pcm) }));
  };
  mediaSource.connect(processor);
  processor.connect(audioContext.destination);
}

async function startCall() {
  try {
    qs("#start-call").disabled = true;
    setConnection("Requesting camera and microphone...");
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    qs("#student-video").srcObject = stream;
    audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    callActive = true;
    connectSocket(qs("#video-tone").value);
    startPcmStreaming();
    qs("#end-call").disabled = false;
    qs("#video-feedback").innerHTML = `<div class="list-item">Interview is live. Answer naturally; the AI interviewer will respond with voice.</div>`;
  } catch (error) {
    qs("#start-call").disabled = false;
    qs("#video-feedback").innerHTML = `<div class="list-item">Camera or microphone could not start: ${error.message}</div>`;
    setConnection("Permission needed");
  }
}

function stopLocalMedia() {
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (mediaSource) {
    mediaSource.disconnect();
    mediaSource = null;
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
}

function endCall() {
  callActive = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "end" }));
  }
  stopLocalMedia();
  qs("#end-call").disabled = true;
  qs("#start-call").disabled = false;
  setConnection("Finalizing scorecard");
}

function renderCompletion(result) {
  const session = result?.session || {};
  qs("#video-feedback").innerHTML = `
    <div class="list-item">
      <strong>Video interview completed</strong>
      <p>${result.latest_feedback || "Session complete."}</p>
      <p><strong>Overall score:</strong> ${session.overall_score || "--"}%</p>
      <p><strong>Report:</strong> ${session.report_summary || "Report generated from the voice transcript."}</p>
      <p><strong>Resources:</strong> ${(result.recommended_resources || []).join(" | ")}</p>
    </div>
  `;
  setConnection("Scorecard ready");
}

function animateAvatar() {
  requestAnimationFrame(animateAvatar);
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const time = performance.now() / 1000;
  const pulse = aiPlaying ? Math.sin(time * 18) * 0.5 + 0.5 : 0.15;

  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#121733");
  bg.addColorStop(1, "#070b18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.arc(cx, cy - 10, 92 + i * 26 + pulse * 8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(71, 215, 255, ${aiPlaying ? 0.14 / (i + 1) : 0.04})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const faceGradient = ctx.createRadialGradient(cx - 30, cy - 60, 20, cx, cy, 145);
  faceGradient.addColorStop(0, "#2f3b7a");
  faceGradient.addColorStop(1, "#151c3c");
  ctx.beginPath();
  ctx.roundRect(cx - 112, cy - 138, 224, 252, 88);
  ctx.fillStyle = faceGradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(124,108,255,.65)";
  ctx.lineWidth = 3;
  ctx.stroke();

  const eyeY = cy - 40;
  [cx - 42, cx + 42].forEach((ex) => {
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 17, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#47d7ff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + Math.sin(time) * 3, eyeY + 1, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f2f5ff";
    ctx.fill();
  });

  const mouthH = aiPlaying ? 8 + pulse * 24 : 4;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 42, 34, mouthH, 0, 0, Math.PI * 2);
  ctx.fillStyle = aiPlaying ? "#0a0d1a" : "#27305e";
  ctx.fill();
  ctx.strokeStyle = "#47d7ff";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#95a0c5";
  ctx.font = "600 18px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(aiPlaying ? "Speaking..." : "Listening", cx, H - 42);

  if (aiPlaying) {
    ctx.beginPath();
    ctx.arc(cx + 86, H - 48, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#34d399";
    ctx.fill();
  }
}

qs("#start-call").addEventListener("click", startCall);
qs("#end-call").addEventListener("click", endCall);
window.addEventListener("beforeunload", () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "end" }));
  }
  stopLocalMedia();
});

animateAvatar();
