const state = {
  students: [],
  ai: null,
  selectedStudentId: null,
  activeSessionId: null,
};

const voiceState = {
  ws: null,
  captureCtx: null,
  playCtx: null,
  processor: null,
  stream: null,
  nextPlayTime: 0,
};

function qs(selector) {
  return document.querySelector(selector);
}

function setStatus(message, isError = false) {
  const el = qs("#student-status");
  el.hidden = !message;
  el.className = `ai-banner ${isError ? "offline" : ""}`.trim();
  el.textContent = message || "";
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}

function setButtonLoading(button, loading, loadingText = "Working...") {
  if (!button) return;
  if (!button.dataset.defaultText) {
    button.dataset.defaultText = button.textContent;
  }
  button.disabled = loading;
  button.textContent = loading ? loadingText : button.dataset.defaultText;
}

function renderAiBanner(ai) {
  const el = qs("#ai-banner");
  el.className = `ai-banner ${ai.enabled ? "" : "offline"}`.trim();
  el.innerHTML = ai.enabled
    ? `Student intelligence is running in live AI mode with <strong>${ai.model}</strong>.`
    : `Student intelligence is in fallback mode. Add <code>GEMINI_API_KEY</code> to enable live AI coaching.`;
}

function voiceBrowserSupported() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    const test = new AC();
    const ok = typeof test.createScriptProcessor === "function";
    test.close();
    if (!ok) return false;
  } catch {
    return false;
  }
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

function updateVoiceInterviewVisibility() {
  const block = qs("#voice-interview-block");
  const fallback = qs("#voice-interview-fallback");
  const ui = qs("#voice-interview-ui");
  if (!block || !fallback || !ui) return;
  if (!state.ai || !state.ai.enabled) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  if (!voiceBrowserSupported()) {
    fallback.hidden = false;
    ui.hidden = true;
    fallback.textContent =
      "Voice interviews need WebSocket, the MediaRecorder API, AudioContext capture, and microphone access. Use the text mock interview below, or try a recent desktop browser.";
    return;
  }
  fallback.hidden = true;
  ui.hidden = false;
}

function resampleFloat32(input, inputRate, outputRate) {
  if (inputRate === outputRate) {
    return Float32Array.from(input);
  }
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio;
    const j = Math.floor(srcIndex);
    const f = srcIndex - j;
    const a = input[j] || 0;
    const b = input[j + 1] || a;
    out[i] = a + (b - a) * f;
  }
  return out;
}

