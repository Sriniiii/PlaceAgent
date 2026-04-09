const tpcState = {
  ai: null,
  students: [],
  alerts: [],
  logs: [],
};

function qs(selector) {
  return document.querySelector(selector);
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
    </div>
  `).join("");
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
  qs("#analytics-panel").innerHTML = `
    <div class="list-item">
      <strong>Branch Distribution</strong>
      <p>${Object.entries(analytics.branch_distribution).map(([k, v]) => `${k}: ${v}`).join(" | ") || "No data yet"}</p>
    </div>
    <div class="list-item">
      <strong>Readiness By Branch</strong>
      <p>${Object.entries(analytics.readiness_by_branch).map(([k, v]) => `${k}: ${v}%`).join(" | ") || "No data yet"}</p>
    </div>
    <div class="list-item">
      <strong>Prediction Scores</strong>
      <p>${Object.entries(analytics.prediction_scores).map(([k, v]) => `${k}: ${v}`).join(" | ") || "No data yet"}</p>
    </div>
  `;
}

async function loadBootstrap() {
  const response = await fetch("/api/bootstrap");
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
  const analyticsRes = await fetch("/api/tpc/analytics");
  renderAnalytics(await analyticsRes.json());
}

async function runWatchdog() {
  await fetch("/api/admin/run-watchdog", { method: "POST" });
  await loadBootstrap();
}

async function generateReport() {
  const response = await fetch("/api/tpc/reports/generate", { method: "POST" });
  qs("#report-output").textContent = await response.text();
}

qs("#run-watchdog").addEventListener("click", runWatchdog);
qs("#generate-report").addEventListener("click", generateReport);
loadBootstrap();
