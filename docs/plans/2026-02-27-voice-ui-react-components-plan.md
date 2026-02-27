# Voice UI React Components — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the voice conversation UI POC (`poc/voice-ui/index.html`) into React components within the existing Friday web app, preserving Canvas rendering performance.

**Architecture:** Single `<VoiceOrb>` component owns the canvas and runs the full render loop imperatively via `useRef` + `useEffect`. A `useVoiceState()` hook manages all state (state machine, auto-demo, controls). Thin DOM components wrap the controls and status text. Props flow from hook → components, with the canvas reading from refs to avoid re-render overhead.

**Tech Stack:** React 19, TypeScript (strict), Vite, Tailwind 4, Canvas 2D API

**Design:** `docs/plans/2026-02-27-voice-ui-react-components-design.md`

---

### Task 1: Types and Constants

**Files:**
- Create: `web/src/components/voice/types.ts`
- Create: `web/src/components/voice/constants.ts`

**Context:** These are the shared foundation that every other file imports. Extract all magic numbers, color definitions, and type declarations from the POC into typed TypeScript modules. The POC uses plain JS objects and string constants — we need proper union types and `as const` objects.

**Step 1: Create the types file**

Create `web/src/components/voice/types.ts`:

```typescript
export type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

export interface VoiceOrbProps {
  state: VoiceState;
  whisperMode: boolean;
  muted: boolean;
  speedMultiplier: number;
  sessionEnded: boolean;
}

export interface VoiceControlsProps {
  whisperMode: boolean;
  muted: boolean;
  sessionEnded: boolean;
  onToggleWhisper: () => void;
  onToggleMute: () => void;
  onEndSession: () => void;
}

export interface VoiceDevControlsProps {
  currentState: VoiceState;
  speedMultiplier: number;
  onForceState: (state: VoiceState) => void;
  onSetSpeed: (speed: number) => void;
  onResumeAutoDemo: () => void;
}

export interface VoiceStatusProps {
  text: string;
  isTyping: boolean;
  speedMultiplier: number;
}

export interface StateColor {
  r: number;
  g: number;
  b: number;
}
```

**Step 2: Create the constants file**

Create `web/src/components/voice/constants.ts`:

```typescript
import type { VoiceState, StateColor } from "./types.ts";

export const VOICE_STATES: Record<string, VoiceState> = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  ERROR: "error",
} as const;

export const COLORS = {
  deep: "#0D1117",
  amber: "#E8943A",
  amberLight: "#FFD090",
  copper: "#C47A3A",
  text: "#F0E6D8",
  textDim: "#6B5540",
  error: "#F87171",
} as const;

export const PARTICLE_COUNT = 1000;
export const SPHERE_RADIUS = 0.35;
export const SPRITE_SIZE = 64;
export const TRANSITION_SPEED = 0.002;

export const ARC_SEGMENTS = 6;
export const ARC_MAX_LIFE = 12;

export const STATE_COLORS: Record<VoiceState, StateColor> = {
  idle: { r: 232, g: 148, b: 58 },
  listening: { r: 232, g: 148, b: 58 },
  thinking: { r: 196, g: 122, b: 58 },
  speaking: { r: 255, g: 208, b: 144 },
  error: { r: 248, g: 113, b: 113 },
};

export const SPARK_COLOR = { r: 139, g: 94, b: 60 };

export const DEMO_RESPONSES = [
  "I found 3 unread emails from today.",
  "Your Docker containers are all healthy.",
  "The build passed. 957 tests, zero failures.",
  "Checking your calendar... you're free until 3pm.",
  "I've summarized the PR — 4 files changed, 2 comments.",
];

export const DEMO_SCHEDULE: Array<{
  state: VoiceState;
  duration: number;
  status: string | null;
  typewriter: boolean;
}> = [
  { state: "idle", duration: 3000, status: "Ready.", typewriter: false },
  { state: "listening", duration: 3000, status: "Listening...", typewriter: false },
  { state: "thinking", duration: 2000, status: "Processing...", typewriter: false },
  { state: "speaking", duration: 4000, status: null, typewriter: true },
  { state: "idle", duration: 2000, status: "", typewriter: false },
];

export const STATUS_FOR_STATE: Record<VoiceState, string> = {
  idle: "Ready.",
  listening: "Listening...",
  thinking: "Processing...",
  speaking: "",
  error: "Error.",
};
```

**Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors related to the new files (there may be pre-existing errors — only check for errors in `voice/types.ts` or `voice/constants.ts`).

**Step 4: Commit**

```bash
git add web/src/components/voice/types.ts web/src/components/voice/constants.ts
git commit -m "feat(voice-ui): add types and constants for voice components"
```

---

### Task 2: useVoiceState Hook

**Files:**
- Create: `web/src/components/voice/useVoiceState.ts`
- Reference: `web/src/components/voice/constants.ts` (DEMO_SCHEDULE, DEMO_RESPONSES, STATUS_FOR_STATE)
- Reference: `web/src/components/voice/types.ts` (VoiceState)

**Context:** This hook is the single source of truth for all voice UI state. It manages the state machine (5 states), auto-demo cycle (timed transitions with canned responses), status text (including typewriter character-by-character reveal), and control toggles (whisper, mute, end session). The POC handles all of this with global variables and DOM manipulation — we need to translate that into React state + effects.

Key behaviors to preserve:
- Auto-demo cycles through IDLE → LISTENING → THINKING → SPEAKING → IDLE on a timer
- SPEAKING state triggers typewriter effect on the response text
- Dev force-state buttons interrupt auto-demo and hold the forced state
- Resume button restarts the auto-demo cycle from the beginning
- Speed multiplier affects both demo timing and typewriter speed
- End session stops everything, triggers ERROR state briefly, then fades particles

**Step 1: Create the hook**

Create `web/src/components/voice/useVoiceState.ts`:

