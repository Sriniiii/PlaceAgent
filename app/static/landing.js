function qs(selector) {
  return document.querySelector(selector);
}

function renderAiBanner(ai) {
  const el = qs("#ai-banner");
  el.className = `ai-banner ${ai.enabled ? "" : "offline"}`.trim();
  el.innerHTML = ai.enabled
    ? `Real AI mode is active. Agents are currently powered by <strong>${ai.model}</strong>.`
    : `Fallback mode is active. Add <code>GEMINI_API_KEY</code> and restart the app to enable live AI reasoning.`;
  const chip = qs("#live-model-chip");
  if (chip) {
    chip.textContent = ai.enabled ? `${ai.model}` : "Fallback";
  }
}

function renderOverview(data) {
  qs("#landing-overview").innerHTML = [
    ["Active students", data.stats.active_students],
    ["Average readiness", `${data.stats.average_readiness}%`],
    ["High-risk students", data.stats.high_risk_students],
    ["Interviews completed", data.stats.interviews_completed],
  ].map(([label, value]) => `
    <div class="stat-card">
      <div class="panel-title">${label}</div>
      <h3>${value}</h3>
    </div>
  `).join("");
}

function animateMarquee() {
  const marquee = qs("#live-marquee");
  if (!marquee) return;
  const pills = Array.from(marquee.children);
  if (!pills.length) return;
  let index = 0;
  setInterval(() => {
    pills.forEach((pill, pillIndex) => {
      pill.classList.toggle("is-highlighted", pillIndex === index);
    });
    index = (index + 1) % pills.length;
  }, 1400);
}

async function init() {
  const response = await fetch("/api/bootstrap");
  const data = await response.json();
  renderAiBanner(data.ai);
  renderOverview(data);
  animateMarquee();
}

init();
