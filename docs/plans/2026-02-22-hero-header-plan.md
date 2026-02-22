# Hero Header Splash Screen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full-screen hero header splash that shows the Friday logo (chafa half+block truecolor) and ASCIIFont title on TUI launch, then fades out to the chat view.

**Architecture:** Three new files (ANSI parser, logo processor, splash component) plus two modifications (state machine gets "splash"/"fading" phases, app.tsx gates chat behind splash completion). Logo is processed during boot via `Bun.spawn("chafa")`, parsed into `{text, fg, bg}` spans, and rendered with OpenTUI `<span>` elements. Fade-out lerps all colors toward `#0D1117` over 1.5s using `useTimeline`.

**Tech Stack:** Bun, TypeScript, OpenTUI React, chafa (CLI tool), bun:test

**Design doc:** `docs/plans/2026-02-22-hero-header-design.md`

---

### Task 1: ANSI Parser — Color Lerp Function

**Files:**
- Create: `src/cli/tui/lib/color-utils.ts`
- Test: `tests/unit/tui-color-utils.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/tui-color-utils.test.ts
import { describe, test, expect } from "bun:test";
import { lerpColor, parseHex } from "../../src/cli/tui/lib/color-utils.ts";

describe("parseHex", () => {
  test("parses 6-digit hex", () => {
    expect(parseHex("#F0A030")).toEqual({ r: 240, g: 160, b: 48 });
  });

  test("parses lowercase hex", () => {
    expect(parseHex("#0d1117")).toEqual({ r: 13, g: 17, b: 23 });
  });
});

describe("lerpColor", () => {
  test("t=0 returns original color", () => {
    expect(lerpColor("#F0A030", "#0D1117", 0)).toBe("#f0a030");
  });

  test("t=1 returns target color", () => {
    expect(lerpColor("#F0A030", "#0D1117", 1)).toBe("#0d1117");
  });

  test("t=0.5 returns midpoint", () => {
    // midpoint of #F0A030 and #0D1117: r=(240+13)/2=126, g=(160+17)/2=88, b=(48+23)/2=35
    expect(lerpColor("#F0A030", "#0D1117", 0.5)).toBe("#7e5823");
  });

  test("t clamped below 0", () => {
    expect(lerpColor("#FF0000", "#000000", -0.5)).toBe("#ff0000");
  });

  test("t clamped above 1", () => {
    expect(lerpColor("#FF0000", "#000000", 1.5)).toBe("#000000");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-color-utils.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/cli/tui/lib/color-utils.ts

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): RGB {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}

function toHex(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Linearly interpolate between two hex colors.
 * t=0 returns `from`, t=1 returns `to`.
 */
export function lerpColor(from: string, to: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const a = parseHex(from);
  const b = parseHex(to);
  return rgbToHex(
    a.r + (b.r - a.r) * clamped,
    a.g + (b.g - a.g) * clamped,
    a.b + (b.b - a.b) * clamped,
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-color-utils.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/cli/tui/lib/color-utils.ts tests/unit/tui-color-utils.test.ts
git commit -m "feat(tui): add color lerp utility for splash fade animation"
```

---

### Task 2: ANSI Parser

