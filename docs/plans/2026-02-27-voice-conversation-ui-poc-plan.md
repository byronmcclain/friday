# Voice Conversation UI POC — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a self-contained HTML/Canvas POC for Friday's hands-free voice conversation UI — a particle orb that reacts to conversation states, with an auto-demo loop and dev controls.

**Architecture:** Single `poc/voice-ui/index.html` file. No dependencies. Canvas-based particle system with a state machine driving visual behavior. Auto-demo cycles through IDLE → LISTENING → THINKING → SPEAKING states on a timer.

**Tech Stack:** Vanilla HTML/CSS/JS, Canvas 2D API, requestAnimationFrame loop.

**Design doc:** `docs/plans/2026-02-27-voice-conversation-ui-poc-design.md`

---

### Task 1: Scaffold — HTML shell, CSS layout, and static elements

**Files:**
- Create: `poc/voice-ui/index.html`

**Step 1: Create the directory**

```bash
mkdir -p poc/voice-ui
```

**Step 2: Write the HTML shell with embedded CSS**

Create `poc/voice-ui/index.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>F.R.I.D.A.Y. — Voice Mode</title>
  <style>
    /* --- Reset & Base --- */
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --friday-deep: #0B0E14;
      --friday-bg: #111620;
      --friday-surface: #1A1F2E;
      --friday-amber: #F5A623;
      --friday-amber-light: #FFCC66;
      --friday-copper: #E8852A;
      --friday-text: #E8E0D4;
      --friday-text-dim: #7A7262;
      --friday-error: #F87171;
    }

    html, body {
      width: 100%; height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: radial-gradient(ellipse at center, var(--friday-deep) 0%, #080A0F 100%);
      color: var(--friday-text);
    }

    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: inset 0 0 150px 60px rgba(0,0,0,0.5); /* vignette */
    }

    /* --- Title --- */
    .title {
      text-align: center;
      margin-bottom: 2rem;
      user-select: none;
    }
    .title h1 {
      font-size: 1.4rem;
      font-weight: 300;
      letter-spacing: 0.3em;
      color: var(--friday-amber);
    }
    .title .subtitle {
      font-size: 0.8rem;
      color: var(--friday-text-dim);
      margin-top: 0.3rem;
    }

    /* --- Canvas container --- */
    .orb-container {
      position: relative;
      width: min(50vh, 50vw);
      height: min(50vh, 50vw);
    }
    .orb-container canvas {
      width: 100%;
      height: 100%;
    }

    /* --- Status text --- */
    .status {
      text-align: center;
      margin-top: 1.5rem;
      height: 2rem;
      font-size: 1rem;
      color: var(--friday-text);
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .status.visible { opacity: 1; }

    /* --- Control bar --- */
    .controls {
      display: flex;
      gap: 1rem;
      margin-top: 2rem;
    }
    .controls button {
      padding: 0.5rem 1.5rem;
      border-radius: 9999px;
      border: 1px solid var(--friday-amber);
      background: transparent;
      color: var(--friday-amber);
      font-size: 0.85rem;
      cursor: pointer;
      transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
      user-select: none;
    }
    .controls button:hover {
      background: var(--friday-amber);
      color: var(--friday-deep);
    }
    .controls button.active {
      background: var(--friday-amber);
      color: var(--friday-deep);
    }
    .controls button.muted {
      border-color: var(--friday-error);
      color: var(--friday-error);
    }
    .controls button.muted:hover {
      background: var(--friday-error);
      color: var(--friday-deep);
    }
    .controls button.end {
      border-color: var(--friday-error);
      color: var(--friday-error);
    }
    .controls button.end:hover {
      background: var(--friday-error);
      color: var(--friday-deep);
    }

    /* --- Dev controls --- */
    .dev-controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 2rem;
      opacity: 0.5;
      transition: opacity 0.2s;
    }
    .dev-controls:hover { opacity: 1; }

    .dev-controls .state-btn {
      width: 10px; height: 10px;
      border-radius: 50%;
      border: 1px solid var(--friday-text-dim);
      background: transparent;
      cursor: pointer;
      transition: background 0.2s;
    }
    .dev-controls .state-btn:hover { background: var(--friday-amber); }
    .dev-controls .state-btn.active-state { background: var(--friday-amber); }

    .dev-controls label {
      font-size: 0.7rem;
      color: var(--friday-text-dim);
    }
    .dev-controls input[type="range"] {
      width: 80px;
      accent-color: var(--friday-amber);
    }
    .dev-controls .resume-btn {
      font-size: 0.7rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      border: 1px solid var(--friday-text-dim);
      background: transparent;
      color: var(--friday-text-dim);
      cursor: pointer;
    }
    .dev-controls .resume-btn:hover {
      border-color: var(--friday-amber);
      color: var(--friday-amber);
    }

    /* --- Ellipsis animation --- */
    @keyframes ellipsis-1 { 0%, 24% { opacity: 0; } 25%, 100% { opacity: 1; } }
    @keyframes ellipsis-2 { 0%, 49% { opacity: 0; } 50%, 100% { opacity: 1; } }
    @keyframes ellipsis-3 { 0%, 74% { opacity: 0; } 75%, 100% { opacity: 1; } }
    .ellipsis-dot {
      animation-duration: 1.5s;
      animation-iteration-count: infinite;
    }
    .ellipsis-dot:nth-child(1) { animation-name: ellipsis-1; }
    .ellipsis-dot:nth-child(2) { animation-name: ellipsis-2; }
    .ellipsis-dot:nth-child(3) { animation-name: ellipsis-3; }
  </style>
</head>
<body>

  <div class="title">
    <h1>F.R.I.D.A.Y.</h1>
    <div class="subtitle">Eve &middot; On</div>
  </div>

  <div class="orb-container">
    <canvas id="orb"></canvas>
  </div>

  <div class="status" id="status">Ready.</div>

  <div class="controls">
    <button id="btn-whisper">Whisper</button>
    <button id="btn-mute">Mute</button>
    <button id="btn-end" class="end">End Session</button>
  </div>

  <div class="dev-controls">
    <button class="state-btn" data-state="idle" title="IDLE"></button>
    <button class="state-btn" data-state="listening" title="LISTENING"></button>
    <button class="state-btn" data-state="thinking" title="THINKING"></button>
    <button class="state-btn" data-state="speaking" title="SPEAKING"></button>
    <button class="resume-btn" id="btn-resume">Auto</button>
    <label>Speed</label>
    <input type="range" id="speed" min="0.5" max="3" step="0.1" value="1">
    <label id="speed-label">1.0x</label>
  </div>

  <script>
    // JS will be added in subsequent tasks
  </script>
</body>
</html>
```