function floatTo16BitPCM(input) {
  const buffer = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function appendVoiceTranscript(role, text) {
  const el = qs("#voice-transcript");
  if (!el) return;
  const line = document.createElement("p");
  const label = role === "user" ? "You" : "Interviewer";
  line.innerHTML = `<strong>${label}:</strong> ${text}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function scheduleVoicePlayback(b64, mimeType) {
  const ctx = voiceState.playCtx;
  if (!ctx) return;
  const rateMatch = /rate=(\d+)/.exec(mimeType || "");
  const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const sampleCount = Math.floor(raw.byteLength / 2);
  if (sampleCount === 0) return;
  const samples = new Int16Array(raw.buffer, raw.byteOffset, sampleCount);
  const floats = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    floats[i] = samples[i] / 32768;
  }
  const buffer = ctx.createBuffer(1, floats.length, sampleRate);
  buffer.copyToChannel(floats, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  const now = ctx.currentTime;
  if (voiceState.nextPlayTime < now) {
    voiceState.nextPlayTime = now;
  }
  src.start(voiceState.nextPlayTime);
  voiceState.nextPlayTime += buffer.duration;
}

function renderInterviewScorecard(result) {
  const session = result.session;
  return `
    <div class="list-item">
      <strong>Feedback <span class="badge ${result.ai_enabled ? "" : "offline"}">${result.source}</span></strong>
      <p>${result.latest_feedback}</p>
      <p><strong>Resources:</strong> ${result.recommended_resources.join(" | ")}</p>
      <p><strong>Current score:</strong> ${session.overall_score}%</p>
      <p><strong>Report:</strong> ${session.report_summary || "Interview report will grow as the session continues."}</p>
    </div>
  `;
}

function teardownVoiceInterview() {
  if (voiceState.processor) {
    try {
      voiceState.processor.disconnect();
    } catch {
      /* ignore */
    }
    voiceState.processor = null;
  }
  if (voiceState.stream) {
    voiceState.stream.getTracks().forEach((t) => t.stop());
    voiceState.stream = null;
  }
  if (voiceState.captureCtx) {
    voiceState.captureCtx.close().catch(() => {});
    voiceState.captureCtx = null;
  }
  if (voiceState.playCtx) {
    voiceState.playCtx.close().catch(() => {});
    voiceState.playCtx = null;
  }
  if (voiceState.ws) {
    const w = voiceState.ws;
    voiceState.ws = null;
    w.onclose = null;
    w.onmessage = null;
    w.onerror = null;
    if (w.readyState === WebSocket.OPEN) {
      w.close();
    }
  }
  voiceState.nextPlayTime = 0;
  const startBtn = qs("#voice-interview-start");
  const endBtn = qs("#voice-interview-end");
  if (startBtn) startBtn.disabled = false;
  if (endBtn) endBtn.disabled = true;
}

async function startPcmCapture(ws) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  voiceState.stream = stream;
  const captureCtx = new (window.AudioContext || window.webkitAudioContext)();
  voiceState.captureCtx = captureCtx;
  await captureCtx.resume();
  const source = captureCtx.createMediaStreamSource(stream);
  const processor = captureCtx.createScriptProcessor(4096, 1, 1);
  voiceState.processor = processor;
  processor.onaudioprocess = (e) => {
    if (!voiceState.ws || voiceState.ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    const down = resampleFloat32(input, captureCtx.sampleRate, 16000);
    const pcm = floatTo16BitPCM(down);
    const b64 = arrayBufferToBase64(pcm.buffer);
    voiceState.ws.send(JSON.stringify({ type: "pcm", data: b64 }));
  };
  const mute = captureCtx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(captureCtx.destination);
}

async function startVoiceInterview() {
  if (!state.selectedStudentId || !voiceBrowserSupported()) return;
  teardownVoiceInterview();
  const tone = qs("#voice-interview-tone").value;
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${wsProto}//${location.host}/ws/students/${state.selectedStudentId}/interview/voice?tone=${encodeURIComponent(tone)}`;
  const ws = new WebSocket(url);
  voiceState.ws = ws;
  qs("#voice-transcript").innerHTML = "";
  voiceState.nextPlayTime = 0;
  voiceState.playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "ready") {
      await voiceState.playCtx.resume();
      await startPcmCapture(ws);
      qs("#voice-interview-start").disabled = true;
      qs("#voice-interview-end").disabled = false;
      setStatus("Voice interview connected. Speak when the interviewer prompts you.");
    }
    if (msg.type === "audio") {
      scheduleVoicePlayback(msg.data, msg.mimeType);
    }
    if (msg.type === "transcript") {
      appendVoiceTranscript(msg.role, msg.text);
    }
    if (msg.type === "error") {
      setStatus(msg.message, true);
      teardownVoiceInterview();
    }
    if (msg.type === "completed") {
      teardownVoiceInterview();
      qs("#interview-feedback").innerHTML = renderInterviewScorecard(msg.result);
      await refreshStudent();
      setStatus("Voice interview scored and saved.");
    }
  };
  ws.onerror = () => {
    setStatus("Voice WebSocket error.", true);
  };
  ws.onclose = () => {
    teardownVoiceInterview();
  };
}

function stopVoiceInterview() {
  if (voiceState.ws && voiceState.ws.readyState === WebSocket.OPEN) {
    voiceState.ws.send(JSON.stringify({ type: "end" }));
  }
}

function renderStudentList() {
  qs("#student-list").innerHTML = state.students.map((student) => `
    <button class="student-chip ${student.id === state.selectedStudentId ? "active" : ""}" data-student-id="${student.id}">
      <div><strong>${student.name}</strong></div>
      <div class="muted">${student.branch} | ${student.readiness_score}% ready</div>
    </button>
  `).join("");

  document.querySelectorAll("[data-student-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStudentId = button.dataset.studentId;
      state.activeSessionId = null;
      renderStudentList();
      renderSelectedStudent();
    });
  });
}

function renderStudentMode() {
  const hasStudents = state.students.length > 0;
  qs("#student-empty-state").hidden = hasStudents;
  qs("#student-dashboard").hidden = !hasStudents;
  if (!hasStudents) {
    qs("#student-create-inline").hidden = true;
  }
}

function renderMetrics(student) {
  qs("#student-metrics").innerHTML = [
    ["Resume", `${student.resume_score}%`],
    ["Interview", `${student.interview_score}%`],
    ["Confidence", `${student.confidence_score}%`],
    ["Alerts", student.alerts_count],
  ].map(([label, value]) => `
    <div class="list-item">
      <div class="panel-title">${label}</div>
      <h3>${value}</h3>
    </div>
  `).join("");
}

function renderPlan(student) {
  qs("#weekly-plan").innerHTML = student.weekly_plan.map((week) => `
    <div class="plan-card">
      <strong>Week ${week.week}: ${week.focus}</strong>
      <p>${week.tasks.join(" | ")}</p>
    </div>
  `).join("");
}

