import test from "node:test";
import assert from "node:assert/strict";

import {
  GrooveAnalyzer,
  classifyPocket,
  estimateTempo,
  gridResidualMs,
  median,
  summarizePocket,
  weightedMedian
} from "../src/groove-analysis.js";
import { derivePose } from "../src/dancer.js";

test("median helpers are deterministic for odd, even, and weighted samples", () => {
  assert.equal(median([9, 1, 4]), 4);
  assert.equal(median([9, 1, 4, 2]), 3);
  assert.equal(weightedMedian([
    { value: -10, weight: 1 },
    { value: 22, weight: 5 },
    { value: 4, weight: 1 }
  ]), 22);
});

test("grid residual wraps cleanly around beat boundaries", () => {
  assert.ok(Math.abs(gridResidualMs(0.49, 0, 0.5, 1) + 10) < 0.001);
  assert.ok(Math.abs(gridResidualMs(0.51, 0, 0.5, 1) - 10) < 0.001);
});

test("tempo estimation locks to a clean 120 BPM pulse", () => {
  const events = Array.from({ length: 20 }, (_, index) => ({ time: index * 0.5, strength: 1 }));
  const result = estimateTempo(events);
  assert.ok(result.bpm >= 118 && result.bpm <= 122, `expected ~120 BPM, got ${result.bpm}`);
  assert.ok(result.confidence > 0.25);
});

test("tempo estimation tolerates jitter and weaker offbeat hits", () => {
  const events = [];
  const beat = 60 / 96;
  for (let index = 0; index < 16; index += 1) {
    const jitter = ((index % 3) - 1) * 0.009;
    events.push({ time: index * beat + jitter, strength: 1 });
    events.push({ time: index * beat + beat * 0.5 + jitter * 0.5, strength: 0.2 });
  }
  const result = estimateTempo(events, 96);
  assert.ok(result.bpm >= 93 && result.bpm <= 99, `expected ~96 BPM, got ${result.bpm}`);
});

test("pocket summary distinguishes swing and late upper-band accents", () => {
  const period = 0.5;
  const swingEvents = [];
  for (let beat = 0; beat < 10; beat += 1) {
    swingEvents.push({ time: beat * period, strength: 1, low: 1, mid: 0, high: 0 });
    swingEvents.push({ time: (beat + 0.66) * period, strength: 0.55, low: 0, mid: 0.5, high: 0.4 });
  }
  const swung = summarizePocket(swingEvents, { period, epoch: 0, confidence: 0.9, now: 5 });
  assert.equal(swung.label, "swung");
  assert.ok(swung.swing > 0.7);

  const lateEvents = [];
  for (let beat = 0; beat < 10; beat += 1) {
    lateEvents.push({ time: beat * period, strength: 0.55, low: 1, mid: 0, high: 0 });
    lateEvents.push({ time: beat * period + 0.024, strength: 1, low: 0, mid: 1, high: 0.4 });
  }
  const late = summarizePocket(lateEvents, { period, epoch: 0, confidence: 0.9, now: 5 });
  assert.ok(late.offsetMs >= 18 && late.offsetMs <= 30, `expected ~24 ms, got ${late.offsetMs}`);
  assert.equal(classifyPocket(late.offsetMs, 0, 0), "laid-back");
});

test("constant silence does not create a beat", () => {
  const analyzer = new GrooveAnalyzer();
  for (let index = 0; index < 800; index += 1) {
    analyzer.updateFrame({ time: index * 0.011, full: -120, low: -120, mid: -120, high: -120 });
  }
  const result = analyzer.snapshot(8.8);
  assert.equal(result.bpm, 0);
  assert.equal(result.confidence, 0);
});

test("reading a snapshot is idempotent", () => {
  const analyzer = new GrooveAnalyzer();
  analyzer.beat = { bpm: 120, period: 0.5, epoch: 0, confidence: 0.72 };
  analyzer.latest = { full: -120, low: -120, mid: -120, high: -120 };
  const first = analyzer.snapshot(4);
  const second = analyzer.snapshot(4);
  assert.equal(first.confidence, second.confidence);
  assert.equal(analyzer.beat.confidence, 0.72);
});

test("online tracking rejects an early harmonic and locks the 104 BPM demo groove", () => {
  const analyzer = new GrooveAnalyzer();
  const bpm = 104;
  const period = 60 / bpm;
  const sixteenth = period / 4;
  const kickSteps = new Set([0, 7, 8, 11, 16, 22, 24, 27]);
  const snareSteps = new Set([4, 12, 20, 28]);
  const events = [];

  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (let step = 0; step < 32; step += 1) {
      const kick = kickSteps.has(step);
      const snare = snareSteps.has(step) || step >= 29;
      const hat = step % 2 === 0 || (step % 4 === 3 && step < 28);
      if (!kick && !snare && !hat) continue;
      events.push({
        time: cycle * 32 * sixteenth + step * sixteenth + (step % 4 === 2 ? period * 0.135 : 0),
        strength: kick ? 1 : snare ? 0.78 : step % 2 === 0 ? 0.48 : 0.18,
        low: kick ? 1 : 0,
        mid: snare ? 1 : 0,
        high: hat ? 0.5 : 0
      });
    }
  }

  for (let now = 0.72; now <= 10; now += 0.24) {
    analyzer.events = events.filter((event) => event.time <= now && event.time >= now - 8);
    analyzer.updateTempo(now);
  }

  const result = analyzer.snapshot(10);
  assert.ok(result.bpm >= 102 && result.bpm <= 106, `expected ~104 BPM, got ${result.bpm}`);
  assert.equal(result.pocketLabel, "swung");
  assert.ok(result.swing > 0.7, `expected strong swing, got ${result.swing}`);
});

test("procedural pose output stays finite for sparse and extreme analysis", () => {
  for (const input of [
    {},
    { bpm: 120, beatPhase: 0.5, confidence: 1, energy: 1, low: 1, mid: 1, high: 1, pocketMs: 70 },
    { bpm: Number.NaN, beatPhase: Number.POSITIVE_INFINITY, confidence: -10 }
  ]) {
    const pose = derivePose(input, 12.5, true, false);
    for (const [key, value] of Object.entries(pose)) {
      assert.ok(Number.isFinite(value), `${key} should be finite`);
    }
  }
});