**Step 3: Verify in browser**

```bash
open poc/voice-ui/index.html
```

Expected: Dark full-screen page with "F.R.I.D.A.Y." title, empty canvas area, control buttons, and dev controls visible. No particle animation yet.

**Step 4: Commit**

```bash
git add poc/voice-ui/index.html docs/plans/2026-02-27-voice-conversation-ui-poc-design.md docs/plans/2026-02-27-voice-conversation-ui-poc-plan.md
git commit -m "feat(poc): scaffold voice conversation UI with layout and styles"
```

---

### Task 2: Particle class and sphere distribution

Build the core Particle class and initialize ~150 particles distributed on a sphere surface.

**Files:**
- Modify: `poc/voice-ui/index.html` (inside the `<script>` tag)

**Step 1: Add the particle system constants and Particle class**

Inside the `<script>` tag, replace the placeholder comment with:

```javascript
/**
 * F.R.I.D.A.Y. Voice Conversation UI — Proof of Concept
 *
 * Self-contained visual mockup for hands-free voice mode.
 * No dependencies, no build step. Open directly in browser.
 *
 * Design: docs/plans/2026-02-27-voice-conversation-ui-poc-design.md
 */

// --- Constants ---
const COLORS = {
  deep: '#0B0E14',
  amber: '#F5A623',
  amberLight: '#FFCC66',
  copper: '#E8852A',
  text: '#E8E0D4',
  textDim: '#7A7262',
  error: '#F87171',
};

const PARTICLE_COUNT = 150;
const SPHERE_RADIUS = 0.35; // fraction of canvas size

// --- Particle ---
class Particle {
  constructor(index) {
    // Distribute on sphere using fibonacci spiral
    const golden = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (index / (PARTICLE_COUNT - 1)) * 2; // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = golden * index;

    // Home position on sphere (normalized -1..1)
    this.homeX = Math.cos(theta) * radiusAtY;
    this.homeY = y;
    this.homeZ = Math.sin(theta) * radiusAtY;

    // Current position
    this.x = this.homeX;
    this.y = this.homeY;
    this.z = this.homeZ;

    // Velocity
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;

    // Visual
    this.baseSize = 1.5 + Math.random() * 1.5;
    this.size = this.baseSize;
    this.opacity = 0.5 + Math.random() * 0.5;
  }

  // Project 3D to 2D with perspective
  project(cx, cy, radius) {
    const perspective = 1 / (1 - this.z * 0.3);
    const px = cx + this.x * radius * perspective;
    const py = cy + this.y * radius * perspective;
    const depth = (this.z + 1) / 2; // 0 (back) to 1 (front)
    return { px, py, depth };
  }
}
```

