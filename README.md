# POCKET

POCKET is a dependency-free browser MVP that turns music into an expressive procedural dancer. It listens for tempo, beat phase, energy, swing, syncopation, and microtiming—not only volume—and maps those signals to different parts of the body.

## Run it

Requirements: Node.js 20 or newer and a current Chromium, Firefox, or Safari browser.

```bash
npm start
```

Open <http://127.0.0.1:4173>, then either:

- select **Play demo groove** to hear a generated swung rhythm; or
- select **Choose audio** (or drag a file onto the stage) and press Play.

Audio remains local to the browser. No file or analysis result is uploaded.

## Test it

```bash
npm test
```

The tests cover tempo inference, jitter tolerance, beat-grid wraparound, swing, ahead/behind timing, silence rejection, and finite motion output.

## What “pocket” means here

The audio graph uses an `AudioWorklet` to inspect 512-sample windows. A small filter bank separates low, mid, and high-frequency energy proxies. Adaptive spectral-flux thresholds produce onset events, which feed an online tempo and phase estimate.

The MVP summarizes groove with:

- **Pocket offset:** the weighted median timing difference between detected accents and the inferred sixteenth-note grid.
- **Swing:** how far repeated offbeat accents sit beyond a straight 50% eighth-note position.
- **Syncopation:** how much accent weight falls away from quarter-note positions.
- **Lock:** combined beat and pocket confidence. Low confidence intentionally produces a calm sway instead of jitter.

Feet and knees follow the beat and low frequencies, hips respond to bass weight, shoulders respond to midrange accents, and hands respond to high-frequency transients. Motion is smoothed so the dancer carries momentum between events.

## MVP boundaries

- Frequency bands are instrument proxies, not separated stems.
- Beat tracking is intentionally conservative and needs several seconds of rhythmic evidence.
- Odd meter, extreme tempo changes, drumless passages, and very dense mixes can reduce lock confidence.
- YouTube URLs are not accepted in this version. Browser pages do not reliably expose cross-origin audio samples; local files provide a dependable and honest first release.
- Codec support depends on the browser and operating system.

## Project structure

```text
index.html                  App shell and accessible controls
styles.css                 Responsive visual system
src/app.js                 UI state and lifecycle
src/audio-engine.js        Web Audio graph and demo sequencer
src/pocket-processor.js    AudioWorklet filter-bank analysis
src/groove-analysis.js     Beat and pocket inference
src/dancer.js              Procedural choreography and canvas renderer
scripts/serve.mjs          Dependency-free local server
tests/                     Deterministic analysis tests
```
