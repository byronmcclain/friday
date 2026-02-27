import { useRef, useEffect } from "react";
import type { VoiceOrbProps, VoiceState, StateColor } from "./types.ts";
import {
  PARTICLE_COUNT,
  SPHERE_RADIUS,
  SPRITE_SIZE,
  TRANSITION_SPEED,
  ARC_SEGMENTS,
  ARC_MAX_LIFE,
  COLORS,
  STATE_COLORS,
  SPARK_COLOR,
} from "./constants.ts";

// --- Particle class (unchanged from POC) ---
class Particle {
  homeX: number;
  homeY: number;
  homeZ: number;
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  baseSize: number;
  size: number;
  baseOpacity: number;
  opacity: number;
  sparked = 0;

  constructor(index: number) {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (index / (PARTICLE_COUNT - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = golden * index;

    this.homeX = Math.cos(theta) * radiusAtY;
    this.homeY = y;
    this.homeZ = Math.sin(theta) * radiusAtY;
    this.x = this.homeX;
    this.y = this.homeY;
    this.z = this.homeZ;
    this.baseSize = 0.4 + Math.random() * 0.6;
    this.size = this.baseSize;
    this.baseOpacity = 0.5 + Math.random() * 0.5;
    this.opacity = this.baseOpacity;
  }

  project(cx: number, cy: number, radius: number) {
    const perspective = 2;
    const scale = perspective / (perspective + this.z);
    const px = cx + this.x * radius * scale;
    const py = cy - this.y * radius * scale;
    const depth = (this.z + 1) / 2;
    return { px, py, depth, scale };
  }
}

// --- Sprite cache ---
const spriteCache = new Map<string, HTMLCanvasElement>();

function getSprite(r: number, g: number, b: number): HTMLCanvasElement {
  const key = `${r},${g},${b}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const c = document.createElement("canvas");
  c.width = SPRITE_SIZE;
  c.height = SPRITE_SIZE;
  const sCtx = c.getContext("2d")!;
  const half = SPRITE_SIZE / 2;
  const grad = sCtx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  spriteCache.set(key, c);
  return c;
}

// --- Arc type ---
interface Arc {
  points: Array<{ x: number; y: number }>;
  life: number;
}

export function VoiceOrb({ state, whisperMode, muted, speedMultiplier, sessionEnded }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Store props in refs for the animation loop
  const stateRef = useRef<VoiceState>(state);
  stateRef.current = state;
  const whisperRef = useRef(whisperMode);
  whisperRef.current = whisperMode;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;
  const endedRef = useRef(sessionEnded);
  endedRef.current = sessionEnded;

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    // --- Mutable engine state (lives in closure, not React state) ---
    let centerX = 0;
    let centerY = 0;
    let orbRadius = 0;
    let stateTransition = 1;
    let rafId = 0;
    let lastTime = performance.now();
    const arcs: Arc[] = [];

    // --- Particles ---
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(new Particle(i));
    }

    // --- Circuit board (offscreen canvas) ---
    const circuitCanvas = document.createElement("canvas");
    const circuitCtx = circuitCanvas.getContext("2d")!;

    function drawCircuitBoard() {
      const dpr = window.devicePixelRatio || 1;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      circuitCanvas.width = vw * dpr;
      circuitCanvas.height = vh * dpr;
      circuitCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      circuitCtx.clearRect(0, 0, vw, vh);

      const cx = vw / 2;
      const cy = vh / 2;
      const maxDist = Math.sqrt(cx * cx + cy * cy);

      let seed = 42;
      function sr() {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      }

      function alphaAt(x: number, y: number) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        return Math.max(0.15, 0.7 * (1 - (dist / maxDist) * 0.7));
      }

      function traceLine(x1: number, y1: number, x2: number, y2: number, width: number, bright: boolean) {
        const midA = alphaAt((x1 + x2) / 2, (y1 + y2) / 2);
        const a = bright ? Math.min(midA * 1.4, 0.9) : midA;
        circuitCtx.beginPath();
        circuitCtx.moveTo(x1, y1);
        circuitCtx.lineTo(x2, y2);
        circuitCtx.strokeStyle = `rgba(180, 125, 60, ${a})`;
        circuitCtx.lineWidth = width;
        circuitCtx.stroke();
      }

      function drawPad(x: number, y: number, r: number) {
        const a = alphaAt(x, y);
        circuitCtx.beginPath();
        circuitCtx.arc(x, y, r, 0, Math.PI * 2);
        circuitCtx.fillStyle = `rgba(180, 125, 60, ${a * 0.8})`;
        circuitCtx.fill();
      }

      function perps(dx: number, dy: number) {
        if (dx !== 0 && dy !== 0) return [{ dx, dy: 0 }, { dx: 0, dy }];
        if (dx !== 0) return [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
        return [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }];
      }

      // Layer 1: Radial bus lines
      const busAngles = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330];
      for (const deg of busAngles) {
        const rad = (deg * Math.PI) / 180;
        const startR = 30 + sr() * 40;
        const endR = maxDist * (0.7 + sr() * 0.3);
        const sx = cx + Math.cos(rad) * startR;
        const sy = cy + Math.sin(rad) * startR;
        const ex = cx + Math.cos(rad) * endR;
        const ey = cy + Math.sin(rad) * endR;
        const isBright = deg % 90 === 0;
        traceLine(sx, sy, ex, ey, isBright ? 1.2 : 0.8, isBright);
        drawPad(ex, ey, 2.5);
        drawPad(sx, sy, 2);

        if (sr() > 0.3) {
          const px = -Math.sin(rad) * (8 + sr() * 6);
          const py = Math.cos(rad) * (8 + sr() * 6);
          const pStartR = startR + 20 + sr() * 40;
          const pEndR = endR * (0.5 + sr() * 0.4);
          traceLine(
            cx + Math.cos(rad) * pStartR + px, cy + Math.sin(rad) * pStartR + py,
            cx + Math.cos(rad) * pEndR + px, cy + Math.sin(rad) * pEndR + py,
            0.6, false,
          );
        }
      }

      // Layer 2: Branching trace networks
      const dirs8 = [
        { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
        { dx: 1, dy: 1 }, { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 },
      ];
      for (const baseDir of dirs8) {
        const traceCount = 5 + Math.floor(sr() * 4);
        for (let t = 0; t < traceCount; t++) {
          let x = cx + baseDir.dx * (30 + sr() * 50);
          let y = cy + baseDir.dy * (30 + sr() * 50);
          const spread = (t - traceCount / 2) * (10 + sr() * 8);
          if (baseDir.dx === 0) x += spread;
          else if (baseDir.dy === 0) y += spread;
          else { x += spread * 0.5; y -= spread * 0.5; }

          let dx = baseDir.dx;
          let dy = baseDir.dy;
          const segments = 6 + Math.floor(sr() * 8);

          for (let s = 0; s < segments; s++) {
            const len = 20 + sr() * 50;
            const diag = dx !== 0 && dy !== 0 ? 0.707 : 1;
            const nx = x + dx * len * diag;
            const ny = y + dy * len * diag;
            if (nx < -20 || nx > vw + 20 || ny < -20 || ny > vh + 20) break;

            traceLine(x, y, nx, ny, 0.7 + sr() * 0.4, false);
            if (s > 0 && sr() > 0.5) drawPad(x, y, 1.5 + sr() * 1.5);
            x = nx;
            y = ny;

            if (sr() > 0.5) {
              const turns = perps(dx, dy);
              const pick = turns[Math.floor(sr() * turns.length)]!;
              dx = pick.dx;
              dy = pick.dy;
            }

            if (sr() > 0.65) {
              const turns = perps(dx, dy);
              const bd = turns[Math.floor(sr() * turns.length)]!;
              const bLen = 10 + sr() * 20;
              const bDiag = bd.dx !== 0 && bd.dy !== 0 ? 0.707 : 1;
              const bx = x + bd.dx * bLen * bDiag;
              const by = y + bd.dy * bLen * bDiag;
              traceLine(x, y, bx, by, 0.5, false);
              drawPad(bx, by, 1.5);
            }
          }
          drawPad(x, y, 2);
        }
      }

      // Layer 3: Chip zone stubs
      const chipRadius = Math.min(vw, vh) * 0.18;
      for (let i = 0; i < 48; i++) {
        const angle = (i / 48) * Math.PI * 2 + sr() * 0.1;
        const innerR = chipRadius + sr() * 15;
        const outerR = innerR + 15 + sr() * 30;
        const sx = cx + Math.cos(angle) * innerR;
        const sy = cy + Math.sin(angle) * innerR;
        const ex = cx + Math.cos(angle) * outerR;
        const ey = cy + Math.sin(angle) * outerR;
        traceLine(sx, sy, ex, ey, 0.6, false);
        drawPad(ex, ey, 1.5);
      }

      // Layer 4: Scattered pads
      for (let i = 0; i < 40; i++) {
        const px = sr() * vw;
        const py = sr() * vh;
        const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
        if (dist < chipRadius) continue;
        drawPad(px, py, 1 + sr() * 2);
      }
    }

    // --- Resize handler ---
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      canvas.width = vw * dpr;
      canvas.height = vh * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      centerX = vw / 2;
      centerY = vh / 2;
      orbRadius = Math.min(vw, vh) * SPHERE_RADIUS;
      ctx.fillStyle = COLORS.deep;
      ctx.fillRect(0, 0, vw, vh);
      drawCircuitBoard();
    }

    // --- Particle physics ---
    function updateParticles(dt: number) {
      const time = performance.now() * 0.001;
      const currentState = stateRef.current;
      const isMuted = mutedRef.current;
      const isWhisper = whisperRef.current;

      for (const p of particles) {
        let forceX = 0, forceY = 0, forceZ = 0;
        let targetSize = p.baseSize;
        let targetOpacity = p.baseOpacity;

        switch (currentState) {
          case "idle": {
            forceX = (p.homeX - p.x) * 0.0005;
            forceY = (p.homeY - p.y) * 0.0005;
            forceZ = (p.homeZ - p.z) * 0.0005;
            targetOpacity = p.baseOpacity * 0.6;
            break;
          }
          case "listening": {
            const lTargetX = p.homeX * 0.8;
            const lTargetY = p.homeY * 0.8;
            const lTargetZ = p.homeZ * 0.8;
            forceX = (lTargetX - p.x) * 0.001;
            forceY = (lTargetY - p.y) * 0.001;
            forceZ = (lTargetZ - p.z) * 0.001;
            const vibration = Math.sin(time * 20 + p.homeX * 10) * 0.01 * 0.001;
            forceX += vibration;
            forceY += vibration;
            forceZ += vibration;
            targetOpacity = p.baseOpacity * 0.8;
            break;
          }
          case "thinking": {
            const angle = Math.atan2(p.z, p.x);
            const tangentialForce = 0.003;
            forceX += -Math.sin(angle) * tangentialForce;
            forceZ += Math.cos(angle) * tangentialForce;
            forceX += (p.homeX * 0.9 - p.x) * 0.0003;
            forceZ += (p.homeZ * 0.9 - p.z) * 0.0003;
            forceY += (p.homeY - p.y) * 0.0005;
            targetOpacity = p.baseOpacity * 0.9;
            break;
          }
          case "speaking": {
            const expandFactor = 1.3;
            const pulse = Math.sin(time * 6 + p.homeX * 5) * 0.15;
            const targetDist = expandFactor + pulse;
            const sTargetX = p.homeX * targetDist;
            const sTargetY = p.homeY * targetDist;
            const sTargetZ = p.homeZ * targetDist;
            forceX = (sTargetX - p.x) * 0.001;
            forceY = (sTargetY - p.y) * 0.001;
            forceZ = (sTargetZ - p.z) * 0.001;
            targetSize = p.baseSize * 1.15;
            targetOpacity = 0.8 + Math.sin(time * 4) * 0.2;
            break;
          }
          case "error": {
            if (stateTransition < 0.3) {
              forceX = (Math.random() - 0.5) * 0.005;
              forceY = (Math.random() - 0.5) * 0.005;
              forceZ = (Math.random() - 0.5) * 0.005;
            } else {
              forceX = (p.homeX - p.x) * 0.0008;
              forceY = (p.homeY - p.y) * 0.0008;
              forceZ = (p.homeZ - p.z) * 0.0008;
            }
            targetOpacity = p.baseOpacity * 0.5;
            break;
          }
        }

        if (!isMuted && Math.random() < 0.0015) {
          p.size = p.baseSize * 3;
          p.opacity = 1;
          p.sparked = 6;
        }
        if (p.sparked > 0) p.sparked--;

        if (isWhisper) {
          targetSize *= 0.6;
          targetOpacity *= 0.5;
        }

        if (isMuted) {
          forceX = 0;
          forceY = 0;
          forceZ = 0;
          targetOpacity *= 0.3;
        }

        p.vx += forceX * dt + (Math.random() - 0.5) * 0.00002 * dt;
        p.vy += forceY * dt + (Math.random() - 0.5) * 0.00002 * dt;
        p.vz += forceZ * dt + (Math.random() - 0.5) * 0.00002 * dt;
        p.vx *= 0.97;
        p.vy *= 0.97;
        p.vz *= 0.97;
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.size += (targetSize - p.size) * 0.05;
        p.opacity += (targetOpacity - p.opacity) * 0.05;
      }

      if (stateTransition < 1) {
        stateTransition = Math.min(1, stateTransition + TRANSITION_SPEED * dt);
      }
    }

    // --- Ring glow ---
    function drawRing(time: number) {
      const currentState = stateRef.current;
      const isMuted = mutedRef.current;
      const isWhisper = whisperRef.current;
      const ringRadius = orbRadius * 1.15;
      let alpha: number;
      let lineWidth: number;

      switch (currentState) {
        case "idle":
          alpha = 0.15 + Math.sin(time * 0.5) * 0.05;
          lineWidth = 1.5;
          break;
        case "listening":
          alpha = 0.3 + Math.sin(time * Math.PI) * 0.2;
          lineWidth = 2;
          break;
        case "thinking":
          alpha = 0.5;
          lineWidth = 2.5;
          break;
        case "speaking":
          alpha = 0.6 + Math.sin(time * 3) * 0.2;
          lineWidth = 3;
          break;
        case "error":
          alpha = 0.5 * (1 - stateTransition);
          lineWidth = 3;
          break;
        default:
          alpha = 0.15;
          lineWidth = 1.5;
      }

      let colorR: number, colorG: number, colorB: number;
      if (isMuted) {
        colorR = 74; colorG = 74; colorB = 74;
        alpha *= 0.3;
      } else {
        const c = STATE_COLORS[currentState] ?? STATE_COLORS.idle;
        colorR = c.r; colorG = c.g; colorB = c.b;
      }

      if (isWhisper) alpha *= 0.5;

      // Outer glow
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${colorR}, ${colorG}, ${colorB}, ${alpha * 0.15})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Inner ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${colorR}, ${colorG}, ${colorB}, ${Math.min(alpha * 2.5, 1)})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Thinking: spinning arc
      if (currentState === "thinking") {
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, time * 3, time * 3 + Math.PI * 0.6);
        ctx.strokeStyle = `rgba(${colorR}, ${colorG}, ${colorB}, ${Math.min(alpha * 3, 1)})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Speaking: pulse ring
      if (currentState === "speaking") {
        const pulsePhase = (time * 2) % 1;
        const pulseRadius = ringRadius + pulsePhase * orbRadius * 0.3;
        const pulseAlpha = Math.min(alpha * 2.5, 1) * (1 - pulsePhase);
        ctx.beginPath();
        ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${colorR}, ${colorG}, ${colorB}, ${pulseAlpha})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // --- Electron arcs ---
    function spawnArc() {
      const frontParticles = particles.filter(p => p.z > 0);
      if (frontParticles.length < 2) return;
      const a = frontParticles[Math.floor(Math.random() * frontParticles.length)]!;
      let b = a;
      for (let tries = 0; tries < 10; tries++) {
        b = frontParticles[Math.floor(Math.random() * frontParticles.length)]!;
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 0.15 && dist < 0.8) break;
      }
      if (a === b) return;

      const pa = a.project(centerX, centerY, orbRadius);
      const pb = b.project(centerX, centerY, orbRadius);
      const points: Array<{ x: number; y: number }> = [{ x: pa.px, y: pa.py }];

      for (let i = 1; i < ARC_SEGMENTS; i++) {
        const t = i / ARC_SEGMENTS;
        const mx = pa.px + (pb.px - pa.px) * t;
        const my = pa.py + (pb.py - pa.py) * t;
        const dx = pb.px - pa.px;
        const dy = pb.py - pa.py;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = -dy / len;
        const ny = dx / len;
        const jitter = (Math.random() - 0.5) * len * 0.3;
        points.push({ x: mx + nx * jitter, y: my + ny * jitter });
      }
      points.push({ x: pb.px, y: pb.py });
      arcs.push({ points, life: ARC_MAX_LIFE });
    }

    function drawArcs() {
      for (let i = arcs.length - 1; i >= 0; i--) {
        const arc = arcs[i]!;
        const fade = arc.life / ARC_MAX_LIFE;

        ctx.beginPath();
        ctx.moveTo(arc.points[0]!.x, arc.points[0]!.y);
        for (let j = 1; j < arc.points.length; j++) {
          ctx.lineTo(arc.points[j]!.x, arc.points[j]!.y);
        }
        ctx.strokeStyle = `rgba(139, 94, 60, ${fade * 0.12})`;
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(arc.points[0]!.x, arc.points[0]!.y);
        for (let j = 1; j < arc.points.length; j++) {
          ctx.lineTo(arc.points[j]!.x, arc.points[j]!.y);
        }
        ctx.strokeStyle = `rgba(232, 168, 90, ${fade * 0.32})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        arc.life--;
        if (arc.life <= 0) arcs.splice(i, 1);
      }
    }

    // --- Main render loop ---
    function render(now: number) {
      const dt = (now - lastTime) * speedRef.current;
      lastTime = now;

      updateParticles(dt);

      const w = window.innerWidth;
      const h = window.innerHeight;

      // Trail effect
      ctx.fillStyle = "rgba(13, 17, 23, 0.15)";
      ctx.fillRect(0, 0, w, h);

      // Stamp circuit board
      ctx.globalAlpha = 0.06;
      ctx.drawImage(circuitCanvas, 0, 0, w, h);
      ctx.globalAlpha = 1;

      // Sort back to front
      particles.sort((a, b) => a.z - b.z);

      // Get state color + sprites
      const sc = STATE_COLORS[stateRef.current] ?? STATE_COLORS.idle;
      const sprite = getSprite(sc.r, sc.g, sc.b);
      const sparkSprite = getSprite(SPARK_COLOR.r, SPARK_COLOR.g, SPARK_COLOR.b);

      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const { px, py, depth, scale } = p.project(centerX, centerY, orbRadius);
        const size = p.size * scale * (orbRadius / 140);
        const alpha = p.opacity * (0.3 + depth * 0.7);
        if (size < 0.2) continue;
        const drawSize = size * 2.4;
        ctx.globalAlpha = alpha;
        ctx.drawImage(p.sparked > 0 ? sparkSprite : sprite, px - drawSize, py - drawSize, drawSize * 2, drawSize * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // Arcs
      const currentState = stateRef.current;
      const arcStates: VoiceState[] = ["idle", "listening", "speaking"];
      if (!mutedRef.current && !endedRef.current && arcStates.includes(currentState) && Math.random() < 0.03) {
        spawnArc();
      }
      drawArcs();

      // Ring
      const time = performance.now() * 0.001;
      drawRing(time);

      rafId = requestAnimationFrame(render);
    }

    // --- Track state transitions for stateTransition lerp ---
    let prevState = stateRef.current;
    const stateCheckInterval = setInterval(() => {
      if (stateRef.current !== prevState) {
        prevState = stateRef.current;
        stateTransition = 0;
      }
    }, 16);

    // --- Init ---
    resize();
    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(stateCheckInterval);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
