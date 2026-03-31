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
  if (pauses.long >= 3