**Step 2: Add canvas setup and particle initialization**

```javascript
// --- Canvas Setup ---
const canvas = document.getElementById('orb');
const ctx = canvas.getContext('2d');
let W, H, centerX, centerY, orbRadius;

function resize() {
  const container = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  W = rect.width * dpr;
  H = rect.height * dpr;
  canvas.width = W;
  canvas.height = H;
  centerX = W / 2;
  centerY = H / 2;
  orbRadius = Math.min(W, H) * SPHERE_RADIUS;
  // Clear on resize
  ctx.fillStyle = 'rgba(11, 14, 20, 1)';
  ctx.fillRect(0, 0, W, H);
}

window.addEventListener('resize', resize);
resize();

// --- Initialize Particles ---
const particles = [];
for (let i = 0; i < PARTICLE_COUNT; i++) {
  particles.push(new Particle(i));
}
```

**Step 3: Add basic render loop (static particles, no movement yet)**

```javascript
// --- Render ---
let lastTime = performance.now();

function render() {
  // Trail effect: semi-transparent clear
  ctx.fillStyle = 'rgba(11, 14, 20, 0.15)';
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';

  // Sort by z for depth ordering (back to front)
  const sorted = [...particles].sort((a, b) => a.z - b.z);

  for (const p of sorted) {
    const { px, py, depth } = p.project(centerX, centerY, orbRadius);
    const size = p.size * (0.5 + depth * 0.8) * (orbRadius / 100);
    const alpha = p.opacity * (0.3 + depth * 0.7);

    const grad = ctx.createRadialGradient(px, py, 0, px, py, size);
    grad.addColorStop(0, `rgba(245, 166, 35, ${alpha})`);
    grad.addColorStop(1, `rgba(245, 166, 35, 0)`);

    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
```

**Step 4: Verify in browser**

Expected: Amber glowing particles arranged in a sphere shape on the dark background. No movement yet — static sphere. Front particles appear larger and brighter.

**Step 5: Commit**

```bash
git add poc/voice-ui/index.html
git commit -m "feat(poc): add particle class with fibonacci sphere distribution and basic render"
```

---

### Task 3: State machine and idle particle behavior

Add the state machine, idle state Brownian motion, and smooth transitions.

**Files:**
- Modify: `poc/voice-ui/index.html` (inside the `<script>` tag)

**Step 1: Add state machine (insert before the render function)**

```javascript
// --- State Machine ---
const STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  ERROR: 'error',
};

let currentState = STATES.IDLE;
let stateTransition = 1; // 0..1, 1 = fully transitioned
const TRANSITION_SPEED = 0.002; // per ms (~500ms full transition)
let speedMultiplier = 1;

function setState(newState) {
  if (newState === currentState) return;
  currentState = newState;
  stateTransition = 0;
}
```

