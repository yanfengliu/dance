import { GrooveAnalyzer } from "./groove-analysis.js";

const DEMO_BPM = 104;
const DEMO_BEATS = 8;

export function advanceDemoClock(step, nextStepAt, now, sixteenth, totalSteps = DEMO_BEATS * 4) {
  if (!(sixteenth > 0) || nextStepAt >= now - sixteenth) return { step, nextStepAt, skipped: 0 };
  const skipped = Math.max(0, Math.ceil((now - nextStepAt) / sixteenth));
  return {
    step: (step + skipped) % totalSteps,
    nextStepAt: nextStepAt + skipped * sixteenth,
    skipped
  };
}

function createNoiseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let seed = 0xdecafbad;
  for (let index = 0; index < channel.length; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    channel[index] = (seed / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

class DemoSequencer {
  constructor(context, destination) {
    this.context = context;
    this.destination = destination;
    this.noiseBuffer = createNoiseBuffer(context);
    this.timer = null;
    this.output = null;
    this.playing = false;
    this.startedAt = 0;
    this.step = 0;
    this.nextStepAt = 0;
  }

  start() {
    if (this.playing) return;
    const now = this.context.currentTime;
    this.output = this.context.createGain();
    this.output.gain.setValueAtTime(0, now);
    this.output.gain.linearRampToValueAtTime(0.82, now + 0.035);
    this.output.connect(this.destination);
    this.startedAt = now + 0.06;
    this.nextStepAt = this.startedAt;
    this.step = 0;
    this.playing = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    const now = this.context.currentTime;
    const output = this.output;
    output.gain.cancelScheduledValues(now);
    output.gain.setTargetAtTime(0, now, 0.018);
    setTimeout(() => output.disconnect(), 180);
    this.output = null;
  }

  get elapsed() {
    return this.playing ? Math.max(0, this.context.currentTime - this.startedAt) : 0;
  }

  schedule() {
    if (!this.playing) return;
    const beat = 60 / DEMO_BPM;
    const sixteenth = beat / 4;
    const swingDelay = beat * 0.135;
    const now = this.context.currentTime;
    const caughtUp = advanceDemoClock(this.step, this.nextStepAt, now, sixteenth);
    this.step = caughtUp.step;
    this.nextStepAt = caughtUp.nextStepAt;
    const horizon = now + 0.14;

    while (this.nextStepAt < horizon) {
      const stepInBeat = this.step % 4;
      const swungTime = this.nextStepAt + (stepInBeat === 2 ? swingDelay : 0);
      this.scheduleStep(this.step, swungTime);
      this.step = (this.step + 1) % (DEMO_BEATS * 4);
      this.nextStepAt += sixteenth;
    }
  }

  scheduleStep(step, time) {
    const kickSteps = new Set([0, 7, 8, 11, 16, 22, 24, 27]);
    const snareSteps = new Set([4, 12, 20, 28]);
    const isFill = step >= 29;

    if (kickSteps.has(step)) {
      this.kick(time, step === 0 || step === 16 ? 1 : 0.72);
      this.bass(time, step);
    }
    if (snareSteps.has(step)) this.snare(time, 0.92);
    if (step % 2 === 0) this.hat(time, step % 4 === 2 ? 0.42 : 0.3, false);
    if (step % 4 === 3 && step < 28) this.hat(time, 0.13, true);
    if (isFill) this.snare(time, 0.2 + (step - 28) * 0.13);
  }

  kick(time, level) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(148, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.26);
    oscillator.connect(gain).connect(this.output);
    oscillator.start(time);
    oscillator.stop(time + 0.28);
  }

  bass(time, step) {
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = step >= 16 ? 55 : 49;
    filter.type = "lowpass";
    filter.frequency.value = 230;
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.22, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.34);
    oscillator.connect(filter).connect(gain).connect(this.output);
    oscillator.start(time);
    oscillator.stop(time + 0.36);
  }

  snare(time, level) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "bandpass";
    filter.frequency.value = 1900;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(level * 0.62, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.17);
    source.connect(filter).connect(gain).connect(this.output);
    source.start(time);
    source.stop(time + 0.19);
  }

  hat(time, level, ghost) {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = ghost ? 7600 : 6200;
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + (ghost ? 0.035 : 0.065));
    source.connect(filter).connect(gain).connect(this.output);
    source.start(time, ghost ? 0.2 : 0);
    source.stop(time + 0.08);
  }
}

export class AudioEngine {
  constructor(audioElement) {
    this.audio = audioElement;
    this.analyzer = new GrooveAnalyzer();
    this.context = null;
    this.worklet = null;
    this.master = null;
    this.mediaSource = null;
    this.demo = null;
    this.mode = "idle";
    this.title = "No track loaded";
    this.objectUrl = null;
    this.operationEpoch = 0;
    this.initializing = null;
  }

  async ensureContext() {
    if (this.context) return this.context;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass || !window.AudioWorkletNode) {
        throw new Error("This browser does not support the Web Audio features POCKET needs.");
      }