function renderMatches(student) {
  qs("#matches").innerHTML = student.matches.map((match) => `
    <div class="match-card">
      <strong>${match.company}</strong>
      <div>${match.role} | ${match.score}% fit</div>
      <p>${match.reason}</p>
      <p><strong>Missing:</strong> ${(match.missing_skills || []).join(", ") || "No major blockers identified"}</p>
    </div>
  `).join("");
}

function renderSelectedStudent() {
  const student = state.students.find((item) => item.id === state.selectedStudentId) || state.students[0];
  if (!student) return;

  state.selectedStudentId = student.id;
  qs("#student-name").textContent = student.name;
  qs("#student-summary").textContent = student.summary;
  qs("#student-readiness").textContent = student.readiness_score;
  qs("#resume-output").innerHTML = `
    <div class="list-item">
      <strong>${student.recent_resume_name || "No resume yet"}</strong>
      <p>${student.parsed_resume_excerpt || "Upload a resume to trigger Scout, Matcher, and Planner."}</p>
    </div>
    <div class="list-item">
      <strong>Skills</strong>
      <p>${student.skills.join(" | ")}</p>
    </div>
    <div class="list-item">
      <strong>Skill Gaps</strong>
      <p>${student.skill_gaps.join(" | ")}</p>
    </div>
  `;
  qs("#student-insights").innerHTML = `
    <div class="list-item">
      <strong>Strengths</strong>
      <p>${(student.strengths || []).join(" | ") || "Upload a resume to extract strengths."}</p>
    </div>
    <div class="list-item">
      <strong>Improvement Priorities</strong>
      <p>${(student.improvement_priorities || []).join(" | ") || "No priorities available yet."}</p>
    </div>
  `;
  renderMetrics(student);
  renderPlan(student);
  renderMatches(student);
  renderTasks(student);
  loadProgress(student.id);
  loadChatHistory(student.id);
  updateVoiceInterviewVisibility();
}

function renderTasks(student) {
  qs("#task-list").innerHTML = (student.tasks || []).map((task) => `
    <div class="list-item">
      <strong>${task.title}</strong>
      <p>${task.description}</p>
      <p><strong>Due:</strong> ${task.due_date} | <strong>Status:</strong> ${task.status}</p>
      <div class="cta-row">
        <button class="btn btn-secondary btn-small task-status" data-task-id="${task.id}" data-status="done">Mark Done</button>
        <button class="btn btn-secondary btn-small task-status" data-task-id="${task.id}" data-status="missed">Mark Missed</button>
      </div>
    </div>
  `).join("") || `<div class="list-item">No tasks yet.</div>`;
  document.querySelectorAll(".task-status").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const formData = new FormData();
        formData.append("student_id", state.selectedStudentId);
        formData.append("status", button.dataset.status);
        await apiFetch(`/api/tasks/${button.dataset.taskId}`, { method: "PATCH", body: formData });
        await refreshStudent();
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
}

function renderSparkline(scores) {
  if (!scores.length) return "";
  const max = Math.max(...scores, 1);
  const min = Math.min(...scores, 0);
  const range = Math.max(max - min, 1);
  const points = scores.map((score, index) => {
    const x = (index / Math.max(scores.length - 1, 1)) * 118 + 1;
    const y = 34 - ((score - min) / range) * 28;
    return `${x},${y}`;
  }).join(" ");
  return `<svg viewBox="0 0 120 36" class="trend-line" aria-label="Interview score trend"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${points}" /></svg>`;
}

async function loadProgress(studentId) {
  const response = await apiFetch(`/api/progress/${studentId}`);
  const progress = await response.json();
  const scores = progress.interview_scores || [];
  qs("#progress-panel").innerHTML = `
    <div class="list-item">
      <strong>Progress Snapshot</strong>
      <p>Completion rate: ${progress.completion_rate}% | Percentile rank: ${progress.percentile_rank}%</p>
      <p>Completed tasks: ${progress.completed_tasks}/${progress.total_tasks}</p>
      <p>Interview trend: ${scores.length ? scores.join(" -> ") : "No interviews yet"}</p>
      ${renderSparkline(scores)}
    </div>
  `;
}

async function loadChatHistory(studentId) {
  const response = await apiFetch(`/api/chat/history/${studentId}`);
  const history = await response.json();
  qs("#chat-history").innerHTML = history.map((msg) => `
    <p><strong>${msg.role === "assistant" ? "Mentor" : "You"}:</strong> ${msg.content}</p>
  `).join("") || "No chat yet. Ask the mentor something.";
}

async function refreshStudent() {
  if (!state.selectedStudentId) return;
  const response = await apiFetch(`/api/students/${state.selectedStudentId}`);
  const student = await response.json();
  state.students = state.students.map((item) => item.id === student.id ? student : item);
  renderStudentList();
  renderSelectedStudent();
}