**Step 2: Add particle update with idle Brownian motion (insert before render)**

```javascript
// --- Particle Update ---
function updateParticles(dt) {
  for (const p of particles) {
    // Brownian drift toward home (IDLE behavior)
    const driftStrength = 0.0005 * dt;
    const homeForceX = (p.homeX - p.x) * driftStrength;
    const homeForceY = (p.homeY - p.y) * driftStrength;
    const homeForceZ = (p.homeZ - p.z) * driftStrength;

    // Random jitter
    const jitter = 0.00002 * dt;
    const jx = (Math.random() - 0.5) * jitter;
    const jy = (Math.random() - 0.5) * jitter;
    const jz = (Math.random() - 0.5) * jitter;

    // Damping
    const damp = 0.98;
    p.vx = (p.vx + homeForceX + jx) * damp;
    p.vy = (p.vy + homeForceY + jy) * damp;
    p.vz = (p.vz + homeForceZ + jz) * damp;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
  }

  // Advance transition
  if (stateTransition < 1) {
    stateTransition = Math.min(1, stateTransition + TRANSITION_SPEED * dt);
  }
}
```

**Step 3: Integrate update into render loop**

Replace the `render()` function with:

```javascript
function render() {
  const now = performance.now();
  const rawDt = now - lastTime;
  const dt = rawDt * speedMultiplier;
  lastTime = now;

  updateParticles(dt);

  // Trail effect
  ctx.fillStyle = 'rgba(11, 14, 20, 0.15)';
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';

  const sorted = [...particles].sort((a, b) => a.z - b.z);

  for (const p of sorted) {
    const { px, py, depth } = p.project(centerX, centerY, orbRadius);
    const size = p.size * (0.5 + depth * 0.8) * (orbRadius / 100);
    const alpha = p.opacity * (0.3 + depth * 0.7);

    const grad = ctx.createRadialGradient(px, py, 0, px, py, size);
    grad.addColorStop(0, `rgba(245, 166, 35, ${alpha})`);
    grad.addColorStop(1, `rgba(245, 166, 35, 0)`);

    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';

  requestAnimationFrame(render);
}

lastTime = performance.now();
requestAnimationFrame(render);
```

**Step 4: Verify in browser**

Expected: Particles lazily drift around their home positions. Gentle Brownian motion — alive but calm. Sphere shape stays recognizable.

**Step 5: Commit**

```bash
git add poc/voice-ui/index.html
git commit -m "feat(poc): add state machine and idle Brownian motion for particles"
```

---

### Task 4: State-specific particle behaviors

Add distinct particle behaviors for listening, thinking, speaking, and error states.

**Files:**
- Modify: `poc/voice-ui/index.html` (replace `updateParticles` function)

**Step 1: Replace `updateParticles` with full state-driven behavior**