      const context = new AudioContextClass({ latencyHint: "interactive" });
      try {
        await context.audioWorklet.addModule(new URL("./pocket-processor.js", import.meta.url));
        const worklet = new AudioWorkletNode(context, "pocket-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        const master = context.createGain();
        master.gain.value = 0.88;
        worklet.connect(master).connect(context.destination);
        const mediaSource = context.createMediaElementSource(this.audio);
        mediaSource.connect(worklet);
        worklet.port.onmessage = (event) => this.analyzer.updateFrame(event.data);

        this.context = context;
        this.worklet = worklet;
        this.master = master;
        this.mediaSource = mediaSource;
        this.demo = new DemoSequencer(context, worklet);
        return context;
      } catch (error) {
        await context.close().catch(() => {});
        throw error;
      }
    })();

    try {
      return await this.initializing;
    } catch (error) {
      this.initializing = null;
      throw error;
    }
  }

  resetAnalysis() {
    this.analyzer.reset();
    this.worklet?.port.postMessage({ type: "reset" });
  }

  assertCurrentOperation(epoch) {
    if (epoch !== this.operationEpoch) {
      throw new DOMException("A newer audio action replaced this one.", "AbortError");
    }
  }

  async loadFile(file) {
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("That file is empty. Try an MP3, WAV, M4A, AAC, or OGG file.");
    }
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name)) {
      throw new Error("That does not look like an audio file.");
    }

    const epoch = ++this.operationEpoch;
    this.demo?.stop();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);

    this.objectUrl = URL.createObjectURL(file);
    this.audio.src = this.objectUrl;
    this.audio.load();
    this.mode = "file";
    this.title = file.name;
    this.resetAnalysis();

    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          this.audio.removeEventListener("loadedmetadata", handleLoaded);
          this.audio.removeEventListener("error", handleError);
        };
        const handleLoaded = () => {
          cleanup();
          if (epoch === this.operationEpoch) resolve();
          else reject(new DOMException("A newer file replaced this one.", "AbortError"));
        };
        const handleError = () => {
          cleanup();
          reject(new Error("Could not read that audio. Try MP3, WAV, M4A, AAC, or OGG."));
        };
        this.audio.addEventListener("loadedmetadata", handleLoaded, { once: true });
        this.audio.addEventListener("error", handleError, { once: true });
      });
    } catch (error) {
      if (epoch === this.operationEpoch) {
        this.audio.removeAttribute("src");
        this.audio.load();
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
        this.mode = "idle";
        this.title = "No track loaded";
        this.resetAnalysis();
      }
      throw error;
    }
  }

  async startDemo() {
    const epoch = ++this.operationEpoch;
    const context = await this.ensureContext();
    this.assertCurrentOperation(epoch);
    await context.resume();
    this.assertCurrentOperation(epoch);
    this.audio.pause();
    this.demo.stop();
    this.resetAnalysis();
    this.mode = "demo";
    this.title = "Built-in swung groove - 104 BPM";
    this.demo.start();
  }

  async togglePlayback() {
    if (this.mode === "idle") return false;
    const epoch = ++this.operationEpoch;
    const intendedMode = this.mode;
    const context = await this.ensureContext();
    this.assertCurrentOperation(epoch);
    await context.resume();
    this.assertCurrentOperation(epoch);
    if (this.mode !== intendedMode) {
      throw new DOMException("The selected audio source changed.", "AbortError");
    }

    if (this.mode === "demo") {
      if (this.demo.playing) this.demo.stop();
      else {
        this.resetAnalysis();
        this.demo.start();
      }
      return this.demo.playing;
    }

    if (this.audio.paused) {
      await this.audio.play();
      this.assertCurrentOperation(epoch);
      return true;
    }
    this.audio.pause();
    return false;
  }

  seek(fraction) {
    if (this.mode !== "file" || !Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(1, fraction)) * this.audio.duration;
    this.resetAnalysis();
  }

  clearCurrentFile() {
    if (this.mode !== "file") return;
    this.operationEpoch += 1;
    this.mode = "idle";
    this.title = "No track loaded";
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.resetAnalysis();
  }

  get isPlaying() {
    return this.mode === "demo" ? Boolean(this.demo?.playing) : this.mode === "file" && !this.audio.paused;
  }

  get currentTime() {
    return this.mode === "demo" ? this.demo?.elapsed ?? 0 : this.audio.currentTime || 0;
  }

  get duration() {
    return this.mode === "demo" ? DEMO_BEATS * 60 / DEMO_BPM : Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  get analysisTime() {
    return this.context?.currentTime ?? performance.now() / 1000;
  }

  snapshot() {
    return this.analyzer.snapshot(this.analysisTime);
  }

  dispose() {
    this.operationEpoch += 1;
    this.demo?.stop();
    this.audio.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.worklet?.disconnect();
    this.master?.disconnect();
    this.context?.close();
  }
}
