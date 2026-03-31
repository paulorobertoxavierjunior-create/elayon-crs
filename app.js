const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");
const copyBtn = document.getElementById("copyBtn");

const statusText = document.getElementById("statusText");
const durationText = document.getElementById("durationText");
const frameCountEl = document.getElementById("frameCount");
const eventCountEl = document.getElementById("eventCount");

const transcriptBox = document.getElementById("transcriptBox");
const eventsLog = document.getElementById("eventsLog");
const sessionSummary = document.getElementById("sessionSummary");
const sessionJson = document.getElementById("sessionJson");

const sessionLabelInput = document.getElementById("sessionLabel");
const participantNameInput = document.getElementById("participantName");
const sessionContextInput = document.getElementById("sessionContext");

const mDuration = document.getElementById("mDuration");
const mEnergy = document.getElementById("mEnergy");
const mSilence = document.getElementById("mSilence");
const mShortPauses = document.getElementById("mShortPauses");
const mMediumPauses = document.getElementById("mMediumPauses");
const mLongPauses = document.getElementById("mLongPauses");
const mVar = document.getElementById("mVar");

const confirmBtn = document.getElementById("confirmBtn");
const rejectBtn = document.getElementById("rejectBtn");
const confirmResult = document.getElementById("confirmResult");

const canvas = document.getElementById("waveCanvas");
const ctx = canvas.getContext("2d");

let audioContext = null;
let analyser = null;
let mediaStream = null;
let micSource = null;
let recognition = null;

let animationId = null;
let timerId = null;

let sessionStartedAt = null;
let sessionEndedAt = null;
let elapsedSeconds = 0;

let energySeries = [];
let events = [];
let transcriptRaw = "";
let silenceFrames = 0;
let totalFrames = 0;

let currentPauseFrames = 0;
let activeSpeech = false;

const FRAME_MS = 100;
const SILENCE_THRESHOLD = 0.018;

// pausa em frames de 100 ms
const SHORT_PAUSE_MIN = 2;   // 200 ms
const MEDIUM_PAUSE_MIN = 6;  // 600 ms
const LONG_PAUSE_MIN = 12;   // 1200 ms

