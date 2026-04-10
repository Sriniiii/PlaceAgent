const hrState = {
  ai: null,
  jds: [],
  students: [],
  selectedJdId: null,
  selectedStudentId: null,
  stats: null,
};

function qs(selector) {
  return document.querySelector(selector);
}

function setStatus(message, isError = false) {
  const el = qs("#hr-status");
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
    ? `HR shortlist intelligence is running in live AI mode with <strong>${ai.model}</strong>.`
    : `HR shortlist intelligence is in fallback mode. Add <code>GEMINI_API_KEY</code> to enable live AI ranking.`;
}

function heatColor(score) {
  if (score >= 70) return "#10B981";
  if (score >= 50) return "#F59E0B";
  return "#E24B4A";
}

function renderHrStats(stats) {
  qs("#hr-stats").innerHTML = [
    ["Total students", stats.active_students],
    ["Avg readiness", `${stats.average_readiness}%`],
    ["Resumes processed", stats.resumes_processed],
    ["JDs uploaded", hrState.jds.length],
  ].map(([label, value]) => `
    <div class="stat-card">
      <div class="panel-title">${label}</div>
      <h3>${value}</h3>
    </div>
  `).join("");
}

function renderJds() {
  qs("#jd-list").innerHTML = hrState.jds.map((jd) => `
    <button class="student-chip jd-item ${jd.id === hrState.selectedJdId ? "active" : ""}" data-jd-id="${jd.id}">
      <div><strong>${jd.company_name}</strong></div>
      <div class="muted">${jd.role_title}</div>
    </button>
  `).join("") || `<div class="list-item">No JDs uploaded yet.</div>`;
  document.querySelectorAll(".jd-item").forEach((button) => {
    button.addEventListener("click", () => loadShortlist(button.dataset.jdId));
  });
}

function renderCandidateList() {
  qs("#candidate-list").innerHTML = hrState.students.map((student) => `
    <button class="student-chip ${student.id === hrState.selectedStudentId ? "active" : ""}" data-student-id="${student.id}">
      <div><strong>${student.name}</strong></div>
      <div class="muted">${student.branch} | ${student.readiness_score}% ready | Alerts ${student.alerts_count}</div>
    </button>
  `).join("") || `<div class="list-item">No candidates available yet.</div>`;

  document.querySelectorAll("#candidate-list [data-student-id]").forEach((button) => {
    button.addEventListener("click", () => loadCandidateDetail(button.dataset.studentId));
  });
}

function renderCandidateDetail(student) {
  hrState.selectedStudentId = student.id;
  renderCandidateList();
  qs("#candidate-detail").hidden = false;
  qs("#candidate-profile-content").innerHTML = `
    <div class="detail-top">
      <div>
        <div class="panel-title">Candidate Profile</div>
        <h3>${student.name}</h3>
        <p>${student.summary}</p>
      </div>
      <div class="score-ring">
        <span>${student.readiness_score}</span>
        <small>Readiness</small>
      </div>
    </div>
    <div class="metrics-row">
      <div class="list-item"><div class="panel-title">Resume</div><h3>${student.resume_score}%</h3></div>
      <div class="list-item"><div class="panel-title">Interview</div><h3>${student.interview_score}%</h3></div>
      <div class="list-item"><div class="panel-title">Confidence</div><h3>${student.confidence_score}%</h3></div>
    </div>
    <div class="list-item">
      <div class="subhead">Skills</div>
      <p>${(student.skills || []).join(" | ") || "No skills parsed yet."}</p>
    </div>
    <div class="list-item">
      <div class="subhead">Skill Gaps</div>
      <p>${(student.skill_gaps || []).join(" | ") || "No skill gaps available."}</p>
    </div>
    <div class="list-item">
      <div class="subhead">Strengths</div>
      <p>${(student.strengths || []).join(" | ") || "No strengths available yet."}</p>
    </div>
    <div class="list-item">
      <div class="subhead">Target Roles</div>
      <p>${(student.target_roles || []).join(", ") || "No target roles set."}</p>
    </div>
  `;
  const inviteForm = qs("#invite-form");
  inviteForm.hidden = !hrState.selectedJdId;
}

