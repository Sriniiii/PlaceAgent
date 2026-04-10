const hrState = {
  ai: null,
  jds: [],
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

function renderAiBanner(ai) {
  const el = qs("#ai-banner");
  el.className = `ai-banner ${ai.enabled ? "" : "offline"}`.trim();
  el.innerHTML = ai.enabled
    ? `HR shortlist intelligence is running in live AI mode with <strong>${ai.model}</strong>.`
    : `HR shortlist intelligence is in fallback mode. Add <code>GEMINI_API_KEY</code> to enable live AI ranking.`;
}

function renderJds() {
  qs("#jd-list").innerHTML = hrState.jds.map((jd) => `
    <button class="student-chip jd-item" data-jd-id="${jd.id}">
      <div><strong>${jd.company_name}</strong></div>
      <div class="muted">${jd.role_title}</div>
    </button>
  `).join("") || `<div class="list-item">No JDs uploaded yet.</div>`;
  document.querySelectorAll(".jd-item").forEach((button) => {
    button.addEventListener("click", () => loadShortlist(button.dataset.jdId));
  });
}

async function loadBootstrap() {
  const response = await apiFetch("/api/bootstrap");
  const data = await response.json();
  hrState.ai = data.ai;
  renderAiBanner(data.ai);
  const jdResponse = await apiFetch("/api/hr/jd");
  hrState.jds = await jdResponse.json();
  renderJds();
}

async function loadShortlist(jdId) {
  try {
    const response = await apiFetch(`/api/hr/shortlist/${jdId}`);
    const data = await response.json();
    qs("#shortlist-output").innerHTML = data.candidates.map((candidate) => `
      <div class="list-item">
        <strong>${candidate.student_name}</strong>
        <p>${candidate.branch} | ${candidate.graduation_year}</p>
        <p>Readiness ${candidate.readiness_score}% | Match ${candidate.match_percentage}%</p>
        <p>${candidate.reason}</p>
      </div>
    `).join("") || `<div class="list-item">No candidates matched yet.</div>`;
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleJdSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    setStatus("Uploading JD and ranking candidates...");
    const response = await apiFetch("/api/hr/jd/upload", { method: "POST", body: formData });
    const jd = await response.json();
    hrState.jds = [jd, ...hrState.jds];
    renderJds();
    event.currentTarget.reset();
    await loadShortlist(jd.id);
    setStatus("Shortlist generated.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

qs("#jd-form").addEventListener("submit", handleJdSubmit);
loadBootstrap().catch((error) => setStatus(error.message, true));
