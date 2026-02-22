# Hero Header Splash Screen Design

**Goal:** Display a full-screen hero header when Friday's TUI launches — the friday-logo.jpeg rendered as half+block truecolor terminal art via chafa, with an ASCIIFont title, that fades out before transitioning to the chat view.

**Validated by:** `/tmp/friday-hero-demo/` prototype (half+block truecolor mode).

---

## Architecture

The hero header is a startup splash screen — a full-screen component shown before the chat view. It lives as a peer to the chat layout in `FridayApp`, controlled by a state machine:

```
boot → "splash" (render hero, start 2s hold timer)
     → "fading" (lerp colors toward background over 1.5s via useTimeline)
     → "chat"  (unmount splash, mount chat view)
```

Pressing any key during the splash immediately triggers the fade or jumps to chat.

### New Files

| File | Purpose |
|------|---------|
| `src/cli/tui/lib/ansi-parser.ts` | Parse chafa ANSI SGR output into `{text, fg?, bg?}` spans |
| `src/cli/tui/lib/logo-processor.ts` | Wrap chafa to produce `LogoData` (parsed lines + dimensions) |
| `src/cli/tui/components/splash.tsx` | `SplashScreen` component with fade animation |

### Modified Files

| File | Change |
|------|--------|
| `src/cli/tui/components/friday-app.tsx` | State machine: splash → fading → chat |
| `src/core/runtime.ts` | Process logo during boot (parallel with other init) |

### Data Flow

```
FridayRuntime.boot()
  → logoProcessor.processLogo("friday-logo.jpeg", width, height)
    → Bun.spawn(["chafa", ...args])
    → parseAnsiOutput(rawLines) → ParsedLine[]
  → LogoData passed to FridayApp as prop

FridayApp state="splash"
  → <SplashScreen logoData={logoData} onComplete={→ setState("chat")} />
    → useTimeline: 2s hold, then 1.5s fade (outQuad easing)
    → useKeyboard: any key → skip to chat
    → Each span color lerped: lerp(original, #0D1117, progress)

FridayApp state="chat"
  → <ChatLayout /> (normal TUI)
```

---

## Splash Screen Component

Three centered elements stacked vertically with `gap: 1`:

1. **Logo** — chafa half+block truecolor art rendered as `<text>` with `<span fg bg>` per color run
2. **Title** — `<ascii-font text="F.R.I.D.A.Y." font="block" color={amberPrimary} />`
3. **Subtitle** — "Female Replacement Intelligent Digital Assistant Youth" in amber dim + version string

### Fade-Out Animation

Terminals don't have true opacity. Instead, every color is lerped toward the background color (`#0D1117`):

- `progress=0`: original colors (full image)
- `progress=0.5`: colors halfway to background
- `progress=1`: everything matches background (invisible)

Implementation uses OpenTUI's `useTimeline`:
- 2s hold at `progress=0`
- 1.5s animation from 0→1 with `outQuad` easing
- `onUpdate` sets `fadeProgress` state, triggering re-render
- `onComplete` fires callback to switch FridayApp to chat state

### Color Lerp Function

```typescript
function lerpColor(hex: string, target: string, t: number): string {
  // Parse both hex colors to RGB
  // Return: rgb + (target - rgb) * t for each channel
  // Output as hex string
}
```

Pure function. `t=0` returns `hex`, `t=1` returns `target`.

---

## chafa Integration

### Command

```bash
chafa --format=symbols \
  --size={width}x{height} \
  --symbols half+block \
  --colors=full \
  --color-space=din99d \
  --work=9 \
  friday-logo.jpeg
```

- `--format=symbols`: force text output (not iTerm2 inline images)
- `--symbols half+block`: half-block characters (▀▄█) with fg+bg colors per cell
- `--colors=full`: 24-bit truecolor ANSI output
- `--color-space=din99d`: perceptually uniform color matching
- `--work=9`: maximum quality

### ANSI Parser

Parses chafa's ANSI output into structured spans:

```typescript
interface ColorSpan {
  text: string;
  fg?: string;  // hex "#RRGGBB"
  bg?: string;  // hex "#RRGGBB"
}
type ParsedLine = ColorSpan[];
```

Handles:
- SGR sequences: `\e[38;2;R;G;Bm` (fg truecolor), `\e[48;2;R;G;Bm` (bg truecolor), `\e[0m` (reset)
- 256-color fallback: `\e[38;5;Nm`, `\e[48;5;Nm`
- DEC private modes: `\e[?25l` / `\e[?25h` (cursor hide/show) — stripped, not rendered
- Consecutive characters with identical colors merged into single spans

### Logo Sizing

Default: 80 columns x 40 rows. Can be scaled to terminal dimensions using `useTerminalDimensions()` if desired. The image's aspect ratio is preserved by chafa automatically.

---

## Dependency: chafa

**Required runtime dependency.**

On boot, check with `Bun.which("chafa")`. If missing:

```
Friday requires chafa for the hero header.
Install: brew install chafa
```

Exit with code 1.

If chafa runs but produces no output (corrupt image, missing file), skip the splash and go straight to chat. Log a warning via the existing notification system.

---

## Color Palette

Reuses the existing Friday TUI palette from the theme:

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#0D1117` | Splash background, fade target |
| `amberPrimary` | `#F0A030` | ASCIIFont title color |
| `amberDim` | `#8B6914` | Subtitle text |
| `textMuted` | `#7D8590` | Version string |
| `copperAccent` | `#C07020` | (available for decorative elements) |

---

## Testing Strategy

| Component | Approach |
|-----------|----------|
| ANSI parser | Unit tests: feed known SGR sequences, assert correct spans. Test cursor hide/show stripping. Test 256-color conversion. |
| Logo processor | Mock `Bun.spawn` to return known chafa output. Verify parsed structure. Test chafa-not-found error path. |
| Color lerp | Pure function: test boundaries (t=0 → original, t=1 → background), test midpoints. |
| Splash state machine | Test transitions: splash → fading → chat. Test keypress skip. Test onComplete callback. |

No integration tests — visual verification in terminal is the real test for this component.

---

## Prototype Reference

The working prototype at `/tmp/friday-hero-demo/` validates:
- chafa half+block truecolor produces excellent logo reproduction (woman's profile, "F", circuit traces all visible)
- ANSI parser correctly extracts per-character fg/bg colors from chafa output
- OpenTUI `<span fg bg>` renders parsed colors correctly
- ASCIIFont "block" at amber primary looks great below the logo