```javascript
function updateParticles(dt) {
  const time = performance.now() * 0.001; // seconds

  for (const p of particles) {
    let forceX = 0, forceY = 0, forceZ = 0;
    let targetSize = p.baseSize;
    let targetOpacity = 0.5 + ((p.homeZ + 1) / 2) * 0.5;

    if (currentState === STATES.IDLE) {
      // Brownian drift toward home
      const strength = 0.0005;
      forceX = (p.homeX - p.x) * strength;
      forceY = (p.homeY - p.y) * strength;
      forceZ = (p.homeZ - p.z) * strength;
      targetOpacity *= 0.6;

    } else if (currentState === STATES.LISTENING) {
      // Contract inward, vibrate
      const contractTarget = 0.8;
      forceX = (p.homeX * contractTarget - p.x) * 0.001;
      forceY = (p.homeY * contractTarget - p.y) * 0.001;
      forceZ = (p.homeZ * contractTarget - p.z) * 0.001;
      const vibFreq = 0.01;
      forceX += Math.sin(time * 20 + p.homeX * 10) * vibFreq * 0.001;
      forceY += Math.cos(time * 20 + p.homeY * 10) * vibFreq * 0.001;
      targetOpacity *= 0.8;

    } else if (currentState === STATES.THINKING) {
      // Vortex swirl
      const angle = Math.atan2(p.z, p.x);
      const swirl = 0.003;
      forceX = -Math.sin(angle) * swirl + (p.homeX * 0.9 - p.x) * 0.0003;
      forceZ = Math.cos(angle) * swirl + (p.homeZ * 0.9 - p.z) * 0.0003;
      forceY = (p.homeY - p.y) * 0.0005;
      targetOpacity *= 0.9;

    } else if (currentState === STATES.SPEAKING) {
      // Expand outward with radial oscillation
      const expandFactor = 1.3;
      const pulse = Math.sin(time * 6 + p.homeX * 5) * 0.15;
      const targetDist = expandFactor + pulse;
      forceX = (p.homeX * targetDist - p.x) * 0.001;
      forceY = (p.homeY * targetDist - p.y) * 0.001;
      forceZ = (p.homeZ * targetDist - p.z) * 0.001;
      targetSize = p.baseSize * 1.3;
      targetOpacity = 0.8 + Math.sin(time * 4) * 0.2;

    } else if (currentState === STATES.ERROR) {
      // Scatter then reconverge
      if (stateTransition < 0.3) {
        forceX = (Math.random() - 0.5) * 0.005;
        forceY = (Math.random() - 0.5) * 0.005;
        forceZ = (Math.random() - 0.5) * 0.005;
      } else {
        forceX = (p.homeX - p.x) * 0.0008;
        forceY = (p.homeY - p.y) * 0.0008;
        forceZ = (p.homeZ - p.z) * 0.0008;
      }
      targetOpacity *= 0.5;
    }

    // Whisper modifier: shrink and dim
    if (whisperMode) {
      targetSize *= 0.6;
      targetOpacity *= 0.5;
    }

    // Mute modifier: freeze
    if (muted) {
      forceX = 0; forceY = 0; forceZ = 0;
      targetOpacity *= 0.3;
    }

    // Apply forces with damping
    const damp = 0.97;
    const jitter = 0.000005;
    p.vx = (p.vx + forceX * dt + (Math.random() - 0.5) * jitter * dt) * damp;
    p.vy = (p.vy + forceY * dt + (Math.random() - 0.5) * jitter * dt) * damp;
    p.vz = (p.vz + forceZ * dt + (Math.random() - 0.5) * jitter * dt) * damp;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;

    // Smooth size/opacity transition
    p.size += (targetSize - p.size) * 0.05;
    p.opacity += (targetOpacity - p.opacity) * 0.05;
  }

  // Advance transition
  if (stateTransition < 1) {
    stateTransition = Math.min(1, stateTransition + TRANSITION_SPEED * dt);
  }
}
```

Note: This references `whisperMode` and `muted` variables that will be defined in Task 7. For now, add these placeholder declarations right after the state machine code:

```javascript
// --- Control State (placeholders, wired in Task 7) ---
let whisperMode = false;
let muted = false;
let sessionEnded = false;
```

**Step 2: Wire dev control buttons for manual state testing**

Add after the render loop:

```javascript
// --- Dev Controls (temporary — enhanced in Task 6) ---
document.querySelectorAll('.state-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setState(btn.dataset.state);
    document.querySelectorAll('.state-btn').forEach(b =>
      b.classList.toggle('active-state', b === btn)
    );
  });
});
```

**Step 3: Verify in browser**

Click each dev control dot:
- IDLE: Lazy drift
- LISTENING: Contract inward, subtle vibration
- THINKING: Vortex swirl
- SPEAKING: Expand outward with pulsing energy

**Step 4: Commit**

```bash
git add poc/voice-ui/index.html
git commit -m "feat(poc): add state-specific particle behaviors (listen, think, speak, error)"
```

---

### Task 5: State ring glow effect

Add the glowing ring around the orb that changes per state.