**Files:**
- Create: `src/cli/tui/lib/ansi-parser.ts`
- Test: `tests/unit/tui-ansi-parser.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/tui-ansi-parser.test.ts
import { describe, test, expect } from "bun:test";
import { parseAnsiLine, parseAnsiOutput } from "../../src/cli/tui/lib/ansi-parser.ts";

describe("parseAnsiLine", () => {
  test("plain text returns single span", () => {
    const spans = parseAnsiLine("hello");
    expect(spans).toEqual([{ text: "hello" }]);
  });

  test("truecolor foreground", () => {
    const spans = parseAnsiLine("\x1b[38;2;240;160;48mhello\x1b[0m");
    expect(spans).toEqual([{ text: "hello", fg: "#f0a030" }]);
  });

  test("truecolor fg + bg", () => {
    const spans = parseAnsiLine("\x1b[38;2;255;0;0m\x1b[48;2;0;0;255mAB\x1b[0m");
    expect(spans).toEqual([{ text: "AB", fg: "#ff0000", bg: "#0000ff" }]);
  });

  test("reset clears colors", () => {
    const spans = parseAnsiLine("\x1b[38;2;255;0;0mA\x1b[0mB");
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual({ text: "A", fg: "#ff0000" });
    expect(spans[1]).toEqual({ text: "B" });
  });

  test("strips DEC private mode sequences", () => {
    const spans = parseAnsiLine("\x1b[?25lhello\x1b[?25h");
    expect(spans).toEqual([{ text: "hello" }]);
  });

  test("merges adjacent spans with same colors", () => {
    const spans = parseAnsiLine("\x1b[38;2;255;0;0mA\x1b[38;2;255;0;0mB\x1b[0m");
    expect(spans).toEqual([{ text: "AB", fg: "#ff0000" }]);
  });

  test("256-color foreground", () => {
    const spans = parseAnsiLine("\x1b[38;5;196mred\x1b[0m");
    expect(spans).toHaveLength(1);
    expect(spans[0]!.text).toBe("red");
    expect(spans[0]!.fg).toBeDefined();
  });

  test("empty line returns empty array", () => {
    expect(parseAnsiLine("")).toEqual([]);
  });
});

describe("parseAnsiOutput", () => {
  test("parses multiple lines", () => {
    const result = parseAnsiOutput(["hello", "\x1b[38;2;255;0;0mworld\x1b[0m"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([{ text: "hello" }]);
    expect(result[1]).toEqual([{ text: "world", fg: "#ff0000" }]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-ansi-parser.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/cli/tui/lib/ansi-parser.ts
import { rgbToHex } from "./color-utils.ts";

export interface ColorSpan {
  text: string;
  fg?: string;
  bg?: string;
}

export type ParsedLine = ColorSpan[];

function parseSgrParams(
  params: number[],
  state: { fg?: string; bg?: string },
): void {
  let i = 0;
  while (i < params.length) {
    const p = params[i]!;
    if (p === 0) {
      state.fg = undefined;
      state.bg = undefined;
      i++;
    } else if (p === 38) {
      if (params[i + 1] === 2) {
        state.fg = rgbToHex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        i += 5;
      } else if (params[i + 1] === 5) {
        state.fg = ansi256ToHex(params[i + 2] ?? 0);
        i += 3;
      } else {
        i++;
      }
    } else if (p === 48) {
      if (params[i + 1] === 2) {
        state.bg = rgbToHex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        i += 5;
      } else if (params[i + 1] === 5) {
        state.bg = ansi256ToHex(params[i + 2] ?? 0);
        i += 3;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
}

function ansi256ToHex(n: number): string {
  if (n < 16) {
    const standard = [
      "#000000", "#800000", "#008000", "#808000",
      "#000080", "#800080", "#008080", "#c0c0c0",
      "#808080", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ];
    return standard[n] ?? "#000000";
  }
  if (n < 232) {
    const idx = n - 16;
    const b = (idx % 6) * 51;
    const g = (Math.floor(idx / 6) % 6) * 51;
    const r = Math.floor(idx / 36) * 51;
    return rgbToHex(r, g, b);
  }
  const gray = (n - 232) * 10 + 8;
  return rgbToHex(gray, gray, gray);
}

export function parseAnsiLine(line: string): ParsedLine {
  const spans: ColorSpan[] = [];
  const state = { fg: undefined as string | undefined, bg: undefined as string | undefined };

  // biome-ignore lint/suspicious/noControlCharactersInRegex: parsing ANSI escape codes
  const regex = /\x1b\[([0-9;]*)m|\x1b\[\??[0-9;]*[A-Za-z]|([^\x1b]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match[1] !== undefined) {
      const params = match[1].split(";").map(Number);
      parseSgrParams(params, state);
    } else if (match[2]) {
      const text = match[2];
      const lastSpan = spans[spans.length - 1];
      if (lastSpan && lastSpan.fg === state.fg && lastSpan.bg === state.bg) {
        lastSpan.text += text;
      } else {
        const span: ColorSpan = { text };
        if (state.fg) span.fg = state.fg;
        if (state.bg) span.bg = state.bg;
        spans.push(span);
      }
    }
  }

  if (spans.length === 0 && line.length > 0) {
    spans.push({ text: line });
  }

  return spans;
}

export function parseAnsiOutput(lines: string[]): ParsedLine[] {
  return lines.map(parseAnsiLine);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-ansi-parser.test.ts`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add src/cli/tui/lib/ansi-parser.ts tests/unit/tui-ansi-parser.test.ts
