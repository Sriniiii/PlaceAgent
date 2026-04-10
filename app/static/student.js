const state = {
  students: [],
  ai: null,
  selectedStudentId: null,
  activeSessionId: null,
  interviewMode: "text",
  voiceSupported: false,
  voiceListening: false,
  finalTranscript: "",
  recognition: null,
  micStream: null,
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

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setVoiceStatus(message, isError = false) {
  const el = qs("#voice-status");
  el.hidden = false;
  el.className = `feedback-box ${isError ? "voice-error" : ""}`.trim();
  el.textContent = message;
}

function renderVoiceTranscript(text) {
  const el = qs("#voice-transcript");
  el.hidden = false;
  el.textContent = text || "No transcript yet.";
}

function stopVoiceRecognition() {
  if (state.recognition && state.voiceListening) {
    state.recognition.stop();
  }
  state.voiceListening = false;
  const button = qs("#voice-toggle");
  if (button) {
    button.textContent = "Start Listening";
  }
}

function showMicModal(message) {
  const modal = qs("#mic-modal");
  const messageEl = qs("#mic-modal-message");
  if (!modal || !messageEl) return;
  messageEl.textContent = message;
  modal.hidden = false;
}

function hideMicModal() {
  const modal = qs("#mic-modal");
  if (modal) {
    modal.hidden = true;
  }
}

function stopMicStream() {
  if (state.micStream) {
    state.micStream.getTracks().forEach((track) => track.stop());
    state.micStream = null;
  }
}

function speakText(text) {
  if (!("speechSynthesis" in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onstart = () => {
    setVoiceStatus("Reading the question aloud...");
  };
  utterance.onerror = () => {
    setVoiceStatus("Audio playback was blocked. Use Replay Question again and allow audio if the browser prompts.", true);
  };
  window.speechSynthesis.speak(utterance);
}

function updateInterviewModeUi() {
  const isVoice = state.interviewMode === "voice";
  qs("#voice-controls").hidden = !isVoice;
  qs("#voice-status").hidden = !isVoice;
  qs("#voice-transcript").hidden = !isVoice;
  qs("#interview-answer").placeholder = isVoice
    ? "Voice transcript will appear here. You can still edit before sending."
    : "Answer the interview question here...";
  if (!isVoice) {
    stopVoiceRecognition();
  }
}

function initialiseVoiceRecognition() {
  const Recognition = getSpeechRecognition();
  state.voiceSupported = Boolean(Recognition);
  if (!Recognition) {
    setVoiceStatus("Voice mode is not supported in this browser. Use Chrome or Edge for microphone input.", true);
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "en-IN";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onstart = () => {
    state.voiceListening = true;
    qs("#voice-toggle").textContent = "Stop Listening";
    setVoiceStatus("Listening to your answer...");
  };
  recognition.onend = () => {
    state.voiceListening = false;
    qs("#voice-toggle").textContent = "Start Listening";
    setVoiceStatus("Microphone stopped. Review the transcript or submit it.");
  };
  recognition.onerror = (event) => {
    state.voiceListening = false;
    qs("#voice-toggle").textContent = "Start Listening";
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      showMicModal("Microphone access is blocked right now. Click Enable Microphone, then allow access in the browser prompt.");
      setVoiceStatus("Microphone access is blocked. Open the popup and allow access to continue.", true);
      return;
    }
    if (event.error === "audio-capture") {
      showMicModal("No microphone was detected. Connect a mic or choose the correct input device, then try again.");
      setVoiceStatus("No microphone was detected for voice input.", true);
      return;
    }
    setVoiceStatus(`Voice input error: ${event.error}`, true);
  };
  recognition.onresult = (event) => {
    let finalText = state.finalTranscript;
    let interimText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) {
        finalText += `${transcript} `;
      } else {
        interimText += transcript;
      }
    }
    state.finalTranscript = finalText.trim();
    const combined = `${state.finalTranscript} ${interimText}`.trim();
    qs("#interview-answer").value = combined;
    renderVoiceTranscript(combined);
  };
  state.recognition = recognition;
  setVoiceStatus("Voice mode is ready. Start an interview and then use the microphone controls.");
}

async function getMicrophonePermissionState() {
  if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
    return "prompt";
  }
  try {
    const result = await navigator.permissions.query({ name: "microphone" });
    return result.state;
  } catch {
    return "prompt";
  }
}

async function promptForMicrophoneAccess() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("Microphone access is not supported in this browser.");
  }
  stopMicStream();
  state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  setVoiceStatus("Microphone access enabled. You can start speaking now.");
  hideMicModal();
}

