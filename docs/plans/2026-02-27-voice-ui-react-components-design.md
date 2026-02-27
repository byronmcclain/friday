# Voice UI React Components — Design

**Date**: 2026-02-27
**Status**: Approved
**Scope**: Extract POC voice conversation UI into React components for the existing web app

## Goal

Convert the standalone voice UI POC (`poc/voice-ui/index.html`) into React components that live inside the existing Friday web app (`web/src/`), preserving the Canvas-based rendering and 60fps performance.

## Decisions

- **Destination**: Inside the existing web app as a mode that replaces the chat panel
- **Canvas strategy**: Imperative via `useRef` — the animation loop runs outside React's render cycle
- **Architecture**: Single canvas component + thin control wrappers (Approach 1)
- **Dev controls**: Included, gated behind a dev flag (`?dev` query param or `import.meta.env.DEV`)

## Component Tree

```
<VoiceMode>                          ← page component, replaces chat panel
  ├── <VoiceTitle />                 ← "F.R.I.D.A.Y." + subtitle
  ├── <VoiceOrb />                   ← <canvas> + full imperative render loop
  ├── <VoiceStatus />                ← status text with typewriter + ellipsis
  ├── <VoiceControls />              ← Whisper / Mute / End Session pills
  └── <VoiceDevControls />           ← state buttons + speed slider (dev-only)
```

## File Structure

```
web/src/components/voice/
├── VoiceMode.tsx          ← page component, composes all pieces
├── VoiceOrb.tsx           ← canvas component, imperative render loop
├── VoiceStatus.tsx        ← status text (typewriter, ellipsis animation)
├── VoiceControls.tsx      ← Whisper/Mute/End Session pill buttons
├── VoiceDevControls.tsx   ← dev-only: state force buttons + speed slider
├── constants.ts           ← COLORS, STATES, PARTICLE_COUNT, RESPONSES, etc.
├── types.ts               ← VoiceState, VoiceOrbProps, etc.
└── useVoiceState.ts       ← state machine hook (auto-demo, transitions)
```

## Data Flow

### useVoiceState Hook

Single source of truth for all voice UI state:

```
useVoiceState()
  ├── state: VoiceState (IDLE | LISTENING | THINKING | SPEAKING | ERROR)
  ├── statusText: string
  ├── isTyping: boolean
  ├── whisperMode: boolean
  ├── muted: boolean
  ├── sessionEnded: boolean
  ├── speedMultiplier: number
  ├── toggleWhisper(): void
  ├── toggleMute(): void
  ├── endSession(): void
  ├── forceState(state): void      ← dev control
  ├── setSpeed(n): void            ← dev control
  └── resumeAutoDemo(): void       ← dev control
```

`<VoiceMode>` calls the hook and passes relevant slices to children as props.

### VoiceOrb — The Canvas Bridge

The critical performance pattern: props are stored in refs so the animation loop reads current values without causing re-renders.

```tsx
function VoiceOrb({ state, whisperMode, muted, speed, sessionEnded }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Store props in refs — animation loop reads these, not React state
  const stateRef = useRef(state);
  stateRef.current = state;
  // ... same for whisperMode, muted, speed, sessionEnded

  useEffect(() => {
    // Initialize: particles, circuit board, sprites — ONCE
    // Start requestAnimationFrame loop
    // Loop reads from refs, writes to canvas
    return () => cancelAnimationFrame(rafId);
  }, []); // empty deps = mount/unmount only
}
```

The animation loop reads from refs, never from React state. React re-renders only happen when controls change — those re-renders update the refs, which the next animation frame picks up automatically.

### Render Pipeline (preserved from POC)

Single-pass per frame, all on one canvas:

1. Trail clear (`rgba` fill for motion blur)
2. Circuit board stamp (offscreen canvas → `drawImage` at 0.06 opacity)
3. Sort particles back-to-front by Z
4. Draw particles (sprite cache, additive blending, z-depth projection)
5. Spawn + draw electron arcs
6. Draw ring glow (state-dependent behavior)

## Subsystems Extracted from POC

### Particle Engine (~1000 particles)

- Fibonacci sphere distribution for home positions
- Per-state physics: spring forces (IDLE), contraction + vibration (LISTENING), vortex swirl (THINKING), expansion + pulse (SPEAKING), scatter/reconverge (ERROR)
- Velocity integration with damping (0.97)
- Sprite cache: pre-rendered radial gradients on offscreen canvases, keyed by RGB
- Random spark effect: brief flash on random particles

### Circuit Board Background

- Seeded PRNG for deterministic pattern
- 4-layer generator: radial bus lines, branching networks, chip-zone stubs, scattered pads
- Per-segment alpha falloff from center
- Drawn once to offscreen canvas, stamped each frame

### Ring Glow

- Hair-thin ring at 1.15x orb radius
- State-dependent alpha and width
- THINKING: spinning arc segment
- SPEAKING: radiating pulse ring

### Electron Arcs

- Random zig-zag paths between front-facing particles
- Glow layer + sharp core, fade over 12 frames
- Spawn rate gated by state (IDLE, LISTENING, SPEAKING only)

## Integration

### Mode Switching

```tsx
// In App.tsx or Layout.tsx
{mode === 'voice' ? <VoiceMode /> : <ChatPanel />}
```

For now, mode switching is a simple state toggle or URL param. Real wiring to Vox and WebSocket session comes in a future integration pass.

### Styling

- **Tailwind classes** for layout (positioning, flex, z-index)
- **CSS variables** added to `web/src/index.css` for the voice-specific palette (tuned to match the Friday logo — slightly warmer than the existing theme)
- **CSS keyframes** in index.css for ellipsis animation
- **Inline styles** only where Canvas rendering requires dynamic values

### Voice Palette (from logo-matched POC)

| Token | Hex | Usage |
|-------|-----|-------|
| Voice Deep | `#0D1117` | Background |
| Voice BG | `#131A24` | — |
| Voice Surface | `#1A2332` | Button hover fills |
| Voice Amber | `#E8943A` | Primary accent, ring, particles |
| Voice Amber Light | `#FFD090` | Speaking state highlight |
| Voice Copper | `#C47A3A` | Thinking state accent |
| Voice Text | `#F0E6D8` | Status text |
| Voice Text Dim | `#6B5540` | Subtitle, secondary text |

### Dev Controls Gating

```tsx
const showDevControls = import.meta.env.DEV
  || new URLSearchParams(window.location.search).has('dev');

{showDevControls && <VoiceDevControls ... />}
```

## Non-Goals

- No audio input/output wiring (Vox integration is a separate task)
- No WebSocket connection to runtime (future integration)
- No routing library — simple conditional render for mode switching
- No unit tests for the Canvas render loop (untestable imperative code — test the hook instead)
