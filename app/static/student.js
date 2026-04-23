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

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function setText(selector, value) {
  const el = qs(selector);
  if (el) el.textContent = value;
}

function setHtml(selector, value) {
  const el = qs(selector);
  if (el) el.innerHTML = value;
}

function setStatus(message, isError = false) {
  const el = qs("#student-status");
  if (!el) return;
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
  if (!el) return;
  el.hidden = false;
  el.className = `feedback-box ${isError ? "voice-error" : ""}`.trim();
  el.textContent = message;
}

function renderVoiceTranscript(text) {
  const el = qs("#voice-transcript");
  if (!el) return;
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
  const voiceControls = qs("#voice-controls");
  const voiceStatus = qs("#voice-status");
  const voiceTranscript = qs("#voice-transcript");
  const answer = qs("#interview-answer");
  if (voiceControls) voiceControls.hidden = !isVoice;
  if (voiceStatus) voiceStatus.hidden = !isVoice;
  if (voiceTranscript) voiceTranscript.hidden = !isVoice;
  if (answer) {
    answer.placeholder = isVoice
      ? "Voice transcript will appear here. You can still edit before sending."
      : "Answer the interview question here...";
  }
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
    setText("#voice-toggle", "Stop Listening");
    setVoiceStatus("Listening to your answer...");
  };
  recognition.onend = () => {
    state.voiceListening = false;
    setText("#voice-toggle", "Start Listening");
    setVoiceStatus("Microphone stopped. Review the transcript or submit it.");
  };
  recognition.onerror = (event) => {
    state.voiceListening = false;
    setText("#voice-toggle", "Start Listening");
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
    const answer = qs("#interview-answer");
    if (answer) answer.value = combined;
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
    state.finalTranscript = qs("#interview-answer")?.value.trim() || "";
    state.recognition.start();
  } catch {
    showMicModal("We could not start voice capture yet. Click Enable Microphone, allow the browser prompt, and try again.");
    setVoiceStatus("Voice capture could not start. Open the popup and allow microphone access.", true);
  }
}