**Files:**
- Modify: `poc/voice-ui/index.html` (add `drawRing` function, update render loop)

**Step 1: Add state color resolver and ring rendering function**

Insert before the `render()` function:

```javascript
// --- State Color ---
function getStateColor() {
  switch (currentState) {
    case STATES.IDLE: return { r: 245, g: 166, b: 35 };       // amber
    case STATES.LISTENING: return { r: 245, g: 166, b: 35 };   // amber
    case STATES.THINKING: return { r: 232, g: 133, b: 42 };    // copper
    case STATES.SPEAKING: return { r: 255, g: 204, b: 102 };   // amber light
    case STATES.ERROR: return { r: 248, g: 113, b: 113 };      // error red
    default: return { r: 245, g: 166, b: 35 };
  }
}

// --- Ring Glow ---
function drawRing(time) {
  const ringRadius = orbRadius * 1.15;
  let ringAlpha, ringWidth;

  if (currentState === STATES.IDLE) {
    ringAlpha = 0.15 + Math.sin(time * 0.5) * 0.05;
    ringWidth = 1.5;
  } else if (currentState === STATES.LISTENING) {
    ringAlpha = 0.3 + Math.sin(time * Math.PI) * 0.2;
    ringWidth = 2;
  } else if (currentState === STATES.THINKING) {
    ringAlpha = 0.5;
    ringWidth = 2.5;
  } else if (currentState === STATES.SPEAKING) {
    ringAlpha = 0.6 + Math.sin(time * 3) * 0.2;
    ringWidth = 3;
  } else if (currentState === STATES.ERROR) {
    ringAlpha = 0.5 * (1 - stateTransition);
    ringWidth = 3;
  }

  // Mute/whisper modifiers
  if (muted) {
    ringAlpha *= 0.3;
  } else if (whisperMode) {
    ringAlpha *= 0.5;
  }

  const c = getStateColor();
  const mGray = muted;
  const r = mGray ? 74 : c.r;
  const g = mGray ? 74 : c.g;
  const b = mGray ? 74 : c.b;

  // Outer glow (soft)
  ctx.beginPath();
  ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${ringAlpha * 0.3})`;
  ctx.lineWidth = ringWidth * 6;
  ctx.stroke();

  // Inner ring (sharp)
  ctx.beginPath();
  ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${ringAlpha})`;
  ctx.lineWidth = ringWidth;
  ctx.stroke();

  // Thinking: spinning arc segment
  if (currentState === STATES.THINKING && !muted) {
    const arcStart = time * 3;
    const arcLength = Math.PI * 0.6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, arcStart, arcStart + arcLength);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
    ctx.lineWidth = ringWidth * 1.5;
    ctx.stroke();
  }

  // Speaking: radiating pulse rings
  if (currentState === STATES.SPEAKING && !muted) {
    const pulsePhase = (time * 2) % 1;
    const pulseRadius = ringRadius + pulsePhase * orbRadius * 0.3;
    const pulseAlpha = (1 - pulsePhase) * 0.3;
    ctx.beginPath();
    ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${pulseAlpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
```

**Step 2: Update render loop to use state colors and draw ring**

In the particle rendering section of `render()`, replace the hardcoded amber color:

```javascript
  const color = getStateColor();

  // ... inside the particle for-loop, replace the gradient lines:
  const grad = ctx.createRadialGradient(px, py, 0, px, py, size);
  grad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`);
  grad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
```

After the particle loop and resetting `globalCompositeOperation`, add:

```javascript
  // Draw ring
  const time = performance.now() * 0.001;
  drawRing(time);
