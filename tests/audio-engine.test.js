import test from "node:test";
import assert from "node:assert/strict";

import { advanceDemoClock, AudioEngine } from "../src/audio-engine.js";

test("demo clock skips a long background gap without scheduling every missed step", () => {
  const sixteenth = (60 / 104) / 4;
  const result = advanceDemoClock(5, 1, 301, sixteenth);
  assert.ok(result.skipped > 1000);
  assert.ok(result.nextStepAt >= 301 - sixteenth);
  assert.ok(result.nextStepAt <= 301 + sixteenth);
  assert.ok(result.step >= 0 && result.step < 32);

  const remainingIterations = Math.ceil((301.14 - result.nextStepAt) / sixteenth);
  assert.ok(remainingIterations <= 2, `expected a bounded catch-up, got ${remainingIterations} iterations`);
});

test("a newer audio action cancels a pending demo start", async () => {
  const audio = { pause() {} };
  const engine = new AudioEngine(audio);
  let releaseContext;
  const contextReady = new Promise((resolve) => { releaseContext = resolve; });
  engine.ensureContext = () => contextReady;

  const pendingStart = engine.startDemo();
  engine.operationEpoch += 1;
  releaseContext({ resume: async () => {} });

  await assert.rejects(pendingStart, (error) => error?.name === "AbortError");
  assert.equal(engine.mode, "idle");
});