```typescript
import { useState, useRef, useEffect, useCallback } from "react";
import type { VoiceState } from "./types.ts";
import { DEMO_SCHEDULE, DEMO_RESPONSES, STATUS_FOR_STATE } from "./constants.ts";

export interface UseVoiceStateReturn {
  state: VoiceState;
  statusText: string;
  isTyping: boolean;
  whisperMode: boolean;
  muted: boolean;
  sessionEnded: boolean;
  speedMultiplier: number;
  voiceName: string;
  toggleWhisper: () => void;
  toggleMute: () => void;
  endSession: () => void;
  forceState: (state: VoiceState) => void;
  setSpeed: (speed: number) => void;
  resumeAutoDemo: () => void;
}

export function useVoiceState(): UseVoiceStateReturn {
  const [state, setState] = useState<VoiceState>("idle");
  const [statusText, setStatusText] = useState("Ready.");
  const [isTyping, setIsTyping] = useState(false);
  const [whisperMode, setWhisperMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  const autoDemoRef = useRef(true);
  const demoStepRef = useRef(0);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const responseIndexRef = useRef(0);
  const speedRef = useRef(1);

  // Keep speedRef in sync
  speedRef.current = speedMultiplier;

  const clearTypewriter = useCallback(() => {
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
  }, []);

  const clearDemoTimer = useCallback(() => {
    if (demoTimerRef.current) {
      clearTimeout(demoTimerRef.current);
      demoTimerRef.current = null;
    }
  }, []);

  const setStatusWithTypewriter = useCallback((text: string, typewriter: boolean) => {
    clearTypewriter();
    if (typewriter && text.length > 0) {
      setIsTyping(true);
      let charIndex = 0;
      setStatusText("");
      typewriterTimerRef.current = setInterval(() => {
        charIndex++;
        setStatusText(text.slice(0, charIndex));
        if (charIndex >= text.length) {
          clearInterval(typewriterTimerRef.current!);
          typewriterTimerRef.current = null;
          setIsTyping(false);
        }
      }, 30 / speedRef.current);
    } else {
      setIsTyping(false);
      setStatusText(text);
    }
  }, [clearTypewriter]);

  const runDemoStep = useCallback(() => {
    if (!autoDemoRef.current) return;

    const step = DEMO_SCHEDULE[demoStepRef.current % DEMO_SCHEDULE.length]!;
    setState(step.state);

    if (step.state === "speaking") {
      const response = DEMO_RESPONSES[responseIndexRef.current % DEMO_RESPONSES.length]!;
      responseIndexRef.current++;
      setStatusWithTypewriter(response, true);
    } else {
      setStatusWithTypewriter(step.status ?? "", step.typewriter);
    }

    demoStepRef.current++;
    demoTimerRef.current = setTimeout(runDemoStep, step.duration / speedRef.current);
  }, [setStatusWithTypewriter]);

  // Start auto-demo on mount
  useEffect(() => {
    runDemoStep();
    return () => {
      clearDemoTimer();
      clearTypewriter();
    };
  }, [runDemoStep, clearDemoTimer, clearTypewriter]);

  const toggleWhisper = useCallback(() => {
    if (sessionEnded) return;
    setWhisperMode(prev => !prev);
  }, [sessionEnded]);

  const toggleMute = useCallback(() => {
    if (sessionEnded) return;
    setMuted(prev => {
      const newMuted = !prev;
      if (!autoDemoRef.current) {
        setStatusText(newMuted ? "Muted" : "Ready.");
      }
      return newMuted;
    });
  }, [sessionEnded]);

  const endSession = useCallback(() => {
    if (sessionEnded) return;
    setSessionEnded(true);
    autoDemoRef.current = false;
    clearDemoTimer();
    clearTypewriter();
    setState("error");
    setStatusText("Session ended.");
  }, [sessionEnded, clearDemoTimer, clearTypewriter]);

  const forceState = useCallback((newState: VoiceState) => {
    if (sessionEnded) return;
    autoDemoRef.current = false;
    clearDemoTimer();
    clearTypewriter();
    setState(newState);
    setStatusText(STATUS_FOR_STATE[newState]);
    setIsTyping(false);
  }, [sessionEnded, clearDemoTimer, clearTypewriter]);

  const setSpeed = useCallback((speed: number) => {
    setSpeedMultiplier(speed);
  }, []);

  const resumeAutoDemo = useCallback(() => {
    if (sessionEnded) return;
    autoDemoRef.current = true;
    demoStepRef.current = 0;
    clearDemoTimer();
    clearTypewriter();
    runDemoStep();
  }, [sessionEnded, clearDemoTimer, clearTypewriter, runDemoStep]);

  const voiceName = whisperMode ? "Eve \u00B7 Whisper" : "Eve \u00B7 On";

  return {
    state,
    statusText,
    isTyping,
    whisperMode,
    muted,
    sessionEnded,
    speedMultiplier,
    voiceName,
    toggleWhisper,
    toggleMute,
    endSession,
    forceState,
    setSpeed,
    resumeAutoDemo,
  };
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors in `voice/useVoiceState.ts`.

**Step 3: Commit**

```bash
git add web/src/components/voice/useVoiceState.ts
git commit -m "feat(voice-ui): add useVoiceState hook with state machine and auto-demo"
```

---

### Task 3: VoiceOrb Canvas Component

**Files:**
- Create: `web/src/components/voice/VoiceOrb.tsx`
- Reference: `web/src/components/voice/types.ts` (VoiceOrbProps, VoiceState, StateColor)
- Reference: `web/src/components/voice/constants.ts` (all particle/rendering constants)
- Reference: `poc/voice-ui/index.html:294-953` (the entire canvas engine to port)

**Context:** This is the largest and most performance-critical component. It ports the entire Canvas rendering pipeline from the POC: particle system (1000 particles with physics), circuit board background (offscreen canvas, seeded PRNG), ring glow effect, and electron arcs. The key pattern is storing React props in refs so the `requestAnimationFrame` loop reads current values without triggering re-renders.

The POC's render pipeline per frame is:
1. Trail clear (semi-transparent fill for motion blur)
2. Circuit board stamp (offscreen canvas → drawImage at 0.06 alpha)
3. Sort particles back-to-front by Z
4. Draw particles (sprite cache, additive blending)
5. Spawn + draw electron arcs
6. Draw ring glow

All of this must run inside a single `useEffect` with `[]` deps (mount only). Cleanup cancels the animation frame.

**Step 1: Create the VoiceOrb component**

Create `web/src/components/voice/VoiceOrb.tsx`:

```tsx
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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
```

**Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors in `voice/VoiceOrb.tsx`.

**Step 3: Commit**

```bash
git add web/src/components/voice/VoiceOrb.tsx
git commit -m "feat(voice-ui): add VoiceOrb canvas component with full render pipeline"
```

---

### Task 4: VoiceStatus Component

**Files:**
- Create: `web/src/components/voice/VoiceStatus.tsx`
- Reference: `web/src/components/voice/types.ts` (VoiceStatusProps)
- Modify: `web/src/index.css` (add ellipsis keyframe animation)

**Context:** The status text area sits below the orb and displays state-dependent text. It has two special modes: a typewriter effect (character by character reveal for SPEAKING responses) and an animated ellipsis for "Listening...". The typewriter logic lives in `useVoiceState` (it updates `statusText` character by character). This component just renders what it receives, plus handles the ellipsis CSS animation when the text is "Listening...".

**Step 1: Add the ellipsis keyframe to index.css**

Add to `web/src/index.css` after the existing `.friday-glow` rule:

```css
/* Voice UI: ellipsis breathing animation */
@keyframes voice-ellipsis-fade {
  0%, 80%, 100% { opacity: 0; }
  40% { opacity: 1; }
}

