# Voice Conversation UI POC — Design

**Date**: 2026-02-27
**Status**: Approved
**Scope**: Standalone visual POC for hands-free voice conversation mode

## Goal

Create a self-contained HTML/Canvas POC that demonstrates the visual experience of a hands-free voice conversation with Friday. No wiring to the runtime — this is purely a UI mockup to perfect the look, feel, and animations before integration.

## Approach

Single-file HTML (`poc/voice-ui/index.html`) with embedded CSS, JS, and Canvas rendering. Zero external dependencies, opens directly in a browser. The particle engine and state machine can be extracted into React components once the visuals are finalized.

## Layout

Full-screen immersive dark layout (`#0B0E14`), no chrome, no scrollbars. Three vertical zones:

1. **Title area** (top) — "F.R.I.D.A.Y." in amber, voice name + mode subline
2. **Particle orb** (center, ~40% viewport height) — hero element, canvas-rendered
3. **Status text** (below orb) — single ambient line showing current state / last utterance
4. **Control bar** (bottom) — Whisper, Mute, End Session pill buttons
5. **Dev controls** (very bottom) — state-force buttons + speed slider for iteration

## Particle System

~150 canvas-rendered particles at 60fps. Each particle has position, velocity, size, opacity, and a home position on a projected sphere surface.

### Rendering

- Radial gradient per particle for glow effect
- Additive blending (`globalCompositeOperation: 'lighter'`) for bloom
- Motion trail via translucent black overlay clear (not full clear)
- Z-depth projection: front particles are larger and brighter
- Render at `2x devicePixelRatio` for retina

### States

| State | Particles | Ring | Color | Auto-Demo Duration |
|-------|-----------|------|-------|--------------------|
| IDLE | Lazy Brownian drift near home positions | Dim amber glow | `#F5A623` at 30% | Until cycle start |
| LISTENING | Contract inward, vibrate in place | Pulsing amber (2s breathing) | `#F5A623` at 60% | 3s |
| THINKING | Vortex swirl, orbital acceleration, trailing | Copper spinning ring | `#E8852A` | 2s |
| SPEAKING | Expand outward, radial amplitude oscillation | Bright amber, radiating pulses | `#FFCC66` | 4s |
| ERROR | Scatter chaotically, slowly reconverge | Red flash then dim | `#F87171` | 2s then IDLE |

### Transitions

Particles lerp from current behavior to new behavior over ~500ms. No hard snaps.

## State Machine & Auto-Demo

Timed cycle (~14s total):

```
IDLE ─(3s)→ LISTENING ─(3s)→ THINKING ─(2s)→ SPEAKING ─(4s)→ IDLE
  ↑                                                              │
  └──────────────────────(2s pause)──────────────────────────────┘
```

### Speaking Responses (rotate each cycle)

- "I found 3 unread emails from today."
- "Your Docker containers are all healthy."
- "The build passed. 957 tests, zero failures."
- "Checking your calendar... you're free until 3pm."
- "I've summarized the PR — 4 files changed, 2 comments."

### Status Text Behavior

- IDLE: Fades to "Ready." at low opacity
- LISTENING: "Listening..." with ellipsis pulse animation
- THINKING: "Processing..."
- SPEAKING: Response typed out character by character (~30ms/char, typewriter effect)
- All transitions: 300ms fade in/out

### Dev Controls

- Four state-force buttons (IDLE, LISTEN, THINK, SPEAK) — interrupt auto-demo, hold state
- "Resume Auto" button to restart timed cycle
- Speed slider (0.5x to 3x) for tuning animations

## Controls

| Button | Behavior | Visual |
|--------|----------|--------|
| Whisper | Toggle whisper mode: particles shrink 60%, opacity drops, ring dims | Amber outline off / filled on |
| Mute | Simulate mic mute: particles freeze, ring goes dim gray, status "Muted" | Toggle style, red tint when active |
| End Session | Particles scatter outward and fade, status "Session ended", orb goes dark | Red-tinted outline, hover fills red |

## Visual Polish

- **Background**: Subtle radial gradient `#0B0E14` → `#080A0F` with CSS inset vignette
- **Typography**: System sans-serif, "F.R.I.D.A.Y." at `letter-spacing: 0.3em` in amber, subtitle in text-dim
- **Buttons**: Rounded pill, 1px amber border, transparent bg, hover fill 200ms ease
- **Responsive**: Orb scales with `min(50vh, 50vw)`, controls and text scale proportionally

## Color Palette (Friday)

| Token | Hex | Usage |
|-------|-----|-------|
| Friday Deep | `#0B0E14` | Background |
| Friday BG | `#111620` | — |
| Friday Surface | `#1A1F2E` | Button hover fills |
| Friday Amber | `#F5A623` | Primary accent, ring, particles |
| Friday Amber Light | `#FFCC66` | Speaking state highlight |
| Friday Copper | `#E8852A` | Thinking state accent |
| Friday Text | `#E8E0D4` | Status text |
| Friday Text Dim | `#7A7262` | Subtitle, secondary text |
| Error | `#F87171` | Error state, end button |

## File Structure

```
poc/
└── voice-ui/
    └── index.html    (~600-800 lines, fully self-contained)
```

## Non-Goals

- No audio input/output — purely visual
- No WebSocket or runtime connection
- No React — plain JS/Canvas (extracts to React later)
- No build step or dependencies
