const state = {
  students: [],
  ai: null,
  selectedStudentId: null,
  activeSessionId: null,
  activeView: "dashboard",
  interviewMode: "text",
  voiceSupported: false,
  voiceListening: false,
  finalTranscript: "",
  recognition: null,
  micStream: null,
  mentorLoaded: false,
  interviewLoaded: false,
};

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return Array.from(document.querySelectorAll(selector));
}

function setStatus(message, isError = false) {
  ["#student-status", "#student-status-dashboard"].forEach((selector) => {
    const el = qs(selector);
    if (!el) return;
    el.hidden = !message;
    el.className = `ai-banner ${isError ? "offline" : ""}`.trim();
    el.textContent = message || "";
  });
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
    setVoiceStatus("Audio playback was blocked. Replay the question after allowing audio.", true);
  };
  window.speechSynthesis.speak(utterance);
}

function getSelectedStudent() {
  return state.students.find((item) => item.id === state.selectedStudentId) || state.students[0] || null;
}

function switchView(viewId) {
  state.activeView = viewId;
  qsa(".view").forEach((view) => view.classList.remove("active"));
  qsa(".ni").forEach((item) => item.classList.remove("on"));
  const targetView = qs(`#v-${viewId}`);
  const targetNav = qs(`.ni[data-view="${viewId}"]`);
  if (targetView) targetView.classList.add("active");
  if (targetNav) targetNav.classList.add("on");

  if (viewId === "interview" && !state.interviewLoaded) {
    state.interviewLoaded = true;
    renderInterviewView(getSelectedStudent());
  }
  if (viewId === "mentor" && !state.mentorLoaded && state.selectedStudentId) {
    state.mentorLoaded = true;
    loadChatHistory(state.selectedStudentId).catch((error) => setStatus(error.message, true));
  }
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
  ["#ai-banner", "#ai-banner-dashboard"].forEach((selector) => {
    const el = qs(selector);
    if (!el) return;
    el.className = `ai-banner ${ai.enabled ? "" : "offline"}`.trim();
    el.innerHTML = ai.enabled
      ? `Student intelligence is running in live AI mode with <strong>${ai.model}</strong>.`
      : `Student intelligence is in fallback mode. Add <code>GEMINI_API_KEY</code> to enable live AI coaching.`;
  });
}