function renderAiBanner(ai) {
  const el = qs("#ai-banner");
  if (!el) return;
  el.className = `ai-banner ${ai.enabled ? "" : "offline"}`.trim();
  el.innerHTML = ai.enabled
    ? `Student intelligence is running in live AI mode with <strong>${ai.model}</strong>.`
    : `Student intelligence is in fallback mode. Add <code>GEMINI_API_KEY</code> to enable live AI coaching.`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getReadinessHeadline(score) {
  if (score >= 80) return "You're in strong shortlist territory";
  if (score >= 65) return "You're building solid placement momentum";
  if (score >= 50) return "You're close, but a few gaps still matter";
  return "You need a focused prep push this week";
}

function getReadinessSummary(student) {
  const priorities = student.improvement_priorities?.slice(0, 2) || [];
  const gaps = student.skill_gaps?.slice(0, 2) || [];
  const focus = priorities.length ? priorities.join(" and ") : gaps.join(" and ");
  return focus
    ? `Your strongest next move is to improve ${focus}. Resume quality, mock interviews, and task completion are all feeding this score.`
    : "Your resume, interview loop, and planning signals are all being tracked from one workspace.";
}

function renderFeatureCards(student) {
  const cards = [
    ["resume-section", "Resume Hub", "ScoutAgent parsing, strengths, and skill gaps in one place.", student.recent_resume_name ? "Resume parsed" : "Upload resume", "amber", "RS"],
    ["roadmap-section", "Preparation Roadmap", "A focused weekly plan built around the gaps blocking your best-fit roles.", `${student.weekly_plan.length || 0} roadmap blocks`, "blue", "RM"],
    ["matches-section", "Role Matches", "See the companies and roles where your current profile has the best chance.", `${student.matches.length || 0} role matches`, "cyan", "MT"],
    ["mentor-section", "AI Mentor", "Ask for interview prep, role strategy, project framing, or company-specific guidance.", "Live mentor chat", "violet", "AI"],
    ["tasks-section", "Task Tracker", "Track execution daily so readiness improves through visible progress.", `${(student.tasks || []).filter((task) => task.status === "done").length} tasks done`, "rose", "TK"],
    ["interview-section", "Mock Interview", "Start text or voice practice and get live feedback after every answer.", `${student.interview_score}% interview score`, "amber", "IV"],
  ];
  setHtml("#student-feature-cards", cards.map(([target, title, copy, tag, accent, icon]) => `
    <a class="student-feature-card" href="#${target}" data-accent="${accent}">
      <div class="student-feature-icon">${icon}</div>
      <div>
        <h3>${title}</h3>
        <p>${copy}</p>
      </div>
      <div class="student-feature-footer">
        <span class="student-feature-tag">${tag}</span>
      <span class="student-feature-arrow">&gt;</span>
      </div>
    </a>
  `).join(""));
}

function renderQuickTasks(student) {
  const tasks = (student.tasks || []).slice(0, 4);
  setHtml("#student-quick-tasks", tasks.map((task) => `
    <div class="student-task-item ${task.status === "done" ? "done" : ""}">
      <span class="student-task-bullet"></span>
      <div class="student-task-copy">
        <strong>${task.title}</strong>
        <p>${task.description}</p>
      </div>
      <span class="student-task-meta">${task.status === "done" ? "Done" : task.due_date}</span>
    </div>
  `).join("") || `<div class="list-item">No tasks yet. The planner will surface your next actions here.</div>`);
}

function renderAlerts(student) {
  const alerts = [
    ...(student.skill_gaps || []).slice(0, 2).map((gap) => ({
      level: "high",
      title: `${gap} needs attention`,
      detail: "This gap is likely reducing shortlist confidence for your best-fit roles.",
    })),
    ...(student.improvement_priorities || []).slice(0, 1).map((item) => ({
      level: "medium",
      title: "Priority focus",
      detail: item,
    })),
    ...(student.matches || []).slice(0, 1).map((match) => ({
      level: "low",
      title: `${match.company} looks promising`,
      detail: `${match.role} is currently a ${match.score}% fit.`,
    })),
  ].slice(0, 4);

  setHtml("#student-alerts", alerts.map((alert) => `
    <div class="student-alert-item" data-level="${alert.level}">
      <span class="student-alert-marker"></span>
      <div>
        <strong>${alert.title}</strong>
        <p>${alert.detail}</p>
      </div>
    </div>
  `).join("") || `<div class="list-item">No urgent signals right now. Keep the momentum going.</div>`);
}

function openResumeModal() {
  const modal = qs("#resume-modal");
  if (modal) {
    modal.hidden = false;
  }
}

function closeResumeModal() {
  const modal = qs("#resume-modal");
  if (modal) {
    modal.hidden = true;
  }
}

function renderStudentList() {
  setHtml("#student-list", state.students.map((student) => `
    <button class="student-chip ${student.id === state.selectedStudentId ? "active" : ""}" data-student-id="${student.id}">
      <div><strong>${student.name}</strong></div>
      <div class="muted">${student.branch} | ${student.readiness_score}% ready</div>
    </button>
  `).join(""));

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
  const empty = qs("#student-empty-state");
  const dashboard = qs("#student-dashboard");
  if (empty) empty.hidden = hasStudents;
  if (dashboard) dashboard.hidden = !hasStudents;
  if (!hasStudents) {
    const inline = qs("#student-create-inline");
    if (inline) inline.hidden = true;
  }
}

function renderMetrics(student) {
  setHtml("#student-metrics", [
    ["Resume", `${student.resume_score}%`],
    ["Interview", `${student.interview_score}%`],
    ["Confidence", `${student.confidence_score}%`],
    ["Alerts", student.alerts_count],
  ].map(([label, value]) => `
    <div class="student-metric-card glass">
      <div class="panel-title">${label}</div>
      <h3>${value}</h3>
    </div>
  `).join(""));
}

function renderPlan(student) {
  setHtml("#weekly-plan", student.weekly_plan.map((week) => `
    <div class="plan-card">
      <strong>Week ${week.week}: ${week.focus}</strong>
      <p>${week.tasks.join(" | ")}</p>
    </div>
  `).join(""));
}

function renderMatches(student) {
  setHtml("#matches", student.matches.map((match) => `
    <div class="match-card">
      <strong>${match.company}</strong>
      <div>${match.role} | ${match.score}% fit</div>
      <p>${match.reason}</p>
      <p><strong>Missing:</strong> ${(match.missing_skills || []).join(", ") || "No major blockers identified"}</p>
    </div>
  `).join(""));
}

function renderSelectedStudent() {
  const student = state.students.find((item) => item.id === state.selectedStudentId) || state.students[0];
  if (!student) return;

  state.selectedStudentId = student.id;
  const videoLink = qs("#video-interview-link");
  if (videoLink) {
    videoLink.href = `/student/video-interview/${student.id}`;
  }
  setText("#student-greeting", `${getGreeting()}, ${student.name}.`);
  setText("#student-name", student.name);
  setText("#student-summary", student.summary);
  setText("#student-readiness", `${student.readiness_score}%`);
  const readinessRing = qs("#student-readiness-ring");
  if (readinessRing) {
    readinessRing.style.setProperty("--readiness", student.readiness_score);
    readinessRing.style.setProperty("--pct", student.readiness_score);
  }
  setText("#student-readiness-title", getReadinessHeadline(student.readiness_score));
  setText("#student-readiness-summary", getReadinessSummary(student));
  setHtml("#student-stat-chips", [
    `${student.skills.length} skills detected`,
    `${student.skill_gaps.length} gaps flagged`,
    `${student.tasks.filter((task) => task.status === "done").length}/${student.tasks.length || 0} tasks done`,
    `${student.matches.length} role matches`,
  ].map((item) => `<span class="student-stat-chip">${item}</span>`).join(""));
  setText("#sidebar-student-initial", student.name.charAt(0).toUpperCase());
  setText("#sidebar-student-avatar", student.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase());
  setText("#sidebar-student-name", student.name);
  setText("#sidebar-student-role", `${student.degree} | ${student.branch} | ${student.graduation_year}`);
  setText("#sidebar-student-branch", `${student.degree} | ${student.branch} | ${student.graduation_year}`);
  setHtml("#resume-output", `
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
  `);
  setHtml("#student-insights", `
    <div class="list-item">
      <strong>Strengths</strong>
      <p>${(student.strengths || []).join(" | ") || "Upload a resume to extract strengths."}</p>
    </div>
    <div class="list-item">
      <strong>Improvement Priorities</strong>
      <p>${(student.improvement_priorities || []).join(" | ") || "No priorities available yet."}</p>
    </div>
  `);
  renderMetrics(student);
  renderFeatureCards(student);
  renderPlan(student);
  renderMatches(student);
  renderTasks(student);
  renderQuickTasks(student);
  renderAlerts(student);
  loadProgress(student.id).catch((error) => setStatus(error.message, true));
  loadChatHistory(student.id).catch((error) => setStatus(error.message, true));
  updateInterviewModeUi();
}

function renderTasks(student) {
  setHtml("#task-list", (student.tasks || []).map((task) => `
    <div class="list-item">
      <strong>${task.title}</strong>
      <p>${task.description}</p>
      <p><strong>Due:</strong> ${task.due_date} | <strong>Status:</strong> ${task.status}</p>
      <div class="cta-row">
        <button class="btn btn-secondary btn-small task-status" data-task-id="${task.id}" data-status="done">Mark Done</button>
        <button class="btn btn-secondary btn-small task-status" data-task-id="${task.id}" data-status="missed">Mark Missed</button>
      </div>
    </div>
  `).join("") || `<div class="list-item">No tasks yet.</div>`);
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
  setHtml("#progress-panel", `
    <div class="list-item">
      <strong>Progress Snapshot</strong>
      <p>Completion rate: ${progress.completion_rate}% | Percentile rank: ${progress.percentile_rank}%</p>
      <p>Completed tasks: ${progress.completed_tasks}/${progress.total_tasks}</p>
      <p>Interview trend: ${scores.length ? scores.join(" -> ") : "No interviews yet"}</p>
      ${renderSparkline(scores)}
    </div>
  `);
}

async function loadChatHistory(studentId) {
  const response = await apiFetch(`/api/chat/history/${studentId}`);
  const history = await response.json();
  setHtml("#chat-history", history.map((msg) => `
    <p><strong>${msg.role === "assistant" ? "Mentor" : "You"}:</strong> ${msg.content}</p>
  `).join("") || "No chat yet. Ask the mentor something.");
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
  if (!state.selectedStudentId) {
    setStatus("No student selected.", true);
    return;
  }
  const fileInput = event.currentTarget.querySelector('input[type="file"]') || qs("#resume-file") || qs("#create-resume-file");
  const file = fileInput?.files?.[0];
  if (!file) {
    setStatus("Please select a resume file first.", true);
    return;
  }

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
    closeResumeModal();
    event.currentTarget.reset();
    setStatus(`Resume analyzed via ${result.source}.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function handleInterviewStart(event) {
  event.preventDefault();
  if (!state.selectedStudentId) {
    setStatus("No student selected.", true);
    return;
  }
  const formData = new FormData();
  const tone = qs("#interview-tone")?.value || "supportive";
  const mode = qs("#interview-mode")?.value || "text";
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  formData.append("tone", tone);
  state.interviewMode = mode;
  state.finalTranscript = "";
  renderVoiceTranscript("");
  updateInterviewModeUi();

  try {
    setStatus("Starting interview session...");
    setButtonLoading(submitButton, true, "Starting...");
    const response = await apiFetch(`/api/students/${state.selectedStudentId}/interview/start`, {
      method: "POST",
      body: formData,
    });
    const session = await response.json();
    state.activeSessionId = session.id;
    setText("#interview-question", session.current_question);
    setHtml("#interview-feedback", `<div class="list-item">Interview session started in ${session.tone} mode.</div>`);
    setStatus("Interview started.");
    if (state.interviewMode === "voice") {
      showMicModal("Voice interview is ready. Click Enable Microphone first, allow the browser prompt, then use Start Listening to answer.");
      speakText(session.current_question);
      setVoiceStatus("Voice interview started. Enable the microphone in the popup, then answer with Start Listening.");
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function handleInterviewReply(event) {
  if (event) {
    event.preventDefault();
  }
  if (!state.selectedStudentId || !state.activeSessionId) {
    setStatus("No active interview session. Start one first.", true);
    return;
  }
  const answerEl = qs("#interview-answer");
  const answer = answerEl?.value.trim() || "";
  if (!answer) {
    setStatus("Please enter or record an answer first.", true);
    return;
  }
  const submitButton = event?.currentTarget?.querySelector?.('button[type="submit"]');

  const formData = new FormData();
  formData.append("answer", answer);

  try {
    setButtonLoading(submitButton, true, "Evaluating...");
    const response = await apiFetch(`/api/students/${state.selectedStudentId}/interview/${state.activeSessionId}/reply`, {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    if (answerEl) answerEl.value = "";
    state.finalTranscript = "";
    renderVoiceTranscript("");
    setText("#interview-question", result.next_question || "Interview completed. Start a new session anytime.");
    setHtml("#interview-feedback", `
      <div class="list-item">
        <strong>Feedback <span class="badge ${result.ai_enabled ? "" : "offline"}">${result.source}</span></strong>
        <p>${result.latest_feedback}</p>
        <p><strong>Resources:</strong> ${result.recommended_resources.join(" | ")}</p>
        <p><strong>Current score:</strong> ${result.session.overall_score}%</p>
        <p><strong>Report:</strong> ${result.session.report_summary || "Interview report will grow as the session continues."}</p>
      </div>
    `);
    await refreshStudent();
    if (state.interviewMode === "voice" && result.next_question) {
      speakText(result.next_question);
      setVoiceStatus("Next question is ready. Start listening when you want to answer.");
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function handleChat(event) {
  event.preventDefault();
  if (!state.selectedStudentId) return;
  const messageEl = qs("#chat-message");
  const message = messageEl?.value.trim() || "";
  if (!message) return;
  const formData = new FormData();
  formData.append("student_id", state.selectedStudentId);
  formData.append("message", message);
  try {
    const response = await apiFetch("/api/chat", { method: "POST", body: formData });
    const result = await response.json();
    if (messageEl) messageEl.value = "";
    setHtml("#chat-history", result.history.map((msg) => `
      <p><strong>${msg.role === "assistant" ? "Mentor" : "You"}:</strong> ${msg.content}</p>
    `).join(""));
  } catch (error) {
    setStatus(error.message, true);
  }
}

function bindForms() {
  const safe = (selector, event, handler) => {
    const el = qs(selector);
    if (el) el.addEventListener(event, handler);
  };

  safe("#student-create-form", "submit", handleStudentCreate);
  safe("#student-create-inline-form", "submit", handleStudentCreate);
  safe("#resume-form", "submit", handleResumeUpload);
  safe("#chat-form", "submit", handleChat);
  safe("#start-interview-form", "submit", handleInterviewStart);
  safe("#interview-reply-form", "submit", handleInterviewReply);
  safe("#interview-mode", "change", (event) => {
    state.interviewMode = event.target.value;
    updateInterviewModeUi();
  });
  safe("#voice-toggle", "click", () => {
    startVoiceListening().catch((error) => setVoiceStatus(error.message, true));
  });
  safe("#voice-submit", "click", async () => {
    if (!qs("#interview-answer")?.value.trim()) {
      setVoiceStatus("Record or type an answer before submitting.", true);
      return;
    }
    stopVoiceRecognition();
    await handleInterviewReply();
  });
  safe("#voice-replay", "click", () => {
    speakText(qs("#interview-question")?.textContent || "");
  });
  safe("#mic-modal-confirm", "click", async () => {
    try {
      await promptForMicrophoneAccess();
      speakText(qs("#interview-question")?.textContent || "");
    } catch (error) {
      setVoiceStatus("Microphone access is still blocked. Allow it in the browser prompt or site settings.", true);
      showMicModal("Microphone access is still blocked. Click the lock icon in the address bar, allow the microphone, then try Enable Microphone again.");
    }
  });
  safe("#mic-modal-close", "click", hideMicModal);
  qsa("[data-mic-close]").forEach((element) => {
    element.addEventListener("click", hideMicModal);
  });
  safe("#show-add-student", "click", () => {
    const panel = qs("#student-create-inline");
    if (panel) panel.hidden = false;
  });
  safe("#cancel-add-student", "click", () => {
    const panel = qs("#student-create-inline");
    const form = qs("#student-create-inline-form");
    if (panel) panel.hidden = true;
    if (form) form.reset();
  });
  safe("#open-resume-upload", "click", openResumeModal);
  safe("#close-resume-modal", "click", closeResumeModal);
  qsa("[data-open-upload]").forEach((element) => {
    element.addEventListener("click", openResumeModal);
  });
  qsa("[data-close-resume-modal]").forEach((element) => {
    element.addEventListener("click", closeResumeModal);
  });
}

initialiseVoiceRecognition();
bindForms();
refreshBootstrap().catch((error) => setStatus(error.message, true));
