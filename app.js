// ==========================
// ELAYON CRS — FRONT CLOUD
// ==========================

let currentSession = null;

// ---------- HELPERS ----------
function getUrl(endpoint) {
  return CRS_CONFIG.BASE_URL + CRS_CONFIG.ENDPOINTS[endpoint];
}

function setStatus(msg, error = false) {
  const el = document.getElementById("status");
  el.innerText = msg;
  el.style.color = error ? "#ff4d4d" : "#00b894";
}

// ---------- HEALTH CHECK ----------
async function checkHealth() {
  try {
    const res = await fetch(getUrl("HEALTH"));
    const data = await res.json();
    setStatus("CRS online ✔");
    console.log("Health:", data);
  } catch (e) {
    setStatus("CRS offline ❌", true);
  }
}

// ---------- ANALISAR ----------
async function analyzeSession() {
  const context = document.getElementById("context").value;
  const transcript = document.getElementById("transcript").value;

  const payload = {
    context: context,
    transcript_raw: transcript
  };

  setStatus("Processando...");

  try {
    const res = await fetch(getUrl("ANALYZE"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    currentSession = data;

    renderResult(data);
    setStatus("Análise concluída ✔");

  } catch (e) {
    console.error(e);
    setStatus("Erro ao chamar CRS", true);
  }
}

// ---------- RENDER ----------
function renderResult(data) {
  const jsonBox = document.getElementById("json");

  jsonBox.value = JSON.stringify(data, null, 2);

  // métricas simples
  if (data.user_report) {
    const m = data.user_report.metrics_visible;

    document.getElementById("metrics").innerText =
      `Duração: ${m.duration_sec}s | Silêncio: ${m.silence_pct}% | Pausas: ${m.pause_count}`;
  }
}

// ---------- GERAR PROMPT ----------
function generatePrompt() {
  if (!currentSession) return;

  const prompt = `
Analise esta sessão do ELAYON CRS:

${JSON.stringify(currentSession, null, 2)}

Objetivos:
1. padrão temporal
2. pausas e silêncio
3. hipóteses não clínicas
4. melhorias
`;

  document.getElementById("prompt").value = prompt;
}

// ---------- INIT ----------
window.onload = () => {
  checkHealth();
};