function fmtTime(totalSeconds) {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createSessionId() {
  const rand = Math.random().toString(16).slice(2, 10);
  return `crs-${Date.now()}-${rand}`;
}

let currentSessionId = createSessionId();

function setStatus(text) {
  statusText.textContent = text;
}

function addEvent(type, detail) {
  const timeLabel = fmtTime(Math.floor((totalFrames * FRAME_MS) / 1000));
  events.push({
    t_sec: Number(((totalFrames * FRAME_MS) / 1000).toFixed(2)),
    time_label: timeLabel,
    type,
    detail
  });
  renderEvents();
  updateCounters();
  updateSessionJson();
}

function renderEvents() {
  if (!events.length) {
    eventsLog.innerHTML = `<div class="event-placeholder">Nenhum evento registrado ainda.</div>`;
    return;
  }

  eventsLog.innerHTML = events.map(ev => `
    <div class="event-item">
      <div class="event-time">${ev.time_label}</div>
      <div class="event-text"><strong>${ev.type}</strong> — ${ev.detail}</div>
    </div>
  `).join("");
}

function drawIdleCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b1013";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#2a363d";
  ctx.lineWidth = 1;

  for (let i = 0; i < 5; i++) {
    const y = ((i + 1) * canvas.height) / 6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#9fb0b7";
  ctx.font = "16px Arial";
  ctx.fillText("Aguardando captação...", 20, 32);
}

function drawWave() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b1013";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#2a363d";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = ((i + 1) * canvas.height) / 6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  if (!energySeries.length) return;

  const maxPoints = Math.min(canvas.width, energySeries.length);
  const visible = energySeries.slice(-maxPoints);

  ctx.beginPath();
  ctx.strokeStyle = "#6ec1c8";
  ctx.lineWidth = 2;

  visible.forEach((v, i) => {
    const x = i;
    const y = canvas.height - Math.min(v * 5000, canvas.height - 12);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function calcMean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calcVariance(values) {
  if (!values.length) return 0;
  const mean = calcMean(values);
  return values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
}

function finalizePauseIfNeeded() {
  if (currentPauseFrames >= LONG_PAUSE_MIN) {
    addEvent("pausa_longa", `Pausa longa detectada (${(currentPauseFrames * FRAME_MS) / 1000}s)`);
  } else if (currentPauseFrames >= MEDIUM_PAUSE_MIN) {
    addEvent("pausa_media", `Pausa média detectada (${(currentPauseFrames * FRAME_MS) / 1000}s)`);
  } else if (currentPauseFrames >= SHORT_PAUSE_MIN) {
    addEvent("pausa_curta", `Pausa curta detectada (${(currentPauseFrames * FRAME_MS) / 1000}s)`);
  }
  currentPauseFrames = 0;
}

function countPauseBands() {
  let short = 0, medium = 0, long = 0;
  events.forEach(ev => {
    if (ev.type === "pausa_curta") short++;
    if (ev.type === "pausa_media") medium++;
    if (ev.type === "pausa_longa") long++;
  });
  return { short, medium, long };
}

function updateMetrics() {
  const durationSec = (totalFrames * FRAME_MS) / 1000;
  const meanEnergy = calcMean(energySeries);
  const variance = calcVariance(energySeries);
  const silencePct = totalFrames ? (silenceFrames / totalFrames) * 100 : 0;
  const pauses = countPauseBands();

  mDuration.textContent = `${durationSec.toFixed(1)}s`;
  mEnergy.textContent = meanEnergy.toFixed(4);
  mSilence.textContent = `${silencePct.toFixed(1)}%`;
  mShortPauses.textContent = String(pauses.short);
  mMediumPauses.textContent = String(pauses.medium);
  mLongPauses.textContent = String(pauses.long);
  mVar.textContent = variance.toFixed(4);
}

function updateCounters() {
  frameCountEl.textContent = String(totalFrames);
  eventCountEl.textContent = String(events.length);
}

function buildSummary() {
  const meanEnergy = calcMean(energySeries);
  const variance = calcVariance(energySeries);
  const silencePct = totalFrames ? (silenceFrames / totalFrames) * 100 : 0;
  const pauses = countPauseBands();
  const durationSec = (totalFrames * FRAME_MS) / 1000;

  const flags = [];
  if (silencePct > 45) flags.push("silêncio elevado");
  if (variance > 0.0025) flags.push("alta variabilidade de energia");
  if (pauses.long >= 3) flags.push("múltiplas pausas longas");
  if (meanEnergy < 0.02) flags.push("baixa projeção vocal");

  sessionSummary.textContent =
`Resumo bruto da sessão

• Duração aproximada: ${durationSec.toFixed(1)}s
• Energia média: ${meanEnergy.toFixed(4)}
• Silêncio estimado: ${silencePct.toFixed(1)}%
• Pausas curtas: ${pauses.short}
• Pausas médias: ${pauses.medium}
• Pausas longas: ${pauses.long}
• Variabilidade: ${variance.toFixed(4)}

${flags.length ? "Pontos críticos: " + flags.join(", ") : "Sem pontos críticos destacados nesta sessão."}`;
}

function getSessionObject() {
  const pauses = countPauseBands();

  return {
    session_id: currentSessionId,
    started_at: sessionStartedAt,
    ended_at: sessionEndedAt,
    label: sessionLabelInput.value.trim(),
    participant: participantNameInput.value.trim(),
    context: sessionContextInput.value.trim(),
    inputs: {
      audio: true,
      transcript_raw: true
    },
    metrics: {
      duration_sec: Number(((totalFrames * FRAME_MS) / 1000).toFixed(2)),
      energy_mean: Number(calcMean(energySeries).toFixed(6)),
      silence_pct: Number((totalFrames ? (silenceFrames / totalFrames) * 100 : 0).toFixed(2)),
      short_pauses: pauses.short,
      medium_pauses: pauses.medium,
      long_pauses: pauses.long,
      energy_variance: Number(calcVariance(energySeries).toFixed(6))
    },
    events,
    transcript_raw: transcriptRaw.trim()
  };
}

function updateSessionJson() {
  sessionJson.textContent = JSON.stringify(getSessionObject(), null, 2);
}

function resetSessionData() {
  if (timerId) clearInterval(timerId);
  if (animationId) cancelAnimationFrame(animationId);

  elapsedSeconds = 0;
  sessionStartedAt = null;
  sessionEndedAt = null;
  currentSessionId = createSessionId();

  energySeries = [];
  events = [];
  transcriptRaw = "";
  silenceFrames = 0;
  totalFrames = 0;
  currentPauseFrames = 0;
  activeSpeech = false;

  transcriptBox.value = "";
  sessionSummary.textContent = "Inicie uma sessão para consolidar métricas e eventos.";
  confirmResult.textContent = "";
  durationText.textContent = "00:00";

  mDuration.textContent = "0s";
  mEnergy.textContent = "0.0000";
  mSilence.textContent = "0%";
  mShortPauses.textContent = "0";
  mMediumPauses.textContent = "0";
  mLongPauses.textContent = "0";
  mVar.textContent = "0.0000";

  updateCounters();
  renderEvents();
  updateSessionJson();
  drawIdleCanvas();

  confirmBtn.disabled = true;
  rejectBtn.disabled = true;
  exportBtn.disabled = true;
}

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    transcriptBox.value = "Transcrição nativa não disponível neste navegador.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "pt-BR";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.onresult = (event) => {
    let text = "";
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
      if (!event.results[i].isFinal) text += " ";
    }
    transcriptRaw = text;
    transcriptBox.value = transcriptRaw.trim();
    updateSessionJson();
  };

  recognition.onerror = () => {};
  recognition.onend = () => {
    if (!stopBtn.disabled) {
      try { recognition.start(); } catch {}
    }
  };
}