async function startVoiceListening() {
  if (!state.voiceSupported || !state.recognition) {
    setVoiceStatus("Voice input is not available in this browser.", true);
    return;
  }
  if (!state.activeSessionId) {
    setVoiceStatus("Start an interview session before using voice mode.", true);
    return;
  }
  if (state.voiceListening) {
    stopVoiceRecognition();
    return;
  }
  const permissionState = await getMicrophonePermissionState();
  if (permissionState === "denied") {
    showMicModal("Microphone access was blocked earlier. Use the browser lock icon to allow the microphone, then click Enable Microphone.");
    setVoiceStatus("Microphone access is blocked. Open the popup and allow it in browser settings.", true);
    return;
  }
  try {
    state.finalTranscript = qs("#interview-answer").value.trim();
    state.recognition.start();
  } catch {
    showMicModal("We could not start voice capture yet. Click Enable Microphone, allow the browser prompt, and try again.");
    setVoiceStatus("Voice capture could not start. Open the popup and allow microphone access.", true);
  }
}

function renderAiBanner(ai) {
  const el = qs("#ai-banner");
  el.className = `ai-banner ${ai.enabled ? "" : "offline"}`.trim();
  el.innerHTML = ai.enabled
    ? `Student intelligence is running in live AI mode with <strong>${ai.model}</strong>.`
    : `Student intelligence is in fallback mode. Add <code>GEMINI_API_KEY</code> to enable live AI coaching.`;
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
  updateInterviewModeUi();
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
  state.interviewMode = qs("#interview-mode").value;
  state.finalTranscript = "";
  renderVoiceTranscript("");
  updateInterviewModeUi();

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
    if (state.interviewMode === "voice") {
      showMicModal("Voice interview is ready. Click Enable Microphone first, allow the browser prompt, then use Start Listening to answer.");
      speakText(session.current_question);
      setVoiceStatus("Voice interview started. Enable the microphone in the popup, then answer with Start Listening.");
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleInterviewReply(event) {
  if (event) {
    event.preventDefault();
  }
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
    state.finalTranscript = "";
    renderVoiceTranscript("");
    qs("#interview-question").textContent = result.next_question || "Interview completed. Start a new session anytime.";
    qs("#interview-feedback").innerHTML = `
      <div class="list-item">
        <strong>Feedback <span class="badge ${result.ai_enabled ? "" : "offline"}">${result.source}</span></strong>
        <p>${result.latest_feedback}</p>
        <p><strong>Resources:</strong> ${result.recommended_resources.join(" | ")}</p>
        <p><strong>Current score:</strong> ${result.session.overall_score}%</p>
        <p><strong>Report:</strong> ${result.session.report_summary || "Interview report will grow as the session continues."}</p>
      </div>
    `;
    await refreshStudent();
    if (state.interviewMode === "voice" && result.next_question) {
      speakText(result.next_question);
      setVoiceStatus("Next question is ready. Start listening when you want to answer.");
    }
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
  qs("#interview-mode").addEventListener("change", (event) => {
    state.interviewMode = event.target.value;
    updateInterviewModeUi();
  });
  qs("#voice-toggle").addEventListener("click", () => {
    startVoiceListening().catch((error) => setVoiceStatus(error.message, true));
  });
  qs("#voice-submit").addEventListener("click", async () => {
    if (!qs("#interview-answer").value.trim()) {
      setVoiceStatus("Record or type an answer before submitting.", true);
      return;
    }
    stopVoiceRecognition();
    await handleInterviewReply();
  });
  qs("#voice-replay").addEventListener("click", () => {
    speakText(qs("#interview-question").textContent);
  });
  qs("#mic-modal-confirm").addEventListener("click", async () => {
    try {
      await promptForMicrophoneAccess();
      speakText(qs("#interview-question").textContent);
    } catch (error) {
      setVoiceStatus("Microphone access is still blocked. Allow it in the browser prompt or site settings.", true);
      showMicModal("Microphone access is still blocked. Click the lock icon in the address bar, allow the microphone, then try Enable Microphone again.");
    }
  });
  qs("#mic-modal-close").addEventListener("click", hideMicModal);
  document.querySelectorAll("[data-mic-close]").forEach((element) => {
    element.addEventListener("click", hideMicModal);
  });
  qs("#show-add-student").addEventListener("click", () => {
    qs("#student-create-inline").hidden = false;
  });
  qs("#cancel-add-student").addEventListener("click", () => {
    qs("#student-create-inline").hidden = true;
    qs("#student-create-inline-form").reset();
  });
}

initialiseVoiceRecognition();
bindForms();
refreshBootstrap().catch((error) => setStatus(error.message, true));