async function refreshBootstrap() {
  const response = await apiFetch("/api/bootstrap");
  const data = await response.json();
  state.ai = data.ai;
  state.students = data.students;
  state.selectedStudentId = state.selectedStudentId || data.featured_student_id;
  renderAiBanner(data.ai);
  updateVoiceInterviewVisibility();
  renderStudentMode();
  if (!state.students.length) {
    return;
  }
  renderStudentList();
  renderSelectedStudent();
}

async function handleStudentCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  try {
    setStatus("Creating student profile and running agents...");
    setButtonLoading(submitButton, true, "Creating...");
    const response = await apiFetch("/api/students", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    state.students = [result.student, ...state.students];
    state.selectedStudentId = result.student.id;
    renderStudentMode();
    renderStudentList();
    renderSelectedStudent();
    form.reset();
    const inlinePanel = qs("#student-create-inline");
    if (inlinePanel) {
      inlinePanel.hidden = true;
    }
    setStatus("Student created and analysis completed.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function handleResumeUpload(event) {
  event.preventDefault();
  const fileInput = qs("#resume-file");
  const file = fileInput.files[0];
  if (!file || !state.selectedStudentId) return;

  const formData = new FormData();
  formData.append("file", file);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');

  try {
    setStatus("Uploading resume and refreshing insights...");
    setButtonLoading(submitButton, true, "Analyzing...");
    const response = await apiFetch(`/api/students/${state.selectedStudentId}/resume`, {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    state.students = state.students.map((student) => student.id === result.student.id ? result.student : student);
    renderStudentList();
    renderSelectedStudent();
    setStatus(`Resume analyzed via ${result.source}.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function handleInterviewStart(event) {
  event.preventDefault();
  if (!state.selectedStudentId) return;
  const formData = new FormData();
  formData.append("tone", qs("#interview-tone").value);

  try {
    const response = await apiFetch(`/api/students/${state.selectedStudentId}/interview/start`, {
      method: "POST",
      body: formData,
    });
    const session = await response.json();
    state.activeSessionId = session.id;
    qs("#interview-question").textContent = session.current_question;
    qs("#interview-feedback").innerHTML = `<div class="list-item">Interview session started in ${session.tone} mode.</div>`;
    setStatus("Interview started.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleInterviewReply(event) {
  event.preventDefault();
  if (!state.selectedStudentId || !state.activeSessionId) return;
  const answer = qs("#interview-answer").value.trim();
  if (!answer) return;

  const formData = new FormData();
  formData.append("answer", answer);

  try {
    const response = await apiFetch(`/api/students/${state.selectedStudentId}/interview/${state.activeSessionId}/reply`, {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    qs("#interview-answer").value = "";
    qs("#interview-question").textContent = result.next_question || "Interview completed. Start a new session anytime.";
    qs("#interview-feedback").innerHTML = renderInterviewScorecard(result);
    await refreshStudent();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleChat(event) {
  event.preventDefault();
  if (!state.selectedStudentId) return;
  const message = qs("#chat-message").value.trim();
  if (!message) return;
  const formData = new FormData();
  formData.append("student_id", state.selectedStudentId);
  formData.append("message", message);
  try {
    const response = await apiFetch("/api/chat", { method: "POST", body: formData });
    const result = await response.json();
    qs("#chat-message").value = "";
    qs("#chat-history").innerHTML = result.history.map((msg) => `
      <p><strong>${msg.role === "assistant" ? "Mentor" : "You"}:</strong> ${msg.content}</p>
    `).join("");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function bindForms() {
  qs("#student-create-form").addEventListener("submit", handleStudentCreate);
  qs("#student-create-inline-form").addEventListener("submit", handleStudentCreate);
  qs("#resume-form").addEventListener("submit", handleResumeUpload);
  qs("#chat-form").addEventListener("submit", handleChat);
  qs("#start-interview-form").addEventListener("submit", handleInterviewStart);
  qs("#interview-reply-form").addEventListener("submit", handleInterviewReply);
  const voiceStart = qs("#voice-interview-start");
  const voiceEnd = qs("#voice-interview-end");
  if (voiceStart) voiceStart.addEventListener("click", () => startVoiceInterview().catch((e) => setStatus(e.message, true)));
  if (voiceEnd) voiceEnd.addEventListener("click", stopVoiceInterview);
  qs("#show-add-student").addEventListener("click", () => {
    qs("#student-create-inline").hidden = false;
  });
  qs("#cancel-add-student").addEventListener("click", () => {
    qs("#student-create-inline").hidden = true;
    qs("#student-create-inline-form").reset();
  });
}

bindForms();
refreshBootstrap().catch((error) => setStatus(error.message, true));