async function startSession() {
  resetSessionData();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    micSource = audioContext.createMediaStreamSource(mediaStream);
    micSource.connect(analyser);

    sessionStartedAt = nowIso();
    setStatus("Captando");
    addEvent("sessao_iniciada", "Captação iniciada");

    startBtn.disabled = true;
    stopBtn.disabled = false;

    setupRecognition();
    if (recognition) recognition.start();

    timerId = setInterval(() => {
      elapsedSeconds++;
      durationText.textContent = fmtTime(elapsedSeconds);
    }, 1000);

    const dataArray = new Uint8Array(analyser.fftSize);

    const loop = () => {
      analyser.getByteTimeDomainData(dataArray);

      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / dataArray.length);
      energySeries.push(rms);
      totalFrames++;

      if (rms < SILENCE_THRESHOLD) {
        silenceFrames++;
        currentPauseFrames++;

        if (activeSpeech && currentPauseFrames === SHORT_PAUSE_MIN) {
          addEvent("queda_de_emissao", "Queda para faixa de silêncio");
          activeSpeech = false;
        }
      } else {
        if (!activeSpeech) {
          addEvent("retomada_de_emissao", "Retomada de fala após silêncio");
          activeSpeech = true;
        }

        if (rms > 0.05) {
          addEvent("pico_de_energia", `Pico detectado (${rms.toFixed(4)})`);
        }

        finalizePauseIfNeeded();
      }

      updateMetrics();
      updateCounters();
      updateSessionJson();
      drawWave();

      animationId = requestAnimationFrame(loop);
    };

    loop();

  } catch (err) {
    setStatus("Falha no microfone");
    sessionSummary.textContent = "Não foi possível acessar o microfone.";
    console.error(err);
  }
}

function stopSession() {
  stopBtn.disabled = true;
  startBtn.disabled = false;
  exportBtn.disabled = false;
  confirmBtn.disabled = false;
  rejectBtn.disabled = false;

  setStatus("Sessão finalizada");
  sessionEndedAt = nowIso();
  addEvent("sessao_encerrada", "Encerramento manual");

  if (timerId) clearInterval(timerId);
  if (animationId) cancelAnimationFrame(animationId);

  finalizePauseIfNeeded();
  updateMetrics();
  buildSummary();
  updateSessionJson();

  if (recognition) {
    try { recognition.stop(); } catch {}
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }

  if (audioContext) {
    audioContext.close();
  }
}

function exportSessionJson() {
  const data = JSON.stringify(getSessionObject(), null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = (sessionLabelInput.value.trim() || currentSessionId).replace(/\s+/g, "-");
  a.href = url;
  a.download = `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

startBtn.addEventListener("click", startSession);
stopBtn.addEventListener("click", stopSession);
clearBtn.addEventListener("click", () => {
  if (!stopBtn.disabled) stopSession();
  resetSessionData();
  setStatus("Aguardando");
});
exportBtn.addEventListener("click", exportSessionJson);

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(transcriptBox.value || "");
    confirmResult.textContent = "Transcrição copiada.";
  } catch {
    confirmResult.textContent = "Não foi possível copiar a transcrição.";
  }
});

confirmBtn.addEventListener("click", () => {
  confirmResult.textContent = "Usuário confirmou que a transcrição representa a sessão.";
});

rejectBtn.addEventListener("click", () => {
  confirmResult.textContent = "Usuário indicou que a transcrição não representa bem a sessão.";
});

drawIdleCanvas();
resetSessionData();
setStatus("Aguardando");