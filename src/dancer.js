import { clamp } from "./groove-analysis.js";

const TAU = Math.PI * 2;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function derivePose(analysis, time, playing = false, reducedMotion = false) {
  const confidence = clamp(analysis.confidence ?? 0);
  const energy = clamp(analysis.energy ?? 0);
  const low = clamp(analysis.low ?? 0);
  const mid = clamp(analysis.mid ?? 0);
  const high = clamp(analysis.high ?? 0);
  const swing = clamp(analysis.swing ?? 0);
  const transient = clamp(analysis.transient ?? 0);
  const phase = clamp(analysis.beatPhase ?? 0);
  const tempoPeriod = analysis.bpm > 0 ? 60 / analysis.bpm : 0.82;
  const pocketShift = clamp((analysis.pocketMs ?? 0) / (tempoPeriod * 1000), -0.11, 0.11);
  const musicalPhase = modUnit(phase - pocketShift);
  const beatAngle = musicalPhase * TAU;
  const lock = playing ? 0.2 + confidence * 0.8 : 0.08;
  const calmSway = Math.sin(time * 0.82) * (playing ? 0.36 : 0.22);
  const pulse = Math.exp(-musicalPhase / 0.12) * lock;
  const alternating = Math.sin(beatAngle * 0.5 + Math.PI / 4);
  const offbeatWarp = Math.sin(beatAngle + swing * Math.sin(beatAngle)) * lock;
  const motionScale = reducedMotion ? 0.2 : 1;

  return {
    bounce: finite((-pulse * 0.78 + Math.sin(beatAngle) * 0.1 * lock) * motionScale),
    sway: finite((calmSway * (1 - confidence * 0.45) + offbeatWarp * 0.36) * motionScale),
    squat: finite((low * 0.72 + pulse * 0.32) * lock * motionScale),
    lean: finite((Math.sin(beatAngle * 0.5 + 0.7) * 0.28 * lock + mid * transient * 0.18) * motionScale),
    step: finite(alternating * (0.25 + energy * 0.75) * lock * motionScale),
    shoulder: finite((Math.sin(beatAngle + Math.PI) * 0.35 * lock + mid * transient * 0.48) * motionScale),
    wrists: finite((Math.sin(beatAngle * 2 + 0.8) * 0.42 * lock + high * transient * 0.7) * motionScale),
    head: finite((Math.sin(time * 1.23) * 0.13 + transient * 0.19) * motionScale),
    width: finite((0.42 + energy * 0.58) * lock * motionScale),
    pulse: finite(pulse * motionScale),
    energy,
    confidence
  };
}

function modUnit(value) {
  return ((value % 1) + 1) % 1;
}

function point(x, y) {
  return { x, y };
}

function mixPoint(start, end, amount) {
  return point(start.x + (end.x - start.x) * amount, start.y + (end.y - start.y) * amount);
}

