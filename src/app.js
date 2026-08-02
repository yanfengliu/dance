import { AudioEngine } from "./audio-engine.js";
import { clamp } from "./groove-analysis.js";
import { DancerRenderer } from "./dancer.js";

const element = (id) => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing required element: ${id}`);
  return value;
};

const audio = element("audio");
const stage = element("stage");
const canvas = element("dance-canvas");
const demoButton = element("demo-button");
const fileInput = element("audio-file");
const playToggle = element("play-toggle");
const playIcon = element("play-icon");
const seek = element("seek");
const trackTitle = element("track-title");
const timeValue = element("time-value");
const liveIndicator = element("live-indicator");
const liveLabel = element("live-label");
const firstRun = element("first-run");
const tempoValue = element("tempo-value");
const pocketValue = element("pocket-value");
const pocketDetail = element("pocket-detail");
const pocketDot = element("pocket-dot");
const lockValue = element("lock-value");
const motionToggle = element("motion-toggle");
const status = element("status");
const errorBanner = element("error-banner");

const engine = new AudioEngine(audio);
const dancer = new DancerRenderer(canvas);
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = motionPreference.matches;
let manualMotionChoice = false;
let frameId = 0;
let lastUiUpdate = 0;
let disposed = false;
let interfaceState = null;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function announce(message) {
  status.textContent = message;
}

function describePocket(analysis) {
  if (analysis.pocketLabel === "listening") return "waiting for a pattern";
  const milliseconds = Math.round(Math.abs(analysis.pocketMs));
  const direction = analysis.pocketMs > 5 ? "late" : analysis.pocketMs < -5 ? "early" : "from center";
  if (analysis.pocketLabel === "swung") {
    return `${Math.round(analysis.swing * 100)}% swing · ${milliseconds} ms ${direction}`;
  }
  if (analysis.pocketLabel === "syncopated") {
    return `${Math.round(analysis.syncopation * 100)}% off-grid weight · ${milliseconds} ms ${direction}`;
  }
  return milliseconds <= 5 ? "right on the grid" : `${milliseconds} ms ${direction}`;
}

function updateInterface(analysis) {
  const playing = engine.isPlaying;
  const active = engine.mode !== "idle";
  playToggle.disabled = !active;
  playToggle.setAttribute("aria-label", playing ? "Pause" : "Play");
  playIcon.textContent = playing ? "Ⅱ" : "▶";
  liveIndicator.dataset.active = String(playing);
  liveLabel.textContent = interfaceState === "ERROR"
    ? "ERROR"
    : interfaceState ?? (playing ? "LISTENING" : active ? "PAUSED" : "READY");
  firstRun.classList.toggle("hidden", active);
  firstRun.setAttribute("aria-hidden", String(active));
  trackTitle.textContent = engine.title;
  trackTitle.title = engine.title;

  if (analysis.bpm > 0 && analysis.confidence > 0.08) tempoValue.textContent = String(Math.round(analysis.bpm));
  else tempoValue.textContent = "—";

  pocketValue.textContent = analysis.pocketLabel;
  pocketDetail.textContent = describePocket(analysis);
  pocketDot.style.left = `${50 + clamp(analysis.pocketMs, -50, 50) * 0.9}%`;
  const lock = clamp((analysis.confidence * 0.72 + analysis.pocketConfidence * 0.28) * 1.35);
  lockValue.textContent = String(Math.round(lock * 100));

  const duration = engine.duration;
  const current = engine.currentTime;
  if (engine.mode === "file") {
    seek.disabled = !(duration > 0);
    seek.value = duration > 0 ? String(Math.round(clamp(current / duration) * 1000)) : "0";
    timeValue.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
  } else if (engine.mode === "demo") {
    seek.disabled = true;
    seek.value = String(Math.round(clamp((current % duration) / duration) * 1000));
    timeValue.textContent = `${formatTime(current)} · looping demo`;
  } else {
    seek.disabled = true;
    seek.value = "0";
    timeValue.textContent = "0:00 / 0:00";
  }

  const demoLabel = demoButton.querySelector("span:last-child");
  demoLabel.textContent = engine.mode === "demo" ? "Restart demo groove" : "Play demo groove";
}

function render(timestamp) {
  if (disposed || document.hidden) return;
  const analysis = engine.snapshot();
  dancer.render(analysis, timestamp, engine.isPlaying);
  if (timestamp - lastUiUpdate >= 90) {
    updateInterface(analysis);
    lastUiUpdate = timestamp;
  }
  frameId = requestAnimationFrame(render);
}

function startRenderLoop() {
  if (frameId || disposed || document.hidden) return;
  frameId = requestAnimationFrame((timestamp) => {
    frameId = 0;
    render(timestamp);
  });
}

function showError(error) {
  const message = error instanceof Error ? error.message : "Something interrupted the audio.";
  announce(message);
  interfaceState = "ERROR";
  errorBanner.textContent = message;
  errorBanner.hidden = false;
  liveIndicator.dataset.active = "false";
  liveLabel.textContent = "ERROR";
}

function clearError(nextState = null) {
  interfaceState = nextState;
  errorBanner.hidden = true;
  errorBanner.textContent = "";
}

async function playDemo() {
  clearError("STARTING");
  demoButton.disabled = true;
  announce("Starting the built-in swung groove.");
  updateInterface(engine.snapshot());
  try {
    await engine.startDemo();
    interfaceState = null;
    announce("Demo groove playing at 104 beats per minute.");
  } catch (error) {
    if (error?.name !== "AbortError") showError(error);
  } finally {
    demoButton.disabled = false;
    updateInterface(engine.snapshot());
  }
}

async function loadAudio(file) {
  if (!file) return;
  clearError("LOADING");
  announce(`Loading ${file.name}.`);
  updateInterface(engine.snapshot());
  try {
    await engine.loadFile(file);
    interfaceState = null;
    announce(`${file.name} loaded. Press play to begin.`);
  } catch (error) {
    if (error?.name !== "AbortError") showError(error);
  } finally {
    fileInput.value = "";
    updateInterface(engine.snapshot());
  }
}

async function togglePlayback() {
  clearError();
  try {
    const nowPlaying = await engine.togglePlayback();
    announce(nowPlaying ? `${engine.title} playing.` : `${engine.title} paused.`);
  } catch (error) {
    if (error?.name !== "AbortError") showError(error);
  }
  updateInterface(engine.snapshot());
}

function applyMotionChoice(value, manual = false) {
  reducedMotion = value;
  if (manual) manualMotionChoice = true;
  dancer.setReducedMotion(value);
  motionToggle.setAttribute("aria-pressed", String(value));
  motionToggle.textContent = value ? "Motion reduced" : "Reduce motion";
}

demoButton.addEventListener("click", playDemo);
playToggle.addEventListener("click", togglePlayback);
fileInput.addEventListener("change", () => loadAudio(fileInput.files?.[0]));
seek.addEventListener("input", () => engine.seek(Number(seek.value) / 1000));
motionToggle.addEventListener("click", () => applyMotionChoice(!reducedMotion, true));

audio.addEventListener("ended", () => {
  announce(`${engine.title} finished.`);
  updateInterface(engine.snapshot());
});
audio.addEventListener("error", () => {
  if (engine.mode !== "file") return;
  engine.clearCurrentFile();
  showError(new Error("Playback stopped because this audio could not be decoded."));
  updateInterface(engine.snapshot());
});
audio.addEventListener("seeking", () => engine.resetAnalysis());

stage.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  stage.classList.add("drag-over");
});
stage.addEventListener("dragleave", (event) => {
  if (!stage.contains(event.relatedTarget)) stage.classList.remove("drag-over");
});
stage.addEventListener("drop", (event) => {
  event.preventDefault();
  stage.classList.remove("drag-over");
  loadAudio(event.dataTransfer?.files?.[0]);
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat || engine.mode === "idle") return;
  const target = event.target;
  if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement || target instanceof HTMLAnchorElement || target instanceof HTMLLabelElement) return;
  event.preventDefault();
  togglePlayback();
});

motionPreference.addEventListener("change", (event) => {
  if (!manualMotionChoice) applyMotionChoice(event.matches);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(frameId);
    frameId = 0;
  } else {
    engine.resetAnalysis();
    startRenderLoop();
  }
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  disposed = true;
  cancelAnimationFrame(frameId);
  dancer.dispose();
  engine.dispose();
});

applyMotionChoice(reducedMotion);
updateInterface(engine.snapshot());
startRenderLoop();