function renderStudentList() {
  const badge = qs("#student-count-badge");
  if (badge) {
    badge.textContent = state.students.length;
  }
  qs("#student-list").innerHTML = state.students.map((student) => `
    <button class="student-chip ${student.id === state.selectedStudentId ? "active" : ""}" data-student-id="${student.id}">
      <div><strong>${student.name}</strong></div>
      <div class="muted">${student.branch} | ${student.readiness_score}% ready</div>
    </button>
  `).join("");

  qsa("#student-list [data-student-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedStudentId = button.dataset.studentId;
      state.activeSessionId = null;
      state.mentorLoaded = false;
      state.interviewLoaded = false;
      renderAll(getSelectedStudent());
      renderStudentList();
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

function renderSidebarProfile(student) {
  qs("#sidebar-student-name").textContent = student?.name || "No student";
  qs("#sidebar-student-branch").textContent = student
    ? `${student.branch} · ${student.graduation_year || "Current cohort"}`
    : "Create a profile to begin";
  const avatar = qs("#sidebar-student-avatar");
  avatar.textContent = student ? student.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() : "PA";
}

function renderMetrics(student) {
  qs("#student-metrics").innerHTML = [
    ["Resume", `${student.resume_score}%`],
    ["Interview", `${student.interview_score}%`],
    ["Confidence", `${student.confidence_score}%`],
    ["Alerts", student.alerts_count],
  ].map(([label, value]) => `
    <div class="metric-card">
      <div class="panel-title">${label}</div>
      <h3>${value}</h3>
    </div>
  `).join("");
}

function renderDashboard(student) {
  qs("#hero-student-name").textContent = `${student.name}'s placement workspace`;
  qs("#student-name").textContent = student.name;
  qs("#student-summary").textContent = student.summary;
  qs("#student-readiness").textContent = student.readiness_score;
  const ring = qs("#student-readiness-ring");
  if (ring) {
    ring.style.setProperty("--pct", student.readiness_score);
  }
  const previewTasks = (student.tasks || []).slice(0, 3);
  qs("#dashboard-task-preview").innerHTML = previewTasks.map((task) => `
    <div class="list-item">
      <div class="row-head">
        <strong>${task.title}</strong>
        <span class="task-pill ${task.status}">${task.status}</span>
      </div>
      <p>${task.description}</p>
      <p class="muted">Due ${task.due_date}</p>
    </div>
  `).join("") || `<div class="list-item">No tasks yet.</div>`;

  const alertCards = [];
  if (student.alerts_count > 0) {
    alertCards.push(`
      <div class="list-item">
        <strong>${student.alerts_count} active alert${student.alerts_count === 1 ? "" : "s"}</strong>
        <p>Watchdog has marked this profile as needing intervention.</p>
      </div>
    `);
  }
  if ((student.skill_gaps || []).length) {
    alertCards.push(`
      <div class="list-item">
        <strong>Top gaps</strong>
        <p>${student.skill_gaps.slice(0, 4).join(" | ")}</p>
      </div>
    `);
  }
  qs("#dashboard-alerts").innerHTML = alertCards.join("") || `<div class="list-item">No blockers right now.</div>`;
}

function renderTaskProgress(student) {
  const tasks = student.tasks || [];
  const total = tasks.length || 1;
  const done = tasks.filter((task) => task.status === "done").length;
  const missed = tasks.filter((task) => task.status === "missed").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const weekGroups = Array.from(new Set(tasks.map((task) => task.week || task.due_date || "Current"))).slice(0, 4);
  qs("#task-progress-summary").innerHTML = `
    <div class="list-item">
      <strong>Overall execution</strong>
      <div class="heat-track"><span class="heat-fill" style="width:${Math.round((done / total) * 100)}%;"></span></div>
      <p>${done} done · ${pending} pending · ${missed} missed</p>
    </div>
    ${weekGroups.map((label, index) => `
      <div class="list-item">
        <div class="row-head">
          <strong>Phase ${index + 1}</strong>
          <span class="muted">${label}</span>
        </div>
        <p>Track completion and unblock missed deliverables before the next checkpoint.</p>
      </div>
    `).join("")}
  `;
}

function renderTasks(student) {
  const tasks = student.tasks || [];
  qs("#nav-task-count").textContent = tasks.filter((task) => task.status !== "done").length;
  renderTaskProgress(student);
  qs("#task-list").innerHTML = tasks.map((task, index) => `
    <div class="list-item task-card">
      <div class="row-head">
        <div>
          <strong>${task.title}</strong>
          <div class="muted">Week ${task.week || Math.min(index + 1, 4)} · Due ${task.due_date}</div>
        </div>
        <span class="task-pill ${task.status}">${task.status}</span>
      </div>
      <p>${task.description}</p>
      <div class="cta-row">
        <button class="btn btn-secondary btn-small task-status" data-task-id="${task.id}" data-status="done">Mark Done</button>
        <button class="btn btn-secondary btn-small task-status" data-task-id="${task.id}" data-status="missed">Mark Missed</button>
      </div>
    </div>
  `).join("") || `<div class="list-item">No tasks yet.</div>`;
  qsa(".task-status").forEach((button) => {
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

function renderRoadmap(student) {
  const weeks = student.weekly_plan || [];
  qs("#weekly-plan").innerHTML = weeks.map((week) => `
    <div class="roadmap-card">
      <div class="roadmap-step">${week.week}</div>
      <div>
        <strong>Week ${week.week}: ${week.focus}</strong>
        <p>${week.tasks.join(" | ")}</p>
      </div>
    </div>
  `).join("") || `<div class="list-item">No weekly plan yet.</div>`;
  const activeWeek = weeks[0];
  qs("#roadmap-focus").innerHTML = activeWeek ? `
    <div class="list-item">
      <strong>Current focus</strong>
      <p>${activeWeek.focus}</p>
    </div>
    ${activeWeek.tasks.map((task) => `<div class="list-item">${task}</div>`).join("")}
  ` : `<div class="list-item">Upload a resume to generate the preparation roadmap.</div>`;
}

function inferSkillStrength(skill, student) {
  const base = 48 + ((student.readiness_score || 0) % 24);
  const bonus = skill.length % 18;
  return Math.min(96, base + bonus);
}

function renderSkills(student) {
  qs("#skills-proficiency").innerHTML = (student.skills || []).map((skill) => {
    const strength = inferSkillStrength(skill, student);
    return `
      <div class="list-item">
        <div class="row-head">
          <strong>${skill}</strong>
          <span class="muted">${strength}%</span>
        </div>
        <div class="heat-track">
          <span class="heat-fill" style="width:${strength}%;"></span>
        </div>
      </div>
    `;
  }).join("") || `<div class="list-item">No parsed skills yet.</div>`;

  qs("#skills-gap-cards").innerHTML = (student.skill_gaps || []).map((gap) => `
    <div class="list-item gap-card">
      <strong>${gap}</strong>
      <p>${(student.improvement_priorities || []).find((item) => item.toLowerCase().includes(gap.toLowerCase())) || "Coach recommends focused remedial practice in this area."}</p>
    </div>
  `).join("") || `<div class="list-item">No major gaps identified yet.</div>`;
}

function renderResume(student) {
  qs("#resume-output").innerHTML = `
    <div class="list-item">
      <strong>${student.recent_resume_name || "No resume uploaded yet"}</strong>
      <p>${student.parsed_resume_excerpt || "Upload a resume to trigger Scout, Matcher, and Planner."}</p>
    </div>
    <div class="list-item">
      <strong>Detected skills</strong>
      <p>${(student.skills || []).join(" | ") || "No skills extracted yet."}</p>
    </div>
    <div class="list-item">
      <strong>Gap summary</strong>
      <p>${(student.skill_gaps || []).join(" | ") || "No gap analysis available yet."}</p>
    </div>
  `;
  qs("#student-insights").innerHTML = `
    <div class="list-item">
      <strong>Strengths</strong>
      <p>${(student.strengths || []).join(" | ") || "Upload a resume to extract strengths."}</p>
    </div>
    <div class="list-item">
      <strong>Improvement priorities</strong>
      <p>${(student.improvement_priorities || []).join(" | ") || "No priorities available yet."}</p>
    </div>
  `;
}

function renderMatches(student) {
  const matches = student.matches || [];
  qs("#nav-match-count").textContent = matches.length;
  qs("#matches").innerHTML = matches.map((match) => `
    <div class="match-card glass">
      <div class="row-head">
        <div>
          <strong>${match.company}</strong>
          <div class="muted">${match.role}</div>
        </div>
        <span class="match-score">${match.score}% fit</span>
      </div>
      <div class="heat-track">
        <span class="heat-fill" style="width:${match.score}%;"></span>
      </div>
      <p>${match.reason}</p>
      <p><strong>Missing:</strong> ${(match.missing_skills || []).join(", ") || "No major blockers identified"}</p>
    </div>
  `).join("") || `<div class="list-item">No company matches yet.</div>`;
}

function renderInterviewView(student) {
  if (!student) return;
  qs("#interview-feedback").innerHTML = `
    <div class="list-item">
      <strong>Interview context</strong>
      <p>Questions will lean toward ${student.skill_gaps?.slice(0, 3).join(", ") || "current placement priorities"} and ${student.target_roles?.[0] || "target roles"}.</p>
    </div>
    <div class="list-item">
      <strong>Last known score</strong>
      <p>${student.interview_score}% overall interview readiness.</p>
    </div>
  `;
}

function renderChatMessages(history) {
  qs("#chat-history").innerHTML = history.map((msg) => `
    <div class="chat-bubble ${msg.role === "assistant" ? "assistant" : "user"}">
      <strong>${msg.role === "assistant" ? "Mentor" : "You"}</strong>
      <p>${msg.content}</p>
    </div>
  `).join("") || `<div class="list-item">No chat yet. Ask the mentor something.</div>`;
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
      <strong>Execution rate</strong>
      <div class="heat-track"><span class="heat-fill" style="width:${progress.completion_rate}%;"></span></div>
      <p>${progress.completion_rate}% complete · Percentile ${progress.percentile_rank}%</p>
    </div>
    <div class="list-item">
      <strong>Completed tasks</strong>
      <p>${progress.completed_tasks}/${progress.total_tasks}</p>
    </div>
    <div class="list-item">
      <strong>Interview trend</strong>
      <p>${scores.length ? scores.join(" -> ") : "No interviews yet"}</p>
      ${renderSparkline(scores)}
    </div>
  `;
}

async function loadChatHistory(studentId) {
  const response = await apiFetch(`/api/chat/history/${studentId}`);
  const history = await response.json();
  renderChatMessages(history);
}

async function refreshStudent() {
  if (!state.selectedStudentId) return;
  const response = await apiFetch(`/api/students/${state.selectedStudentId}`);
  const student = await response.json();
  state.students = state.students.map((item) => item.id === student.id ? student : item);
  renderAll(student);
  renderStudentList();
}

function renderAll(student) {
  if (!student) return;
  state.selectedStudentId = student.id;
  renderSidebarProfile(student);
  renderDashboard(student);
  renderMetrics(student);
  renderTasks(student);
  renderRoadmap(student);
  renderSkills(student);
  renderResume(student);
  renderMatches(student);
  loadProgress(student.id).catch((error) => setStatus(error.message, true));
  if (state.activeView === "mentor" || state.mentorLoaded) {
    loadChatHistory(student.id).catch((error) => setStatus(error.message, true));
    state.mentorLoaded = true;
  }
  if (state.activeView === "interview" || state.interviewLoaded) {
    renderInterviewView(student);
    state.interviewLoaded = true;
  }
}

async function refreshBootstrap() {
  const response = await apiFetch("/api/bootstrap");
  const data = await response.json();
  state.ai = data.ai;
  state.students = data.students;
  state.selectedStudentId = state.selectedStudentId || data.featured_student_id;
  renderAiBanner(data.ai);
  renderStudentMode();
  if (!state.students.length) return;
  renderStudentList();
  renderAll(getSelectedStudent());
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
    renderAll(result.student);
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
  const form = event.currentTarget;
  const fileInput = qs("#resume-file");
  const file = fileInput.files[0];
  if (!file || !state.selectedStudentId) return;

  const formData = new FormData();
  formData.append("file", file);
  const submitButton = form.querySelector('button[type="submit"]');

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
    renderAll(result.student);
    setStatus(`Resume analyzed via ${result.source}.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
    form.reset();
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
    renderChatMessages(result.history);
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
  qsa("[data-mic-close]").forEach((element) => {
    element.addEventListener("click", hideMicModal);
  });
  qs("#show-add-student").addEventListener("click", () => {
    qs("#student-create-inline").hidden = false;
  });
  qs("#cancel-add-student").addEventListener("click", () => {
    qs("#student-create-inline").hidden = true;
    qs("#student-create-inline-form").reset();
  });
  qsa(".ni[data-view]").forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.view));
  });
  qsa("[data-view-jump]").forEach((item) => {
    item.addEventListener("click", () => switchView(item.dataset.viewJump));
  });
}

initialiseVoiceRecognition();
bindForms();
refreshBootstrap().catch((error) => setStatus(error.message, true));