export class DancerRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.lastTime = 0;
    this.reducedMotion = false;
    this.pose = derivePose({}, 0, false, false);
    this.trails = [];
    this.particles = [];
    this.previousBeatIndex = null;
    this.previousTransient = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
    if (reduced) {
      this.trails = [];
      this.particles = [];
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(analysis, timestamp, playing) {
    this.resize();
    const time = timestamp / 1000;
    const delta = this.lastTime ? clamp(time - this.lastTime, 0.001, 0.05) : 1 / 60;
    this.lastTime = time;
    const target = derivePose(analysis, time, playing, this.reducedMotion);
    const responsiveness = 1 - Math.exp(-delta * (playing ? 7.5 : 3.5));

    for (const key of Object.keys(target)) {
      this.pose[key] = finite(this.pose[key]) + (target[key] - finite(this.pose[key])) * responsiveness;
    }

    if (!this.reducedMotion && playing) {
      const beatChanged = this.previousBeatIndex !== null && analysis.beatIndex !== this.previousBeatIndex;
      const transientHit = analysis.transient > 0.68 && this.previousTransient <= 0.68;
      if (beatChanged || transientHit) this.spawnParticles(beatChanged ? 7 : 3, analysis);
      this.previousBeatIndex = analysis.beatIndex;
      this.previousTransient = analysis.transient;
    }

    this.updateParticles(delta);
    this.draw(analysis, time);
  }

  draw(analysis, time) {
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);
    const centerX = this.width / 2;
    const centerY = Math.min(this.height * 0.5, this.height - 285);
    const scale = Math.min(this.width / 700, this.height / 620) * 1.08;

    this.drawAmbient(context, centerX, centerY, scale, analysis, time);
    const skeleton = this.createSkeleton(centerX, centerY, scale, this.pose);

    if (!this.reducedMotion) {
      this.trails.unshift({ skeleton, life: 1 });
      this.trails = this.trails.slice(0, 5).map((trail) => ({ ...trail, life: trail.life * 0.68 }));
      for (let index = this.trails.length - 1; index >= 1; index -= 1) {
        this.drawSkeleton(context, this.trails[index].skeleton, this.trails[index].life * 0.09, false);
      }
    }

    this.drawSkeleton(context, skeleton, 1, true);
    this.drawParticles(context);
  }

  drawAmbient(context, x, y, scale, analysis, time) {
    const pulse = clamp(this.pose.pulse);
    const energy = clamp(this.pose.energy);
    const haloRadius = (105 + energy * 48 + pulse * 16) * scale;
    const glow = context.createRadialGradient(x, y, 0, x, y, haloRadius * 1.6);
    glow.addColorStop(0, `rgba(142, 120, 255, ${0.09 + energy * 0.08})`);
    glow.addColorStop(0.55, `rgba(142, 120, 255, ${0.035 + pulse * 0.04})`);
    glow.addColorStop(1, "rgba(142, 120, 255, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(x, y, haloRadius * 1.6, 0, TAU);
    context.fill();

    context.save();
    context.translate(x, y);
    context.rotate(-Math.PI / 2);
    for (let beat = 0; beat < 4; beat += 1) {
      const start = beat * TAU / 4 + 0.06;
      const end = (beat + 1) * TAU / 4 - 0.06;
      const active = Math.floor(modUnit(analysis.beatPhase ?? 0) * 4) === beat;
      context.strokeStyle = active ? `rgba(200, 255, 88, ${0.58 + pulse * 0.3})` : "rgba(244, 245, 240, 0.1)";
      context.lineWidth = active ? 2 : 1;
      context.beginPath();
      context.arc(0, 0, haloRadius, start, end);
      context.stroke();
    }
    context.restore();

    context.save();
    context.strokeStyle = "rgba(244, 245, 240, 0.1)";
    context.lineWidth = 1;
    context.beginPath();
    context.ellipse(x, y + 178 * scale, (125 + energy * 28) * scale, 18 * scale, 0, 0, TAU);
    context.stroke();
    context.fillStyle = `rgba(200, 255, 88, ${0.025 + pulse * 0.025})`;
    context.fill();
    context.restore();

    const phaseX = x - 90 * scale + modUnit(analysis.beatPhase ?? time * 0.25) * 180 * scale;
    context.fillStyle = "rgba(200, 255, 88, 0.78)";
    context.beginPath();
    context.arc(phaseX, y + 210 * scale, 2.4, 0, TAU);
    context.fill();
    context.strokeStyle = "rgba(244, 245, 240, 0.12)";
    context.beginPath();
    context.moveTo(x - 90 * scale, y + 210 * scale);
    context.lineTo(x + 90 * scale, y + 210 * scale);
    context.stroke();
  }

  createSkeleton(x, y, scale, pose) {
    const rootX = x + pose.sway * 28 * scale;
    const rootY = y + 48 * scale + (pose.bounce * 23 + pose.squat * 18) * scale;
    const lean = pose.lean * 22 * scale;
    const pelvis = point(rootX, rootY);
    const chest = point(rootX + lean, rootY - (78 - pose.squat * 12) * scale);
    const neck = point(chest.x + pose.head * 8 * scale, chest.y - 31 * scale);
    const head = point(neck.x + pose.head * 8 * scale, neck.y - 24 * scale);

    const shoulderTilt = pose.shoulder * 13 * scale;
    const leftShoulder = point(chest.x - 34 * scale, chest.y - shoulderTilt);
    const rightShoulder = point(chest.x + 34 * scale, chest.y + shoulderTilt);
    const armLift = (28 + pose.width * 55) * scale;
    const wristKick = pose.wrists * 34 * scale;
    const leftHand = point(chest.x - 74 * scale - armLift * 0.5, chest.y + 8 * scale - armLift - wristKick);
    const rightHand = point(chest.x + 74 * scale + armLift * 0.5, chest.y + 8 * scale + armLift * 0.2 + wristKick);
    const leftElbow = point((leftShoulder.x + leftHand.x) / 2 - 14 * scale, (leftShoulder.y + leftHand.y) / 2 + 8 * scale);
    const rightElbow = point((rightShoulder.x + rightHand.x) / 2 + 15 * scale, (rightShoulder.y + rightHand.y) / 2 - 10 * scale);

    const stride = pose.step * 46 * scale;
    const stance = (23 + pose.width * 18) * scale;
    const leftHip = point(pelvis.x - 15 * scale, pelvis.y);
    const rightHip = point(pelvis.x + 15 * scale, pelvis.y);
    const leftFoot = point(pelvis.x - stance + stride, pelvis.y + 137 * scale - Math.max(0, pose.step) * 13 * scale);
    const rightFoot = point(pelvis.x + stance - stride, pelvis.y + 137 * scale - Math.max(0, -pose.step) * 13 * scale);
    const leftKnee = mixPoint(leftHip, leftFoot, 0.52);
    const rightKnee = mixPoint(rightHip, rightFoot, 0.52);
    leftKnee.x -= (17 + pose.squat * 13) * scale;
    rightKnee.x += (17 + pose.squat * 13) * scale;

    return {
      scale,
      pelvis,
      chest,
      neck,
      head,
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
      leftHand,
      rightHand,
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      leftFoot,
      rightFoot
    };
  }

  drawSkeleton(context, skeleton, alpha, detailed) {
    const limb = (start, end, width, color) => {
      context.strokeStyle = color;
      context.lineWidth = width * skeleton.scale;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    };

    context.save();
    context.globalAlpha = alpha;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (detailed) {
      context.shadowColor = "rgba(142, 120, 255, 0.36)";
      context.shadowBlur = 18 * skeleton.scale;
    }

    const violet = detailed ? "#8e78ff" : "rgba(142, 120, 255, 0.9)";
    const pale = detailed ? "#eef0e8" : "rgba(238, 240, 232, 0.8)";
    const lime = detailed ? "#c8ff58" : "rgba(200, 255, 88, 0.8)";
    limb(skeleton.leftHip, skeleton.leftKnee, 13, violet);
    limb(skeleton.leftKnee, skeleton.leftFoot, 11, pale);
    limb(skeleton.rightHip, skeleton.rightKnee, 13, violet);
    limb(skeleton.rightKnee, skeleton.rightFoot, 11, pale);
    limb(skeleton.pelvis, skeleton.chest, 18, violet);
    limb(skeleton.leftShoulder, skeleton.leftElbow, 10, pale);
    limb(skeleton.leftElbow, skeleton.leftHand, 8, lime);
    limb(skeleton.rightShoulder, skeleton.rightElbow, 10, pale);
    limb(skeleton.rightElbow, skeleton.rightHand, 8, lime);
    limb(skeleton.chest, skeleton.neck, 9, pale);

    context.shadowBlur = detailed ? 12 * skeleton.scale : 0;
    for (const joint of [
      skeleton.leftShoulder,
      skeleton.rightShoulder,
      skeleton.leftElbow,
      skeleton.rightElbow,
      skeleton.leftKnee,
      skeleton.rightKnee
    ]) {
      context.fillStyle = pale;
      context.beginPath();
      context.arc(joint.x, joint.y, 4.3 * skeleton.scale, 0, TAU);
      context.fill();
    }

    context.fillStyle = lime;
    for (const hand of [skeleton.leftHand, skeleton.rightHand]) {
      context.beginPath();
      context.arc(hand.x, hand.y, 6.2 * skeleton.scale, 0, TAU);
      context.fill();
    }

    context.fillStyle = "#0c0f15";
    context.strokeStyle = pale;
    context.lineWidth = 7 * skeleton.scale;
    context.beginPath();
    context.arc(skeleton.head.x, skeleton.head.y, 17 * skeleton.scale, 0, TAU);
    context.fill();
    context.stroke();

    context.shadowBlur = 0;
    context.strokeStyle = lime;
    context.lineWidth = 5 * skeleton.scale;
    for (const foot of [skeleton.leftFoot, skeleton.rightFoot]) {
      context.beginPath();
      context.moveTo(foot.x - 5 * skeleton.scale, foot.y);
      context.lineTo(foot.x + 14 * skeleton.scale, foot.y);
      context.stroke();
    }
    context.restore();
  }

  spawnParticles(count, analysis) {
    const centerX = this.width / 2;
    const centerY = Math.min(this.height * 0.5, this.height - 285) + 30;
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI * (0.15 + Math.random() * 0.7);
      const speed = 26 + Math.random() * 58 + clamp(analysis.energy) * 35;
      this.particles.push({
        x: centerX + (Math.random() - 0.5) * 80,
        y: centerY + (Math.random() - 0.5) * 80,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        size: 1.5 + Math.random() * 2.5
      });
    }
    this.particles = this.particles.slice(-32);
  }

  updateParticles(delta) {
    this.particles = this.particles.filter((particle) => {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vy += 26 * delta;
      particle.life -= delta * 1.45;
      return particle.life > 0;
    });
  }

  drawParticles(context) {
    context.save();
    for (const particle of this.particles) {
      context.globalAlpha = particle.life * 0.72;
      context.fillStyle = "#c8ff58";
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  dispose() {
    this.resizeObserver.disconnect();
  }
}