async function loadCandidateDetail(studentId) {
  try {
    const response = await apiFetch(`/api/students/${studentId}`);
    const student = await response.json();
    renderCandidateDetail(student);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadBootstrap() {
  try {
    const response = await apiFetch("/api/bootstrap");
    const data = await response.json();
    hrState.ai = data.ai;
    hrState.stats = data.stats;
    hrState.students = [...data.students].sort((a, b) => b.readiness_score - a.readiness_score);
    renderAiBanner(data.ai);
    const jdResponse = await apiFetch("/api/hr/jd");
    hrState.jds = await jdResponse.json();
    renderHrStats(data.stats);
    renderCandidateList();
    renderJds();
    if (hrState.selectedStudentId) {
      await loadCandidateDetail(hrState.selectedStudentId);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadShortlist(jdId) {
  try {
    hrState.selectedJdId = jdId;
    renderJds();
    const response = await apiFetch(`/api/hr/shortlist/${jdId}`);
    const data = await response.json();
    qs("#shortlist-output").innerHTML = data.candidates.map((candidate) => `
      <div class="list-item shortlist-card" style="cursor:pointer;" data-student-id="${candidate.student_id}">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
          <strong>${candidate.student_name}</strong>
          <span style="font-weight:700; color:${heatColor(candidate.match_percentage)}; font-size:15px;">
            ${candidate.match_percentage}% match
          </span>
        </div>
        <div class="heat-track">
          <span class="heat-fill" style="width:${candidate.match_percentage}%; background:${heatColor(candidate.match_percentage)};"></span>
        </div>
        <p style="font-size:12px; color:#94A3B8;">${candidate.branch} · ${candidate.graduation_year} · Readiness ${candidate.readiness_score}%</p>
        <p style="font-size:12px;">${candidate.reason}</p>
        <button class="btn btn-secondary btn-small shortlist-view" data-student-id="${candidate.student_id}" type="button">View Profile</button>
      </div>
    `).join("") || `<div class="list-item">No candidates matched yet.</div>`;
    document.querySelectorAll(".shortlist-card, .shortlist-view").forEach((element) => {
      element.addEventListener("click", (event) => {
        const studentId = event.currentTarget.dataset.studentId;
        if (studentId) {
          loadCandidateDetail(studentId);
        }
      });
    });
    if (hrState.selectedStudentId) {
      qs("#invite-form").hidden = false;
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleJdSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  try {
    setStatus("Uploading JD and ranking candidates...");
    setButtonLoading(submitButton, true, "Generating...");
    const response = await apiFetch("/api/hr/jd/upload", { method: "POST", body: formData });
    const jd = await response.json();
    hrState.jds = [jd, ...hrState.jds];
    renderHrStats(hrState.stats);
    renderJds();
    form.reset();
    await loadShortlist(jd.id);
    setStatus("Shortlist generated.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

async function handleInvite(event) {
  event.preventDefault();
  if (!hrState.selectedStudentId || !hrState.selectedJdId) {
    setStatus("Select a candidate and a job description before sending an invite.", true);
    return;
  }
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  setButtonLoading(submitButton, true, "Sending...");
  try {
    const formData = new FormData(form);
    formData.append("student_id", hrState.selectedStudentId);
    formData.append("jd_id", hrState.selectedJdId);
    await apiFetch("/api/hr/invite", { method: "POST", body: formData });
    setStatus("Invite sent successfully.");
    form.reset();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setButtonLoading(submitButton, false);
  }
}

qs("#jd-form").addEventListener("submit", handleJdSubmit);
qs("#invite-form").addEventListener("submit", handleInvite);
loadBootstrap().catch((error) => setStatus(error.message, true));