```

**Step 3: Verify in browser**

- IDLE: Faint amber ring
- LISTENING: Breathing/pulsing amber ring
- THINKING: Copper ring + bright spinning arc segment
- SPEAKING: Bright amber ring + radiating pulse waves

**Step 4: Commit**

```bash
git add poc/voice-ui/index.html
git commit -m "feat(poc): add state-driven ring glow with spinning arc and pulse effects"
```

---

### Task 6: Auto-demo loop and status text

Wire the timed auto-demo cycle and status text with typewriter effect.

**Files:**
- Modify: `poc/voice-ui/index.html`

**Step 1: Add canned responses and status text controller**

Insert after the control state placeholders:

```javascript
// --- Canned Responses ---
const RESPONSES = [
  "I found 3 unread emails from today.",
  "Your Docker containers are all healthy.",
  "The build passed. 957 tests, zero failures.",
  "Checking your calendar... you're free until 3pm.",
  "I've summarized the PR \u2014 4 files changed, 2 comments.",
];
let responseIndex = 0;

// --- Status Text ---
const statusEl = document.getElementById('status');
let typewriterInterval = null;

function setStatus(text, typewriter) {
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }

  // Clear existing content
  while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);

  if (typewriter && text) {
    let charIndex = 0;
    statusEl.classList.add('visible');
    typewriterInterval = setInterval(() => {
      if (charIndex < text.length) {
        statusEl.textContent = text.slice(0, charIndex + 1);
        charIndex++;
      } else {
        clearInterval(typewriterInterval);
        typewriterInterval = null;
      }
    }, 30 / speedMultiplier);
  } else if (text === 'Listening...') {
    // Animated ellipsis using DOM elements
    const base = document.createTextNode('Listening');
    statusEl.appendChild(base);
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'ellipsis-dot';
      dot.textContent = '.';
      statusEl.appendChild(dot);
    }
    statusEl.classList.add('visible');
  } else {
    statusEl.textContent = text || '';
    statusEl.classList.toggle('visible', !!text);
  }
}
```

**Step 2: Add auto-demo loop**

```javascript
// --- Auto-Demo ---
let autoDemo = true;
let demoTimer = null;
const DEMO_SCHEDULE = [
  { state: STATES.IDLE, duration: 3000, status: 'Ready.', typewriter: false },
  { state: STATES.LISTENING, duration: 3000, status: 'Listening...', typewriter: false },
  { state: STATES.THINKING, duration: 2000, status: 'Processing...', typewriter: false },
  { state: STATES.SPEAKING, duration: 4000, status: null, typewriter: true },
  { state: STATES.IDLE, duration: 2000, status: '', typewriter: false },
];

let demoStep = 0;

function runDemoStep() {
  if (!autoDemo) return;

  const step = DEMO_SCHEDULE[demoStep % DEMO_SCHEDULE.length];
  setState(step.state);

  if (step.state === STATES.SPEAKING) {
    const response = RESPONSES[responseIndex % RESPONSES.length];
    setStatus(response, true);
    responseIndex++;
  } else {
    setStatus(step.status, step.typewriter);
  }

  // Update dev control indicators
  document.querySelectorAll('.state-btn').forEach(btn => {
    btn.classList.toggle('active-state', btn.dataset.state === step.state);
  });

  demoStep++;
  demoTimer = setTimeout(runDemoStep, step.duration / speedMultiplier);
}

runDemoStep();
```

**Step 3: Replace temporary dev controls with full wiring**

Replace the temporary dev control code with:

```javascript
// --- Dev Controls ---
document.querySelectorAll('.state-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    autoDemo = false;
    clearTimeout(demoTimer);
    setState(btn.dataset.state);

    document.querySelectorAll('.state-btn').forEach(b =>
      b.classList.toggle('active-state', b === btn)
    );

    const statusMap = {
      idle: 'Ready.',
      listening: 'Listening...',
      thinking: 'Processing...',
      speaking: RESPONSES[responseIndex % RESPONSES.length],
    };
    setStatus(statusMap[btn.dataset.state], btn.dataset.state === 'speaking');
  });
});

document.getElementById('btn-resume').addEventListener('click', () => {
  autoDemo = true;
  demoStep = 0;
  clearTimeout(demoTimer);
  runDemoStep();
});