.voice-ellipsis span {
  opacity: 0;
  animation: voice-ellipsis-fade 1.4s infinite;
}

.voice-ellipsis span:nth-child(1) { animation-delay: 0s; }
.voice-ellipsis span:nth-child(2) { animation-delay: 0.2s; }
.voice-ellipsis span:nth-child(3) { animation-delay: 0.4s; }
```

**Step 2: Create VoiceStatus component**

Create `web/src/components/voice/VoiceStatus.tsx`:

```tsx
import type { VoiceStatusProps } from "./types.ts";

export function VoiceStatus({ text, isTyping }: VoiceStatusProps) {
  const isListening = text === "Listening..." || text === "Listening";
  const visible = text.length > 0;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 text-center text-[0.9rem] min-h-[1.4em] z-10 transition-opacity duration-300"
      style={{
        bottom: "140px",
        color: "var(--color-friday-text, #F0E6D8)",
        opacity: visible ? 1 : 0,
      }}
    >
      {isListening ? (
        <>
          Listening
          <span className="voice-ellipsis">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </>
      ) : (
        <>
          {text}
          {isTyping && <span className="animate-pulse">|</span>}
        </>
      )}
    </div>
  );
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add web/src/components/voice/VoiceStatus.tsx web/src/index.css
git commit -m "feat(voice-ui): add VoiceStatus component with typewriter and ellipsis"
```

---

### Task 5: VoiceControls Component

**Files:**
- Create: `web/src/components/voice/VoiceControls.tsx`
- Reference: `web/src/components/voice/types.ts` (VoiceControlsProps)

**Context:** Three pill buttons: Whisper (toggle), Mute (toggle), End Session. These mirror the POC's control bar. Styling uses Tailwind classes matching the POC's CSS. The control bar is nearly transparent (opacity 0.15) until hovered.

**Step 1: Create VoiceControls component**

Create `web/src/components/voice/VoiceControls.tsx`:

```tsx
import type { VoiceControlsProps } from "./types.ts";