git commit -m "feat(tui): add ANSI SGR parser for chafa output"
```

---

### Task 3: Logo Processor

**Files:**
- Create: `src/cli/tui/lib/logo-processor.ts`
- Test: `tests/unit/tui-logo-processor.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/tui-logo-processor.test.ts
import { describe, test, expect } from "bun:test";
import { processLogo, checkChafa } from "../../src/cli/tui/lib/logo-processor.ts";

describe("checkChafa", () => {
  test("returns true when chafa binary exists", () => {
    // chafa should be installed (required dependency)
    const result = checkChafa();
    expect(result).toBe(true);
  });
});

describe("processLogo", () => {
  test("returns LogoData with parsedLines and dimensions", async () => {
    // Uses actual chafa with the project logo
    const logoPath = new URL("../../friday-logo.jpeg", import.meta.url).pathname;
    const data = await processLogo(logoPath, 20, 10);

    expect(data).not.toBeNull();
    expect(data!.parsedLines.length).toBeGreaterThan(0);
    expect(data!.parsedLines.length).toBeLessThanOrEqual(10);
    expect(data!.width).toBeGreaterThan(0);
    expect(data!.height).toBeGreaterThan(0);

    // Each line should have at least one span
    for (const line of data!.parsedLines) {
      expect(line.length).toBeGreaterThan(0);
    }
  });

  test("returns null when image file missing", async () => {
    const data = await processLogo("/nonexistent/image.jpg", 20, 10);
    expect(data).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-logo-processor.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/cli/tui/lib/logo-processor.ts
import { parseAnsiOutput, type ParsedLine } from "./ansi-parser.ts";

export interface LogoData {
  parsedLines: ParsedLine[];
  width: number;
  height: number;
}

/**
 * Check if chafa is installed.
 */
export function checkChafa(): boolean {
  return Bun.which("chafa") !== null;
}

function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
  return str.replace(/\x1b\[\??[0-9;]*[A-Za-z]/g, "");
}

/**
 * Process an image into parsed terminal art using chafa.
 * Returns null if chafa fails (missing image, chafa error, etc).
 */
export async function processLogo(
  imagePath: string,
  width: number,
  height: number,
): Promise<LogoData | null> {
  try {
    const args = [
      "--format=symbols",
      `--size=${width}x${height}`,
      "--symbols", "half+block",
      "--colors=full",
      "--color-space=din99d",
      "--work=9",
      imagePath,
    ];

    const proc = Bun.spawn(["chafa", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) return null;

    const lines = output.split("\n");
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
      lines.pop();
    }

    if (lines.length === 0) return null;

    const parsedLines = parseAnsiOutput(lines);
    const maxWidth = lines.reduce(
      (max, line) => Math.max(max, stripAnsi(line).length),
      0,
    );

    return { parsedLines, width: maxWidth, height: lines.length };
  } catch {
    return null;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-logo-processor.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/cli/tui/lib/logo-processor.ts tests/unit/tui-logo-processor.test.ts
git commit -m "feat(tui): add chafa-based logo processor"
```

---

### Task 4: Extend AppState with Splash Phases

**Files:**
- Modify: `src/cli/tui/state.ts`
- Modify: `tests/unit/tui-state.test.ts`

**Step 1: Write the failing tests**

Add these tests to the end of `tests/unit/tui-state.test.ts` inside the existing `describe("TUI state reducer", ...)` block:

```typescript
test("set-phase accepts splash phase", () => {
  const state = appReducer(initialState, {
    type: "set-phase",
    phase: "splash",
  });
  expect(state.phase).toBe("splash");
});

test("set-phase accepts fading phase", () => {
  const state = appReducer(initialState, {
    type: "set-phase",
    phase: "fading",
  });
  expect(state.phase).toBe("fading");
});

test("initialState phase is splash", () => {
  expect(initialState.phase).toBe("splash");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: FAIL — type errors for "splash" and "fading" phases

**Step 3: Modify state.ts**

In `src/cli/tui/state.ts`:

Change line 9 from:
```typescript
phase: "booting" | "active" | "shutting-down";
```
to:
```typescript
phase: "splash" | "fading" | "booting" | "active" | "shutting-down";
```

Change line 21 from:
```typescript
phase: "booting",
```
to:
```typescript
phase: "splash",
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: PASS (all existing + 3 new tests)

**Step 5: Commit**

```bash
git add src/cli/tui/state.ts tests/unit/tui-state.test.ts
git commit -m "feat(tui): add splash and fading phases to app state"
```

---

### Task 5: Splash Screen Component

**Files:**
- Create: `src/cli/tui/components/splash.tsx`

No unit test for this task — it is a visual React component. Testing is done in Task 7 (manual verification).

**Step 1: Create the splash component**

```tsx
// src/cli/tui/components/splash.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { useKeyboard, useTimeline } from "@opentui/react";
import { PALETTE } from "../theme.ts";
import { lerpColor } from "../lib/color-utils.ts";
import type { LogoData } from "../lib/logo-processor.ts";
import type { ParsedLine } from "../lib/ansi-parser.ts";

interface SplashScreenProps {
  logoData: LogoData;
  onComplete: () => void;
}

function FadedLine({ spans, fadeProgress, bg }: {
  spans: ParsedLine;
  fadeProgress: number;
  bg: string;
}) {
  return (
    <text>
      {spans.map((s, i) => (
        <span
          key={i}
          fg={s.fg ? lerpColor(s.fg, bg, fadeProgress) : undefined}
          bg={s.bg ? lerpColor(s.bg, bg, fadeProgress) : undefined}
        >
          {s.text}
        </span>
      ))}
    </text>
  );
}

export function SplashScreen({ logoData, onComplete }: SplashScreenProps) {
  const [fadeProgress, setFadeProgress] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadingRef = useRef(false);
  const bg = PALETTE.background;

  const timeline = useTimeline();

  const startFade = useCallback(() => {
    if (fadingRef.current) return;
    fadingRef.current = true;

    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    const target = { progress: 0 };
    timeline.add(target, {
      duration: 1500,
      progress: 1,
      ease: "outQuad",
      onUpdate: () => {
        setFadeProgress(target.progress);
      },
      onComplete: () => {
        onComplete();
      },
    });
    timeline.play();
  }, [timeline, onComplete]);

  // Start 2s hold timer on mount
  useEffect(() => {
    holdTimerRef.current = setTimeout(startFade, 2000);
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    };
  }, [startFade]);

  // Any keypress skips to chat
  useKeyboard(() => {
    onComplete();
  });

  // Fade the ASCIIFont title color
  const titleColor = lerpColor(PALETTE.amberPrimary, bg, fadeProgress);
  const subtitleColor = lerpColor(PALETTE.amberDim, bg, fadeProgress);
  const versionColor = lerpColor(PALETTE.textMuted, bg, fadeProgress);

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        gap: 1,
      }}
    >
      {/* Logo */}
      <box style={{ flexDirection: "column", alignItems: "center" }}>
        {logoData.parsedLines.map((spans, i) => (
          <FadedLine key={`l-${i}`} spans={spans} fadeProgress={fadeProgress} bg={bg} />
        ))}
      </box>

      {/* Title */}
      <ascii-font text="F.R.I.D.A.Y." font="block" color={titleColor} />

      {/* Subtitle */}
      <box style={{ flexDirection: "column", alignItems: "center" }}>
        <text fg={subtitleColor}>
          Female Replacement Intelligent Digital Assistant Youth
        </text>
        <text fg={versionColor}>── v0.1.0 ──</text>
      </box>
    </box>
  );
}
```

**Step 2: Run lint to verify no errors**

Run: `bun run lint`
Expected: No errors in splash.tsx

**Step 3: Commit**

```bash
git add src/cli/tui/components/splash.tsx
git commit -m "feat(tui): add splash screen component with fade animation"
```

---

### Task 6: Wire Splash into FridayApp

**Files:**
- Modify: `src/cli/tui/app.tsx`

**Step 1: Add imports**

Add these imports at the top of `src/cli/tui/app.tsx`:

```typescript
import { SplashScreen } from "./components/splash.tsx";
import { processLogo, checkChafa, type LogoData } from "./lib/logo-processor.ts";
```

**Step 2: Add logo state and boot-time processing**

Inside the `FridayApp` component, add a `logoDataRef`:

```typescript
const logoDataRef = useRef<LogoData | null>(null);
```

In the boot `useEffect`, add logo processing BEFORE `runtime.boot()`:

```typescript
if (checkChafa()) {
  const logoPath = new URL("../../../friday-logo.jpeg", import.meta.url).pathname;
  logoDataRef.current = await processLogo(logoPath, 80, 40);
}

// If logo failed to load, skip splash and go straight to booting
if (!logoDataRef.current) {
  dispatch({ type: "set-phase", phase: "booting" });
}
```

**Step 3: Add splash rendering in the JSX**

Add a phase guard BEFORE the existing return statement:

```tsx
if (state.phase === "splash" || state.phase === "fading") {
  if (logoDataRef.current) {
    return (
      <box style={{ width: "100%", height: "100%", backgroundColor: PALETTE.background }}>
        <SplashScreen
          logoData={logoDataRef.current}
          onComplete={() => dispatch({ type: "set-phase", phase: "booting" })}
        />
      </box>
    );
  }
}
```

**Step 4: Run lint**

Run: `bun run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add src/cli/tui/app.tsx
git commit -m "feat(tui): wire splash screen into FridayApp boot sequence"
```

---

### Task 7: Manual Verification and Polish

**Files:**
- Possibly tweak: `src/cli/tui/components/splash.tsx`
- Possibly tweak: `src/cli/tui/app.tsx`

**Step 1: Verify chafa requirement**

Run: `which chafa`
Expected: a path like `/opt/homebrew/bin/chafa`. If missing: `brew install chafa`

**Step 2: Run Friday TUI**

Run: `bun run dev` or `bun run start chat`

Expected behavior:
1. Full-screen splash appears with Friday logo in truecolor half-block art
2. "F.R.I.D.A.Y." title in amber block font below the logo
3. Subtitle and version below that
4. After 2 seconds, colors fade toward the dark background over 1.5s
5. Chat view appears after fade completes
6. Pressing any key during splash skips immediately to chat

**Step 3: Check edge cases**

- Resize terminal to small size (40x20) — splash should still render, just cropped
- Rapidly press keys during fade — should not crash or double-transition
- Run with `--fresh` flag — splash should still appear

**Step 4: Run full test suite**

Run: `bun test`
Expected: All existing tests still pass, plus new tests from Tasks 1-4

**Step 5: Final commit if any polish was needed**

```bash
git add -A
git commit -m "fix(tui): polish splash screen timing and edge cases"
```

---

### Task 8: Lint, Typecheck, and Final Cleanup

**Step 1: Lint all new files**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed

**Step 2: Type check**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 4: Final commit**

```bash
git add -A
git commit -m "style(tui): lint and format hero header files"
```

---

## File Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/cli/tui/lib/color-utils.ts` | Create | `parseHex()`, `rgbToHex()`, `lerpColor()` |
| `src/cli/tui/lib/ansi-parser.ts` | Create | `parseAnsiLine()`, `parseAnsiOutput()` |
| `src/cli/tui/lib/logo-processor.ts` | Create | `checkChafa()`, `processLogo()` |
| `src/cli/tui/components/splash.tsx` | Create | `SplashScreen` component with fade |
| `src/cli/tui/state.ts` | Modify | Add `"splash"` and `"fading"` phases |
| `src/cli/tui/app.tsx` | Modify | Gate chat behind splash, boot-time logo processing |
| `tests/unit/tui-color-utils.test.ts` | Create | 5 tests for color lerp |
| `tests/unit/tui-ansi-parser.test.ts` | Create | 9 tests for ANSI parsing |
| `tests/unit/tui-logo-processor.test.ts` | Create | 3 tests for logo processing |
| `tests/unit/tui-state.test.ts` | Modify | 3 new tests for splash/fading phases |
