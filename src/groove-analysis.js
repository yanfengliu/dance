export const clamp = (value, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));

export const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function weightedMedian(samples) {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, sample) => sum + Math.max(0, sample.weight), 0);
  if (totalWeight <= 0) return median(sorted.map((sample) => sample.value));

  let accumulated = 0;
  for (const sample of sorted) {
    accumulated += Math.max(0, sample.weight);
    if (accumulated >= totalWeight / 2) return sample.value;
  }
  return sorted.at(-1).value;
}

export function circularDistance(value, period) {
  return mod(value + period / 2, period) - period / 2;
}

export function gridResidualMs(time, epoch, period, divisions = 4) {
  if (!(period > 0) || !(divisions > 0)) return 0;
  const grid = period / divisions;
  return (circularDistance(time - epoch, grid) * 1000);
}

function eventValue(event) {
  return typeof event === "number" ? { time: event, strength: 1 } : event;
}

export function estimateTempo(inputEvents, previousBpm = 0) {
  const events = inputEvents.map(eventValue).filter((event) => Number.isFinite(event.time));
  if (events.length < 5) return { bpm: previousBpm || 0, confidence: 0, score: 0 };

  const scores = [];
  for (let bpm = 70; bpm <= 180; bpm += 1) {
    const period = 60 / bpm;
    let score = 0;
    let comparisons = 0;

    for (let right = 1; right < events.length; right += 1) {
      for (let left = Math.max(0, right - 10); left < right; left += 1) {
        const delta = events[right].time - events[left].time;
        if (delta < 0.16 || delta > 4.2) continue;

        const sixteenthUnits = Math.round((delta / period) * 4);
        if (sixteenthUnits < 1 || sixteenthUnits > 48) continue;

        const expected = sixteenthUnits * period / 4;
        const tolerance = Math.max(0.014, period * 0.045);
        const error = delta - expected;
        const alignment = Math.exp(-0.5 * (error / tolerance) ** 2);
        const hierarchy = sixteenthUnits % 4 === 0 ? 1 : sixteenthUnits % 2 === 0 ? 0.67 : 0.36;
        const strength = Math.sqrt(
          clamp(events[left].strength ?? 1, 0.05, 2) * clamp(events[right].strength ?? 1, 0.05, 2)
        );
        score += alignment * hierarchy * strength / Math.sqrt(Math.max(1, sixteenthUnits / 4));
        comparisons += 1;
      }
    }

    const continuity = previousBpm > 0
      ? 0.78 + 0.22 * Math.exp(-0.5 * ((bpm - previousBpm) / 9) ** 2)
      : 0.96 + 0.04 * Math.exp(-0.5 * ((bpm - 110) / 34) ** 2);
    const highTempoPenalty = bpm > 158 ? 0.84 : 1;
    scores.push({ bpm, score: score * continuity * highTempoPenalty, comparisons });
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const rival = scores.find((candidate) => Math.abs(candidate.bpm - best.bpm) > 4) ?? scores[1];
  const evidence = clamp((events.length - 4) / 16);
  const contrast = best.score > 0 ? clamp((best.score - (rival?.score ?? 0) * 0.82) / best.score) : 0;
  const density = clamp(best.score / Math.max(8, events.length * 1.25));
  const confidence = clamp(evidence * (0.34 + contrast * 0.42 + density * 0.5));

  return { bpm: best.score > 0 ? best.bpm : previousBpm || 0, confidence, score: best.score };
}

export function estimatePhase(events, period) {
  if (!(period > 0) || !events.length) return 0;
  const bassEvents = events.filter((event) => (event.low ?? 0) >= 0.16);
  const source = bassEvents.length >= 3 ? bassEvents : events;
  let bestOffset = mod(source[0].time, period);
  let bestScore = -Infinity;

  for (let step = 0; step < 48; step += 1) {
    const offset = step * period / 48;
    let score = 0;
    for (const event of source) {
      const residual = circularDistance(event.time - offset, period);
      const strength = clamp(event.strength ?? 1, 0.05, 2);
      const bassWeight = 0.7 + clamp(event.low ?? 0) * 0.8;
      score += Math.exp(-0.5 * (residual / (period * 0.075)) ** 2) * strength * bassWeight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

export function classifyPocket(offsetMs, swing = 0, syncopation = 0) {
  if (swing >= 0.38) return "swung";
  if (syncopation >= 0.58) return "syncopated";
  if (offsetMs >= 14) return "laid-back";
  if (offsetMs <= -14) return "driving";
  return "centered";
}

export function summarizePocket(inputEvents, beat) {
  if (!(beat?.period > 0) || (beat.confidence ?? 0) < 0.18) {
    return { offsetMs: 0, swing: 0, syncopation: 0, tightness: 0, label: "listening", confidence: 0 };
  }

  const cutoff = (beat.now ?? Infinity) - beat.period * 12;
  const events = inputEvents.map(eventValue).filter((event) => event.time >= cutoff);
  const residuals = [];
  const offbeats = [];
  let syncopatedWeight = 0;
  let totalWeight = 0;

  for (const event of events) {
    const strength = clamp(event.strength ?? 1, 0.05, 2);
    const phase = mod((event.time - beat.epoch) / beat.period, 1);
    const slot = Math.round(phase * 4) % 4;
    const residual = gridResidualMs(event.time, beat.epoch, beat.period, 4);
    const relativeToPulse = clamp((event.mid ?? 0) + (event.high ?? 0) * 0.65 + (event.low ?? 0) * 0.25, 0.12, 2);

    if (Math.abs(residual) <= beat.period * 1000 * 0.11) {
      residuals.push({ value: residual, weight: strength * relativeToPulse });
    }
    if (phase >= 0.36 && phase <= 0.78) offbeats.push({ value: phase, weight: strength });

    const syncWeights = [0, 0.9, 0.42, 0.78];
    syncopatedWeight += syncWeights[slot] * strength;
    totalWeight += strength;
  }

  const offsetMs = clamp(weightedMedian(residuals), -65, 65);
  const offbeatPosition = offbeats.length >= 3 ? weightedMedian(offbeats) : 0.5;
  const swing = offbeats.length >= 3 ? clamp((offbeatPosition - 0.5) / 0.167) : 0;
  const syncopation = totalWeight > 0 ? clamp(syncopatedWeight / totalWeight) : 0;
  const residualSpread = residuals.length
    ? median(residuals.map((sample) => Math.abs(sample.value - offsetMs)))
    : 80;
  const tightness = clamp(1 - residualSpread / 55);
  const evidence = clamp((events.length - 3) / 18);
  const confidence = clamp((beat.confidence ?? 0) * evidence * (0.5 + tightness * 0.5));

  return {
    offsetMs,
    swing,
    syncopation,
    tightness,
    label: classifyPocket(offsetMs, swing, syncopation),
    confidence
  };
}

function normalizeDb(db, floor = -58, ceiling = -8) {
  return clamp((db - floor) / (ceiling - floor));
}

function freshBandState() {
  return { mean: 0.12, deviation: 0.08, refractoryUntil: 0 };
}

export class GrooveAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this.events = [];
    this.previousPowers = null;
    this.bands = { low: freshBandState(), mid: freshBandState(), high: freshBandState() };
    this.latest = { full: -120, low: -120, mid: -120, high: -120 };
    this.features = { energy: 0, low: 0, mid: 0, high: 0, transient: 0 };
    this.beat = { bpm: 0, period: 0, epoch: 0, confidence: 0 };
    this.tempoCandidate = { bpm: 0, confidence: 0, count: 0 };
    this.pocket = { offsetMs: 0, swing: 0, syncopation: 0, tightness: 0, label: "listening", confidence: 0 };
    this.lastFrameTime = null;
    this.lastOnsetTime = -Infinity;
    this.lastTempoScan = -Infinity;
    this.warmupUntil = 0;
  }

  updateFrame(frame) {
    if (!Number.isFinite(frame?.time)) return this.snapshot(0);
    if (this.lastFrameTime !== null && (frame.time <= this.lastFrameTime || frame.time - this.lastFrameTime > 0.28)) {
      this.reset();
    }
    if (this.lastFrameTime === null) this.warmupUntil = frame.time + 0.45;

    const deltaTime = this.lastFrameTime === null ? 0.011 : clamp(frame.time - this.lastFrameTime, 0.004, 0.05);
    this.lastFrameTime = frame.time;
    this.latest = frame;

    const normalized = {
      energy: normalizeDb(frame.full),
      low: normalizeDb(frame.low, -62, -10),
      mid: normalizeDb(frame.mid, -64, -12),
      high: normalizeDb(frame.high, -68, -15)
    };
    const smoothing = 1 - Math.exp(-deltaTime / 0.09);
    for (const key of ["energy", "low", "mid", "high"]) {
      this.features[key] += (normalized[key] - this.features[key]) * smoothing;
    }

    if (this.previousPowers) {
      const detected = { low: 0, mid: 0, high: 0 };
      const refractory = { low: 0.09, mid: 0.065, high: 0.045 };

      for (const name of ["low", "mid", "high"]) {
        const flux = Math.max(0, frame[name] - this.previousPowers[name]);
        const state = this.bands[name];
        const zScore = (flux - state.mean) / Math.max(0.22, state.deviation);
        const isOnset = frame.time >= this.warmupUntil
          && frame.full > -54
          && frame.time >= state.refractoryUntil
          && flux > 0.7
          && zScore > 2.15;

        if (isOnset) {
          detected[name] = clamp((zScore - 2.15) / 4.8, 0.08, 1.5);
          state.refractoryUntil = frame.time + refractory[name];
        }

        const adaptation = 1 - Math.exp(-deltaTime / 1.15);
        const clippedFlux = Math.min(flux, state.mean + Math.max(0.8, state.deviation * 3));
        state.mean += (clippedFlux - state.mean) * adaptation;
        state.deviation += (Math.abs(clippedFlux - state.mean) - state.deviation) * adaptation;
      }

      const strength = Math.max(detected.low * 0.95, detected.mid * 0.78, detected.high * 0.58);
      if (strength > 0) {
        this.events.push({ time: frame.time, strength, ...detected });
        this.lastOnsetTime = frame.time;
        this.features.transient = Math.max(this.features.transient, clamp(strength));
      }
    }

    this.previousPowers = { low: frame.low, mid: frame.mid, high: frame.high };
    this.features.transient *= Math.exp(-deltaTime / 0.105);
    if (frame.full < -58 && frame.time - this.lastOnsetTime > 1.5) {
      this.beat.confidence *= Math.exp(-deltaTime / 1.8);
      this.pocket.confidence *= Math.exp(-deltaTime / 1.8);
    }
    this.events = this.events.filter((event) => event.time >= frame.time - 10);

    if (frame.time - this.lastTempoScan >= 0.24) {
      this.updateTempo(frame.time);
      this.lastTempoScan = frame.time;
    }
    return this.snapshot(frame.time);
  }

  updateTempo(now) {
    const recent = this.events.filter((event) => event.time >= now - 8);
    const challenger = estimateTempo(recent, 0);
    if (!(challenger.bpm > 0)) return;

    if (Math.abs(challenger.bpm - this.tempoCandidate.bpm) <= 2.5) {
      this.tempoCandidate.bpm += (challenger.bpm - this.tempoCandidate.bpm) * 0.35;
      this.tempoCandidate.confidence = challenger.confidence;
      this.tempoCandidate.count += 1;
    } else {
      this.tempoCandidate = { bpm: challenger.bpm, confidence: challenger.confidence, count: 1 };
    }

    if (!(this.beat.period > 0)) {
      const ready = recent.length >= 7
        && challenger.confidence >= 0.12
        && this.tempoCandidate.count >= 2;
      if (!ready) return;
      const period = 60 / challenger.bpm;
      this.beat = {
        bpm: challenger.bpm,
        period,
        epoch: estimatePhase(recent, period),
        confidence: challenger.confidence
      };
    }

    const tempoDifference = Math.abs(challenger.bpm - this.beat.bpm);
    const shouldRelock = tempoDifference > 6
      && challenger.confidence >= Math.max(0.34, this.beat.confidence * 0.72)
      && this.tempoCandidate.count >= 4;

    if (shouldRelock) {
      const period = 60 / challenger.bpm;
      this.beat = {
        bpm: challenger.bpm,
        period,
        epoch: estimatePhase(recent, period),
        confidence: challenger.confidence * 0.86
      };
      this.pocket = {
        offsetMs: 0,
        swing: 0,
        syncopation: 0,
        tightness: 0,
        label: "listening",
        confidence: 0
      };
      this.tempoCandidate.count = 0;
    }

    const estimate = tempoDifference <= 8
      ? estimateTempo(recent, this.beat.bpm)
      : { bpm: this.beat.bpm, confidence: this.beat.confidence };

    const targetPeriod = 60 / estimate.bpm;
    const targetEpoch = estimatePhase(recent, targetPeriod);
    const tempoBlend = 0.08 + estimate.confidence * 0.1;
    this.beat.period += (targetPeriod - this.beat.period) * tempoBlend;
    this.beat.bpm = 60 / this.beat.period;
    const phaseCorrection = circularDistance(targetEpoch - this.beat.epoch, this.beat.period);
    this.beat.epoch += clamp(phaseCorrection, -this.beat.period * 0.12, this.beat.period * 0.12) * 0.22;
    this.beat.confidence += (estimate.confidence - this.beat.confidence) * 0.18;

    const pocket = summarizePocket(recent, { ...this.beat, now });
    const pocketBlend = 0.13;
    this.pocket.offsetMs += (pocket.offsetMs - this.pocket.offsetMs) * pocketBlend;
    this.pocket.swing += (pocket.swing - this.pocket.swing) * pocketBlend;
    this.pocket.syncopation += (pocket.syncopation - this.pocket.syncopation) * pocketBlend;
    this.pocket.tightness += (pocket.tightness - this.pocket.tightness) * pocketBlend;
    this.pocket.confidence += (pocket.confidence - this.pocket.confidence) * pocketBlend;
    this.pocket.label = classifyPocket(this.pocket.offsetMs, this.pocket.swing, this.pocket.syncopation);
  }

  snapshot(now = this.lastFrameTime ?? 0) {
    const hasBeat = this.beat.period > 0 && this.beat.confidence > 0.08;
    const phase = hasBeat ? mod((now - this.beat.epoch) / this.beat.period, 1) : mod(now * 0.72, 1);
    const sinceOnset = now - this.lastOnsetTime;
    const onsetPulse = Number.isFinite(sinceOnset) ? Math.exp(-Math.max(0, sinceOnset) / 0.11) : 0;
    const beatPulse = hasBeat ? Math.exp(-phase / 0.12) : 0;
    return {
      ...this.features,
      transient: Math.max(this.features.transient, onsetPulse),
      bpm: hasBeat ? this.beat.bpm : 0,
      beatPhase: phase,
      beatPulse,
      beatIndex: hasBeat ? Math.floor((now - this.beat.epoch) / this.beat.period) : 0,
      confidence: hasBeat ? clamp(this.beat.confidence) : 0,
      pocketMs: this.pocket.offsetMs,
      pocketLabel: this.pocket.confidence > 0.12 ? this.pocket.label : "listening",
      pocketConfidence: this.pocket.confidence,
      swing: this.pocket.swing,
      syncopation: this.pocket.syncopation,
      tightness: this.pocket.tightness
    };
  }
}
