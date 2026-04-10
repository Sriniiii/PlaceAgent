const tpcState = {
  ai: null,
  students: [],
  alerts: [],
  logs: [],
};

function qs(selector) {
  return document.querySelector(selector);
}

function setStatus(message, isError = false) {
  const el = qs("#tpc-status");
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

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderAiBanner(ai) {
  const el = qs("#ai-banner");
  el.className = `ai-banner ${ai.enabled ? "" : "offline"}`.trim();
  el.innerHTML = ai.enabled
    ? `TPC intelligence is running in live AI mode with <strong>${ai.model}</strong>.`
    : `TPC intelligence is in fallback mode. Add <code>GEMINI_API_KEY</code> to enable live AI risk reasoning.`;
}

function renderHeroStats(stats) {
  qs("#hero-stats").innerHTML = [
    ["Students", stats.active_students],
    ["Avg readiness", `${stats.average_readiness}%`],
    ["High-risk", stats.high_risk_students],
    ["Resumes processed", stats.resumes_processed],
  ].map(([label, value]) => `
    <div class="stat-card">
      <div class="panel-title">${label}</div>
      <h3>${value}</h3>
    </div>
  `).join("");
}

function renderAlerts() {
  qs("#alerts-list").innerHTML = tpcState.alerts.map((alert) => `
    <div class="alert-card">
      <div class="severity ${alert.severity}">${alert.severity.toUpperCase()}</div>
      <strong>${alert.student_name}</strong>
      <div>${alert.title}</div>
      <p>${alert.detail}</p>
      <div class="cta-row">
        <button class="btn btn-secondary btn-small alert-action" data-alert-id="${alert.id}" data-action="resolve">Resolve</button>
        <button class="btn btn-secondary btn-small alert-action" data-alert-id="${alert.id}" data-action="escalate">Escalate</button>
      </div>
    </div>
  `).join("") || `<div class="list-item">No active alerts right now.</div>`;

  document.querySelectorAll(".alert-action").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await apiFetch(`/api/tpc/alerts/${button.dataset.alertId}/${button.dataset.action}`, { method: "PATCH" });
        await loadBootstrap();
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  });
}

function renderRiskList() {
  const sorted = [...tpcState.students].sort((a, b) => a.readiness_score - b.readiness_score);
  qs("#student-risk-list").innerHTML = sorted.map((student) => `
    <div class="list-item">
      <strong>${student.name}</strong>
      <p>${student.branch} | Readiness ${student.readiness_score}% | Alerts ${student.alerts_count}</p>
      <p><strong>Priorities:</strong> ${(student.improvement_priorities || student.skill_gaps || []).join(" | ")}</p>
    </div>
  `).join("");
}

function renderLogs() {
  qs("#agent-logs").innerHTML = tpcState.logs.map((log) => `
    <div class="log-card">
      <div class="panel-title">${log.agent}</div>
      <strong>${log.title}</strong>
      <p>${log.detail}</p>
      <div class="muted">${formatTime(log.timestamp)}</div>
    </div>
  `).join("");
}

function renderAnalytics(analytics) {
  const heatmap = Object.entries(analytics.readiness_by_branch).map(([branch, value]) => `
    <div class="list-item">
      <strong>${branch}</strong>
      <div class="heat-track"><span class="heat-fill" style="width:${value}%"></span></div>
      <p>${value}% readiness</p>
    </div>
  `).join("") || `<div class="list-item">No data yet</div>`;

  qs("#analytics-panel").innerHTML = `
    <div class="list-item">
      <strong>Branch Distribution</strong>
      <p>${Object.entries(analytics.branch_distribution).map(([k, v]) => `${k}: ${v}`).join(" | ") || "No data yet"}</p>
    </div>
    <div class="list-item"><strong>Readiness Heatmap</strong></div>
    ${heatmap}
    <div class="list-item">
      <strong>Prediction Scores</strong>
      <p>${Object.entries(analytics.prediction_scores).map(([k, v]) => `${k}: ${v}`).join(" | ") || "No data yet"}</p>
    </div>
  `;
}

async function loadBootstrap() {
  const response = await apiFetch("/api/bootstrap");
  const data = await response.json();
  tpcState.ai = data.ai;
  tpcState.students = data.students;
  tpcState.alerts = data.alerts;
  tpcState.logs = data.agent_logs;
  renderAiBanner(data.ai);
  renderHeroStats(data.stats);
  renderAlerts();
  renderRiskList();
  renderLogs();
  const analyticsRes = await apiFetch("/api/tpc/analytics");
  renderAnalytics(await analyticsRes.json());
}

async function runWatchdog() {
  try {
    setStatus("Running watchdog...");
    await apiFetch("/api/admin/run-watchdog", { method: "POST" });
    await loadBootstrap();
    setStatus("Watchdog scan completed.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function generateReport() {
  try {
    const response = await apiFetch("/api/tpc/reports/generate", { method: "POST" });
    qs("#report-output").textContent = await response.text();
  } catch (error) {
    setStatus(error.message, true);
  }
}

qs("#run-watchdog").addEventListener("click", runWatchdog);
qs("#generate-report").addEventListener("click", generateReport);
loadBootstrap().catch((error) => setStatus(error.message, true));
