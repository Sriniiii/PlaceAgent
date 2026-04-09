const hrState = {
  ai: null,
  jds: [],
};

function qs(selector) {
  return document.querySelector(selector);
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
  const response = await fetch("/api/bootstrap");
  const data = await response.json();
  hrState.ai = data.ai;
  renderAiBanner(data.ai);
  const jdResponse = await fetch("/api/hr/jd");
  hrState.jds = await jdResponse.json();
  renderJds();
}

async function loadShortlist(jdId) {
  const response = await fetch(`/api/hr/shortlist/${jdId}`);
  const data = await response.json();
  qs("#shortlist-output").innerHTML = data.candidates.map((candidate) => `
    <div class="list-item">
      <strong>${candidate.student_name}</strong>
      <p>${candidate.branch} | ${candidate.graduation_year}</p>
      <p>Readiness ${candidate.readiness_score}% | Match ${candidate.match_percentage}%</p>
      <p>${candidate.reason}</p>
    </div>
  `).join("") || `<div class="list-item">No candidates matched yet.</div>`;
}

async function handleJdSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const response = await fetch("/api/hr/jd/upload", { method: "POST", body: formData });
  const jd = await response.json();
  hrState.jds = [jd, ...hrState.jds];
  renderJds();
  event.currentTarget.reset();
  await loadShortlist(jd.id);
}

qs("#jd-form").addEventListener("submit", handleJdSubmit);
loadBootstrap();