export function VoiceControls({
  whisperMode,
  muted,
  sessionEnded,
  onToggleWhisper,
  onToggleMute,
  onEndSession,
}: VoiceControlsProps) {
  return (
    <div
      className="fixed bottom-10 left-1/2 -translate-x-1/2 flex gap-3 z-10 opacity-15 hover:opacity-100 transition-opacity duration-300"
    >
      <button
        type="button"
        onClick={onToggleWhisper}
        disabled={sessionEnded}
        className={`px-5 py-2 rounded-full text-[0.85rem] cursor-pointer border transition-colors duration-200 select-none
          ${whisperMode
            ? "bg-[#E8943A] text-[#0D1117] border-[#E8943A]"
            : "bg-transparent text-[#E8943A] border-[#E8943A] hover:bg-[#E8943A] hover:text-[#0D1117]"
          } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        Whisper
      </button>
      <button
        type="button"
        onClick={onToggleMute}
        disabled={sessionEnded}
        className={`px-5 py-2 rounded-full text-[0.85rem] cursor-pointer border transition-colors duration-200 select-none
          ${muted
            ? "border-[#F87171] text-[#F87171] hover:bg-[#F87171] hover:text-[#0D1117]"
            : "bg-transparent text-[#E8943A] border-[#E8943A] hover:bg-[#E8943A] hover:text-[#0D1117]"
          } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        {muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        onClick={onEndSession}
        disabled={sessionEnded}
        className="px-5 py-2 rounded-full text-[0.85rem] cursor-pointer border border-[#F87171] text-[#F87171] bg-transparent hover:bg-[#F87171] hover:text-[#0D1117] transition-colors duration-200 select-none disabled:opacity-30 disabled:cursor-not-allowed"
      >
        End Session
      </button>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add web/src/components/voice/VoiceControls.tsx
git commit -m "feat(voice-ui): add VoiceControls pill button component"
```

---

### Task 6: VoiceDevControls Component

**Files:**
- Create: `web/src/components/voice/VoiceDevControls.tsx`
- Reference: `web/src/components/voice/types.ts` (VoiceDevControlsProps, VoiceState)

**Context:** Dev-only overlay with 4 state-force buttons (IDLE, LIST, THNK, SPKR), a Resume button, and a speed slider (0.5x–3x). These interrupt the auto-demo and hold the forced state. Only visible when gated by dev flag.

**Step 1: Create VoiceDevControls component**

Create `web/src/components/voice/VoiceDevControls.tsx`:

```tsx
import type { VoiceDevControlsProps, VoiceState } from "./types.ts";

const STATE_BUTTONS: Array<{ state: VoiceState; label: string }> = [
  { state: "idle", label: "IDLE" },
  { state: "listening", label: "LIST" },
  { state: "thinking", label: "THNK" },
  { state: "speaking", label: "SPKR" },
];

export function VoiceDevControls({
  currentState,
  speedMultiplier,
  onForceState,
  onSetSpeed,
  onResumeAutoDemo,
}: VoiceDevControlsProps) {
  return (
    <div
      className="fixed bottom-5 left-5 flex items-center gap-2.5 z-10 px-4 py-2 rounded-xl"
      style={{
        background: "#1A2332",
        border: "1px solid rgba(232, 148, 58, 0.15)",
      }}
    >
      {STATE_BUTTONS.map(({ state, label }) => (
        <button
          key={state}
          type="button"
          onClick={() => onForceState(state)}
          className={`w-7 h-7 rounded-full border text-[0.55rem] cursor-pointer flex items-center justify-center transition-colors duration-200
            ${currentState === state
              ? "border-[#E8943A] bg-[#E8943A] text-[#0D1117]"
              : "border-[#6B5540] bg-transparent text-[#6B5540] hover:border-[#E8943A] hover:text-[#E8943A]"
            }`}
        >
          {label}
        </button>
      ))}

      <div className="w-px h-5 bg-[#6B5540] opacity-30" />

      <button
        type="button"
        onClick={onResumeAutoDemo}
        className="bg-transparent border border-[#6B5540] text-[#6B5540] px-3 py-1 rounded-full text-[0.7rem] cursor-pointer hover:border-[#E8943A] hover:text-[#E8943A] transition-colors duration-200"
      >
        Resume
      </button>

      <div className="w-px h-5 bg-[#6B5540] opacity-30" />

      <div className="flex items-center gap-1.5">
        <input
          type="range"
          min="0.5"
          max="3"
          step="0.1"
          value={speedMultiplier}
          onChange={(e) => onSetSpeed(parseFloat(e.target.value))}
          className="w-20 accent-[#E8943A]"
        />
        <span className="text-[#6B5540] text-[0.7rem] min-w-[30px]">
          {speedMultiplier.toFixed(1)}x
        </span>
      </div>
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add web/src/components/voice/VoiceDevControls.tsx
git commit -m "feat(voice-ui): add VoiceDevControls with state buttons and speed slider"
```

---

### Task 7: VoiceMode Page Component

**Files:**
- Create: `web/src/components/voice/VoiceMode.tsx`
- Reference: all voice components created in Tasks 1–6

**Context:** The page-level component that composes everything. Calls `useVoiceState()`, renders the orb, title, status text, controls, and conditionally the dev controls. This replaces `<ChatPanel>` when voice mode is active.

**Step 1: Create VoiceMode component**

Create `web/src/components/voice/VoiceMode.tsx`:

```tsx
import { VoiceOrb } from "./VoiceOrb.tsx";
import { VoiceStatus } from "./VoiceStatus.tsx";
import { VoiceControls } from "./VoiceControls.tsx";
import { VoiceDevControls } from "./VoiceDevControls.tsx";
import { useVoiceState } from "./useVoiceState.ts";

const showDevControls =
  import.meta.env.DEV ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev"));

export function VoiceMode() {
  const voice = useVoiceState();

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: "radial-gradient(ellipse at center, #0D1117 0%, #090C12 100%)" }}>
      {/* Vignette */}
      <div className="fixed inset-0 pointer-events-none z-[1]" style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.6) 100%)" }} />

      {/* Title */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 z-10 text-center select-none">
        <div className="text-[1.4rem] font-light" style={{ letterSpacing: "0.3em", color: "#E8943A" }}>
          F.R.I.D.A.Y.
        </div>
        <div className="text-[0.85rem] mt-1" style={{ color: "#6B5540" }}>
          {voice.voiceName}
        </div>
      </div>

      {/* Canvas orb */}
      <VoiceOrb
        state={voice.state}
        whisperMode={voice.whisperMode}
        muted={voice.muted}
        speedMultiplier={voice.speedMultiplier}
        sessionEnded={voice.sessionEnded}
      />

      {/* Status text */}
      <VoiceStatus
        text={voice.statusText}
        isTyping={voice.isTyping}
        speedMultiplier={voice.speedMultiplier}
      />

      {/* Controls */}
      <VoiceControls
        whisperMode={voice.whisperMode}
        muted={voice.muted}
        sessionEnded={voice.sessionEnded}
        onToggleWhisper={voice.toggleWhisper}
        onToggleMute={voice.toggleMute}
        onEndSession={voice.endSession}
      />

      {/* Dev controls */}
      {showDevControls && (
        <VoiceDevControls
          currentState={voice.state}
          speedMultiplier={voice.speedMultiplier}
          onForceState={voice.forceState}
          onSetSpeed={voice.setSpeed}
          onResumeAutoDemo={voice.resumeAutoDemo}
        />
      )}
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add web/src/components/voice/VoiceMode.tsx
git commit -m "feat(voice-ui): add VoiceMode page component composing all voice pieces"
```

---

### Task 8: Wire VoiceMode into App

**Files:**
- Modify: `web/src/App.tsx`

**Context:** Add a simple mode toggle so users can switch between the chat panel and voice mode. For now this is a URL query param (`?mode=voice`) — no routing library needed. The existing provider wrappers (WebSocket, Session, Chat) still wrap everything since voice mode will eventually need them.

**Step 1: Modify App.tsx to support voice mode**

Modify `web/src/App.tsx`. The current file is:

```tsx
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { ChatProvider } from "./contexts/ChatContext.tsx";
import { Layout } from "./components/layout/Layout.tsx";
import { ChatPanel } from "./components/chat/ChatPanel.tsx";
import { AutoBoot } from "./components/AutoBoot.tsx";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
const WS_URL = `${wsProtocol}//${window.location.hostname}:${wsPort}/ws`;

export function App() {
	return (
		<WebSocketProvider url={WS_URL}>
			<SessionProvider>
				<ChatProvider>
					<AutoBoot />
					<Layout>
						<ChatPanel />
					</Layout>
				</ChatProvider>
			</SessionProvider>
		</WebSocketProvider>
	);
}
```

Add the VoiceMode import and conditional render. Replace the file with:

```tsx
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { ChatProvider } from "./contexts/ChatContext.tsx";
import { Layout } from "./components/layout/Layout.tsx";
import { ChatPanel } from "./components/chat/ChatPanel.tsx";
import { VoiceMode } from "./components/voice/VoiceMode.tsx";
import { AutoBoot } from "./components/AutoBoot.tsx";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
const WS_URL = `${wsProtocol}//${window.location.hostname}:${wsPort}/ws`;

const isVoiceMode = new URLSearchParams(window.location.search).get("mode") === "voice";

export function App() {
	if (isVoiceMode) {
		return <VoiceMode />;
	}

	return (
		<WebSocketProvider url={WS_URL}>
			<SessionProvider>
				<ChatProvider>
					<AutoBoot />
					<Layout>
						<ChatPanel />
					</Layout>
				</ChatProvider>
			</SessionProvider>
		</WebSocketProvider>
	);
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

**Step 3: Manual verification**

Run: `cd web && npx vite --open`

1. Open `http://localhost:5173/?mode=voice` — should see the full voice UI with particle orb, auto-demo cycling, circuit board background
2. Open `http://localhost:5173/?mode=voice&dev` — should also see dev controls (state buttons, speed slider)
3. Open `http://localhost:5173/` — should see the normal chat UI (unchanged)

Verify:
- Particles animate smoothly at 60fps
- Auto-demo cycles through states (IDLE → LISTENING → THINKING → SPEAKING → IDLE)
- Status text shows typewriter effect during SPEAKING
- Whisper button toggles particle size/opacity
- Mute button freezes particles
- End Session scatters and fades
- Dev state buttons force state transitions
- Speed slider adjusts animation and demo timing
- Window resize works correctly (canvas and circuit board redraw)

**Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(voice-ui): wire VoiceMode into App with ?mode=voice query param"
```

---

### Task 9: Barrel Export

**Files:**
- Create: `web/src/components/voice/index.ts`

**Context:** Standard barrel export so consumers can import from `./components/voice` instead of individual files.

**Step 1: Create barrel export**

Create `web/src/components/voice/index.ts`:

```typescript
export { VoiceMode } from "./VoiceMode.tsx";
export { VoiceOrb } from "./VoiceOrb.tsx";
export { VoiceStatus } from "./VoiceStatus.tsx";
export { VoiceControls } from "./VoiceControls.tsx";
export { VoiceDevControls } from "./VoiceDevControls.tsx";
export { useVoiceState } from "./useVoiceState.ts";
export type { VoiceState, VoiceOrbProps, VoiceControlsProps, VoiceDevControlsProps, VoiceStatusProps } from "./types.ts";
```

**Step 2: Update App.tsx import to use barrel**

In `web/src/App.tsx`, change:
```tsx
import { VoiceMode } from "./components/voice/VoiceMode.tsx";
```
to:
```tsx
import { VoiceMode } from "./components/voice/index.ts";
```

**Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add web/src/components/voice/index.ts web/src/App.tsx
git commit -m "feat(voice-ui): add barrel export for voice components"
```