// Speed slider
const speedSlider = document.getElementById('speed');
const speedLabel = document.getElementById('speed-label');
speedSlider.addEventListener('input', () => {
  speedMultiplier = parseFloat(speedSlider.value);
  speedLabel.textContent = speedMultiplier.toFixed(1) + 'x';
});
```

**Step 4: Verify in browser**

- Auto-demo cycles through all states with correct status text
- Typewriter effect plays during SPEAKING
- "Listening..." has animated ellipsis dots
- Dev buttons interrupt cycle, Resume restarts
- Speed slider affects both animation and cycle timing

**Step 5: Commit**

```bash
git add poc/voice-ui/index.html
git commit -m "feat(poc): add auto-demo loop, status text typewriter, and dev controls"
```

---

### Task 7: Control buttons (Whisper, Mute, End Session)

Wire the three main control buttons.

**Files:**
- Modify: `poc/voice-ui/index.html`

**Step 1: Add control button handlers**

Replace the `whisperMode`/`muted`/`sessionEnded` placeholder comments with wired handlers. The variables are already declared. Add the event listeners after the dev controls code:

```javascript
// --- Control Buttons ---
document.getElementById('btn-whisper').addEventListener('click', () => {
  if (sessionEnded) return;
  whisperMode = !whisperMode;
  document.getElementById('btn-whisper').classList.toggle('active', whisperMode);
  document.querySelector('.subtitle').textContent =
    'Eve \u00B7 ' + (whisperMode ? 'Whisper' : 'On');
});

document.getElementById('btn-mute').addEventListener('click', () => {
  if (sessionEnded) return;
  muted = !muted;
  const btn = document.getElementById('btn-mute');
  btn.classList.toggle('muted', muted);
  btn.textContent = muted ? 'Unmute' : 'Mute';
  if (muted) {
    setStatus('Muted', false);
  } else if (!autoDemo) {
    setStatus('Ready.', false);
  }
});

document.getElementById('btn-end').addEventListener('click', () => {
  sessionEnded = true;
  autoDemo = false;
  clearTimeout(demoTimer);
  setState(STATES.ERROR);
  setStatus('Session ended.', false);

  setTimeout(() => {
    for (const p of particles) {
      p.opacity = 0;
    }
  }, 1500);
});
```

**Step 2: Verify in browser**

- Whisper: particles shrink/dim, ring softens, subtitle shows "Whisper"
- Mute: particles freeze, ring grays, "Muted" status
- End: scatter effect, particles fade, "Session ended."

**Step 3: Commit**

```bash
git add poc/voice-ui/index.html
git commit -m "feat(poc): wire Whisper, Mute, End Session controls with particle effects"
```

---

### Task 8: Final integration pass

Ensure all pieces work together smoothly. Fix any ordering issues in the JS.

**Files:**
- Modify: `poc/voice-ui/index.html`

**Step 1: Verify the JS execution order is correct**

The final order inside `<script>` should be:

1. Constants (COLORS, PARTICLE_COUNT, SPHERE_RADIUS)
2. Particle class
3. Canvas setup + resize
4. Particle initialization
5. State machine (STATES, currentState, setState)
6. Control state variables (whisperMode, muted, sessionEnded)
7. Canned responses + status text functions
8. State color + ring glow functions
9. updateParticles function
10. render function + start loop
11. Auto-demo setup + start
12. Dev controls wiring
13. Control button wiring

**Step 2: Full browser walkthrough**

- Page loads → auto-demo starts cycling
- Particles drift (IDLE) → contract (LISTENING) → swirl (THINKING) → expand (SPEAKING)
- Ring changes color/behavior per state
- Status text shows typewriter during speaking, animated ellipsis during listening
- Click dev buttons to force states
- Speed slider affects everything
- Whisper dims the whole scene
- Mute freezes particles and grays ring
- End Session scatters and fades

**Step 3: Check that poc/ is not gitignored**

```bash
grep -n "poc" .gitignore
```

If no match, good. If matched, remove the line.

**Step 4: Final commit**

```bash
git add poc/voice-ui/index.html
git commit -m "feat(poc): voice conversation UI POC complete — particle orb with auto-demo"
```
