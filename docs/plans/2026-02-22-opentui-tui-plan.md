# OpenTUI TUI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Friday's chalk/ora/boxen/typeahead-prompt CLI chat with a full-screen persistent TUI using `@opentui/react`.

**Architecture:** A React component tree rendered via `@opentui/react` with `createCliRenderer()`. The TUI owns the alternate screen buffer. FridayRuntime lifecycle (boot/shutdown/Forge restart) is managed inside the root component. State is pure React (`useReducer`). Toast notifications via `@opentui-ui/toast`.

**Tech Stack:** `@opentui/core`, `@opentui/react`, `@opentui-ui/toast`, Bun, TypeScript, `bun:test`

**Design doc:** `docs/plans/2026-02-22-opentui-tui-design.md`

**Important context:**
- `tsconfig.json` already has `"jsx": "react-jsx"` — needs `jsxImportSource` added for OpenTUI
- No `bunfig.toml` exists yet — may need one for preload
- `chat.ts` contains Forge restart logic (`runtime.restartRequested`, `forgeHealthReport`) that must be preserved
- `filterCommands()` in `typeahead-prompt.ts` is pure logic with tests — extract and reuse
- `strip-ansi.ts` utility is only used by `typeahead-prompt.ts` — can be removed with it
- Existing tests: `render.test.ts` (9 tests), `typeahead-prompt.test.ts` (13 tests) — will be replaced

---

### Task 1: Install dependencies and configure build

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `bunfig.toml` (if needed by `@opentui/react`)

**Step 1: Install OpenTUI packages**

Run:
```bash
bun add @opentui/core @opentui/react @opentui-ui/toast
```

**Step 2: Update tsconfig.json — add jsxImportSource**

In `tsconfig.json`, add `jsxImportSource` to `compilerOptions`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@opentui/react",
    ...
  }
}
```

**Step 3: Create bunfig.toml if needed**

Check `@opentui/react` docs. If it requires a preload script:

```toml
preload = ["@opentui/react/preload"]
```

If not required, skip this file.

**Step 4: Verify the build still works**

Run: `bun run typecheck`
Expected: PASS (no new type errors)

Run: `bun test`
Expected: All existing tests pass

**Step 5: Commit**

```bash
git add package.json tsconfig.json bunfig.toml bun.lock
git commit -m "chore: add OpenTUI dependencies and configure JSX"
```

---

### Task 2: Theme — color palette and syntax styles

**Files:**
- Create: `src/cli/tui/theme.ts`
- Create: `tests/unit/tui-theme.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/tui-theme.test.ts
import { describe, test, expect } from "bun:test";
import { PALETTE, FRIDAY_SYNTAX_STYLE } from "../../src/cli/tui/theme.ts";

describe("TUI theme", () => {
  test("PALETTE contains all required color roles", () => {
    const required = [
      "background", "surface", "amberPrimary", "amberGlow",
      "amberDim", "copperAccent", "textPrimary", "textMuted",
      "success", "error", "warning",
    ];
    for (const role of required) {
      expect(PALETTE).toHaveProperty(role);
      expect((PALETTE as Record<string, string>)[role]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test("PALETTE colors match design spec", () => {
    expect(PALETTE.background).toBe("#0D1117");
    expect(PALETTE.amberPrimary).toBe("#F0A030");
    expect(PALETTE.textPrimary).toBe("#E6EDF3");
    expect(PALETTE.error).toBe("#F85149");
  });

  test("FRIDAY_SYNTAX_STYLE is defined", () => {
    expect(FRIDAY_SYNTAX_STYLE).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-theme.test.ts`
Expected: FAIL — module not found

**Step 3: Implement theme.ts**

```typescript
// src/cli/tui/theme.ts
import { SyntaxStyle, RGBA } from "@opentui/core";

export const PALETTE = {
  background:   "#0D1117",
  surface:      "#161B22",
  amberPrimary: "#F0A030",
  amberGlow:    "#FFD080",
  amberDim:     "#8B6914",
  copperAccent: "#C07020",
  textPrimary:  "#E6EDF3",
  textMuted:    "#7D8590",
  success:      "#3FB950",
  error:        "#F85149",
  warning:      "#D29922",
} as const;

export const FRIDAY_SYNTAX_STYLE = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex(PALETTE.amberPrimary), bold: true },
  "markup.heading":   { fg: RGBA.fromHex(PALETTE.amberGlow), bold: true },
  "markup.list":      { fg: RGBA.fromHex(PALETTE.copperAccent) },
  "markup.raw":       { fg: RGBA.fromHex(PALETTE.amberGlow) },
  "markup.link":      { fg: RGBA.fromHex(PALETTE.amberPrimary), underline: true },
  default:            { fg: RGBA.fromHex(PALETTE.textPrimary) },
});
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-theme.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/cli/tui/theme.ts tests/unit/tui-theme.test.ts
git commit -m "feat(tui): add Friday amber color palette and syntax style"
```

---

### Task 3: State reducer, types, and exit word detection

**Files:**
- Create: `src/cli/tui/state.ts`
- Create: `tests/unit/tui-state.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/tui-state.test.ts
import { describe, test, expect } from "bun:test";
import {
  appReducer,
  initialState,
  isExitWord,
  createMessage,
  type AppState,
} from "../../src/cli/tui/state.ts";

describe("TUI state reducer", () => {
  test("initialState has correct defaults", () => {
    expect(initialState.phase).toBe("booting");
    expect(initialState.messages).toEqual([]);
    expect(initialState.isThinking).toBe(false);
  });

  test("add-message appends to messages", () => {
    const msg = createMessage("user", "Hello");
    const state = appReducer(initialState, { type: "add-message", message: msg });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]!.content).toBe("Hello");
    expect(state.messages[0]!.role).toBe("user");
  });

  test("add-message preserves existing messages", () => {
    const msg1 = createMessage("user", "First");
    const msg2 = createMessage("assistant", "Second");
    let state = appReducer(initialState, { type: "add-message", message: msg1 });
    state = appReducer(state, { type: "add-message", message: msg2 });
    expect(state.messages).toHaveLength(2);
  });

  test("set-thinking toggles isThinking", () => {
    const state = appReducer(initialState, { type: "set-thinking", value: true });
    expect(state.isThinking).toBe(true);
    const state2 = appReducer(state, { type: "set-thinking", value: false });
    expect(state2.isThinking).toBe(false);
  });

  test("set-phase transitions phase", () => {
    const state = appReducer(initialState, { type: "set-phase", phase: "active" });
    expect(state.phase).toBe("active");
  });

  test("set-phase to shutting-down works from active", () => {
    let state = appReducer(initialState, { type: "set-phase", phase: "active" });
    state = appReducer(state, { type: "set-phase", phase: "shutting-down" });
    expect(state.phase).toBe("shutting-down");
  });

  test("clear-messages resets messages array", () => {
    const msg = createMessage("user", "Hello");
    let state = appReducer(initialState, { type: "add-message", message: msg });
    state = appReducer(state, { type: "clear-messages" });
    expect(state.messages).toEqual([]);
  });
});

describe("isExitWord", () => {
  test("detects exit", () => expect(isExitWord("exit")).toBe(true));
  test("detects quit", () => expect(isExitWord("quit")).toBe(true));
  test("detects bye", () => expect(isExitWord("bye")).toBe(true));
  test("case insensitive", () => expect(isExitWord("EXIT")).toBe(true));
  test("trims whitespace", () => expect(isExitWord("  quit  ")).toBe(true));
  test("rejects normal input", () => expect(isExitWord("hello")).toBe(false));
  test("rejects empty string", () => expect(isExitWord("")).toBe(false));
  test("rejects partial match", () => expect(isExitWord("exiting")).toBe(false));
});

describe("createMessage", () => {
  test("creates message with id and timestamp", () => {
    const msg = createMessage("user", "Hello");
    expect(msg.id).toBeDefined();
    expect(msg.id.length).toBeGreaterThan(0);
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello");
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  test("generates unique ids", () => {
    const msg1 = createMessage("user", "A");
    const msg2 = createMessage("user", "B");
    expect(msg1.id).not.toBe(msg2.id);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: FAIL — module not found

**Step 3: Implement state.ts**

```typescript
// src/cli/tui/state.ts

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface AppState {
  phase: "booting" | "active" | "shutting-down";
  messages: Message[];
  isThinking: boolean;
}

export type AppAction =
  | { type: "add-message"; message: Message }
  | { type: "set-thinking"; value: boolean }
  | { type: "set-phase"; phase: AppState["phase"] }
  | { type: "clear-messages" };

export const initialState: AppState = {
  phase: "booting",
  messages: [],
  isThinking: false,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "add-message":
      return { ...state, messages: [...state.messages, action.message] };
    case "set-thinking":
      return { ...state, isThinking: action.value };
    case "set-phase":
      return { ...state, phase: action.phase };
    case "clear-messages":
      return { ...state, messages: [] };
  }
}

export function isExitWord(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return ["exit", "quit", "bye"].includes(trimmed);
}

export function createMessage(
  role: Message["role"],
  content: string,
): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date(),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: PASS (16 tests)

**Step 5: Commit**

```bash
git add src/cli/tui/state.ts tests/unit/tui-state.test.ts
git commit -m "feat(tui): add state reducer, message types, and exit word detection"
```

---

### Task 4: TuiChannel — notification bridge to toast

**Files:**
- Create: `src/cli/tui/channels/tui-channel.ts`
- Create: `tests/unit/tui-channel.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/tui-channel.test.ts
import { describe, test, expect } from "bun:test";
import { TuiChannel } from "../../src/cli/tui/channels/tui-channel.ts";
import type { FridayNotification } from "../../src/core/notifications.ts";

describe("TuiChannel", () => {
  test("has name 'tui'", () => {
    const channel = new TuiChannel(() => {});
    expect(channel.name).toBe("tui");
  });

  test("calls onNotify with formatted message for info", async () => {
    const calls: Array<{ level: string; text: string }> = [];
    const channel = new TuiChannel((level, text) => calls.push({ level, text }));
    const notification: FridayNotification = {
      level: "info",
      title: "Test Title",
      body: "Test body text",
      source: "test",
    };
    await channel.send(notification);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.level).toBe("info");
    expect(calls[0]!.text).toContain("Test Title");
    expect(calls[0]!.text).toContain("Test body text");
  });

  test("calls onNotify with alert level", async () => {
    const calls: Array<{ level: string; text: string }> = [];
    const channel = new TuiChannel((level, text) => calls.push({ level, text }));
    await channel.send({
      level: "alert",
      title: "Alert!",
      body: "Something broke",
      source: "test",
    });
    expect(calls[0]!.level).toBe("alert");
  });

  test("calls onNotify with warning level", async () => {
    const calls: Array<{ level: string; text: string }> = [];
    const channel = new TuiChannel((level, text) => calls.push({ level, text }));
    await channel.send({
      level: "warning",
      title: "Warning",
      body: "CPU high",
      source: "sensorium",
    });
    expect(calls[0]!.level).toBe("warning");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-channel.test.ts`
Expected: FAIL — module not found

**Step 3: Implement tui-channel.ts**

The TuiChannel accepts a callback function rather than importing toast directly. This keeps it testable without requiring the OpenTUI renderer. The actual `app.tsx` will wire the callback to `toast()`.

```typescript
// src/cli/tui/channels/tui-channel.ts
import type {
  NotificationChannel,
  FridayNotification,
} from "../../../core/notifications.ts";

export type ToastCallback = (level: FridayNotification["level"], text: string) => void;

export class TuiChannel implements NotificationChannel {
  name = "tui";

  constructor(private onNotify: ToastCallback) {}

  async send(notification: FridayNotification): Promise<void> {
    this.onNotify(
      notification.level,
      `${notification.title}: ${notification.body}`,
    );
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-channel.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/cli/tui/channels/tui-channel.ts tests/unit/tui-channel.test.ts
git commit -m "feat(tui): add TuiChannel notification bridge"
```

---

### Task 5: Extract filterCommands to shared utility

**Files:**
- Create: `src/cli/tui/filter-commands.ts`
- Modify: `tests/unit/typeahead-prompt.test.ts` → update import path
- Note: `typeahead-prompt.ts` still exists at this point — we'll remove it later

The `filterCommands()` function and `TypeaheadEntry` type are pure logic reused by the new CommandTypeahead. Extract them so the old typeahead and new component can both import from the same place.

**Step 1: Create filter-commands.ts**

```typescript
// src/cli/tui/filter-commands.ts

export interface TypeaheadEntry {
  name: string;
  description: string;
  aliases: string[];
}

const MAX_SUGGESTIONS = 6;

export function filterCommands(
  commands: TypeaheadEntry[],
  query: string,
): TypeaheadEntry[] {
  if (!query) return commands;
  const q = query.toLowerCase();
  return commands
    .filter(
      (cmd) =>
        cmd.name.toLowerCase().startsWith(q) ||
        cmd.aliases.some((a) => a.toLowerCase().startsWith(q)),
    )
    .slice(0, MAX_SUGGESTIONS);
}
```

**Step 2: Update typeahead-prompt.ts to import from filter-commands.ts**

In `src/cli/typeahead-prompt.ts`, replace the local `TypeaheadEntry` interface and `filterCommands` function with imports:

```typescript
import { filterCommands, type TypeaheadEntry } from "./tui/filter-commands.ts";
```

Remove the local `TypeaheadEntry` interface, `filterCommands` function, and `MAX_SUGGESTIONS` constant. Keep the `formatSuggestionLine` and `typeaheadPrompt` functions. Re-export `TypeaheadEntry` so existing consumers (`chat.ts`) don't break:

```typescript
export { type TypeaheadEntry } from "./tui/filter-commands.ts";
```

**Step 3: Update the test import**

In `tests/unit/typeahead-prompt.test.ts`, update the `filterCommands` import to come from the new location:

```typescript
import { filterCommands, type TypeaheadEntry } from "../../src/cli/tui/filter-commands.ts";
import { formatSuggestionLine } from "../../src/cli/typeahead-prompt.ts";
```

**Step 4: Run tests to verify nothing broke**

Run: `bun test tests/unit/typeahead-prompt.test.ts`
Expected: PASS (13 tests — all existing tests still pass)

Run: `bun test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/cli/tui/filter-commands.ts src/cli/typeahead-prompt.ts tests/unit/typeahead-prompt.test.ts
git commit -m "refactor: extract filterCommands to shared tui utility"
```

---

### Task 6: Header, ThinkingIndicator, and Message components

**Files:**
- Create: `src/cli/tui/components/header.tsx`
- Create: `src/cli/tui/components/thinking.tsx`
- Create: `src/cli/tui/components/message.tsx`

No unit tests for these — they are thin visual components (design doc Section 10). Verified by manual testing and typecheck.

**Step 1: Create header.tsx**

```tsx
// src/cli/tui/components/header.tsx
import { PALETTE } from "../theme.ts";

interface HeaderProps {
  provider: string;
  model: string;
}

export function Header({ provider, model }: HeaderProps) {
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      width="100%"
      height={1}
      borderBottom
      borderColor={PALETTE.copperAccent}
    >
      <text fg={PALETTE.amberPrimary} bold>
        {" "}F.R.I.D.A.Y.
      </text>
      <text fg={PALETTE.amberDim}>
        {provider}: {model}{" "}
      </text>
    </box>
  );
}
```

**Step 2: Create thinking.tsx**

```tsx
// src/cli/tui/components/thinking.tsx
import { useState, useEffect } from "react";
import { PALETTE } from "../theme.ts";

export function ThinkingIndicator() {
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <box flexDirection="row" gap={1} paddingLeft={1}>
      <text fg={PALETTE.amberPrimary} bold>
        Friday:
      </text>
      <text fg={PALETTE.amberDim}>thinking{dots}</text>
    </box>
  );
}
```

**Step 3: Create message.tsx**

```tsx
// src/cli/tui/components/message.tsx
import { useRenderer } from "@opentui/react";
import { MarkdownRenderable } from "@opentui/core";
import { PALETTE, FRIDAY_SYNTAX_STYLE } from "../theme.ts";
import type { Message as MessageType } from "../state.ts";

interface MessageProps {
  message: MessageType;
  width: number;
}

export function Message({ message, width }: MessageProps) {
  const { role, content } = message;

  if (role === "user") {
    return (
      <box flexDirection="row" gap={1} paddingLeft={1}>
        <text fg={PALETTE.amberGlow} bold>You:</text>
        <text fg={PALETTE.textPrimary}>{content}</text>
      </box>
    );
  }

  if (role === "system") {
    // System messages: errors use error color, others use muted
    const isError = content.toLowerCase().startsWith("error") ||
                    content.toLowerCase().startsWith("something went wrong");
    return (
      <box paddingLeft={1}>
        <text fg={isError ? PALETTE.error : PALETTE.textMuted}>{content}</text>
      </box>
    );
  }

  // Assistant messages — use MarkdownRenderable
  // Note: MarkdownRenderable is an imperative component from @opentui/core.
  // Integration with React requires using useRenderer() and a ref-based approach.
  // If @opentui/react provides a <markdown> JSX element, use that instead.
  // Otherwise, wrap the imperative API in a React component.
  // Check Context7 docs at implementation time for the exact React integration pattern.
  return (
    <box flexDirection="column" paddingLeft={1} gap={0}>
      <text fg={PALETTE.amberPrimary} bold>Friday:</text>
      <box paddingLeft={2}>
        {/* TODO: Wire MarkdownRenderable here. For now, plain text fallback. */}
        <text fg={PALETTE.textPrimary}>{content}</text>
      </box>
    </box>
  );
}
```

> **Implementation note:** The MarkdownRenderable is an imperative `@opentui/core` class. At implementation time, use Context7 to look up the exact pattern for using imperative renderables inside `@opentui/react` components. It may require `useRenderer()` + `useEffect()` to mount the renderable, or `@opentui/react` may expose a `<markdown>` JSX element directly.

**Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/tui/components/header.tsx src/cli/tui/components/thinking.tsx src/cli/tui/components/message.tsx
git commit -m "feat(tui): add Header, ThinkingIndicator, and Message components"
```

---

### Task 7: ChatArea component

**Files:**
- Create: `src/cli/tui/components/chat-area.tsx`

**Step 1: Create chat-area.tsx**

The ChatArea is a scrollable container that displays messages and auto-scrolls to bottom.

```tsx
// src/cli/tui/components/chat-area.tsx
import { PALETTE } from "../theme.ts";
import { Message } from "./message.tsx";
import { ThinkingIndicator } from "./thinking.tsx";
import type { Message as MessageType } from "../state.ts";

interface ChatAreaProps {
  messages: MessageType[];
  isThinking: boolean;
}

export function ChatArea({ messages, isThinking }: ChatAreaProps) {
  // OpenTUI handles scroll with overflow properties.
  // Auto-scroll behavior: the box should scroll to bottom when children change.
  // Check Context7 docs for scroll-to-bottom pattern at implementation time.
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      overflow="scroll"
      backgroundColor={PALETTE.background}
      gap={1}
      paddingTop={1}
      paddingBottom={1}
    >
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} width={80} />
      ))}
      {isThinking && <ThinkingIndicator />}
    </box>
  );
}
```

**Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/tui/components/chat-area.tsx
git commit -m "feat(tui): add ChatArea scrollable message container"
```

---

### Task 8: InputBar and CommandTypeahead components

**Files:**
- Create: `src/cli/tui/components/input-bar.tsx`
- Create: `src/cli/tui/components/command-typeahead.tsx`

**Step 1: Create command-typeahead.tsx**

The typeahead is an `<input>` that shows a dropdown when the user types `/`. It manages its own local state (input text, selected index, suggestions visible).

```tsx
// src/cli/tui/components/command-typeahead.tsx
import { useState, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { PALETTE } from "../theme.ts";
import { filterCommands, type TypeaheadEntry } from "../filter-commands.ts";

interface CommandTypeaheadProps {
  commands: TypeaheadEntry[];
  disabled: boolean;
  placeholder: string;
  onSubmit: (input: string) => void;
  onExit: () => void;
}

export function CommandTypeahead({
  commands,
  disabled,
  placeholder,
  onSubmit,
  onExit,
}: CommandTypeaheadProps) {
  const [input, setInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const suggestions = input.startsWith("/") && !input.includes(" ")
    ? filterCommands(commands, input.slice(1))
    : [];
  const hasSuggestions = suggestions.length > 0;

  useKeyboard((key) => {
    if (disabled) return;

    // Ctrl+C — exit
    if (key.ctrl && key.name === "c") {
      onExit();
      return;
    }

    // Ctrl+U — clear line
    if (key.ctrl && key.name === "u") {
      setInput("");
      setSelectedIndex(0);
      return;
    }

    // Up/Down — navigate suggestions
    if (key.name === "up" && hasSuggestions) {
      setSelectedIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      return;
    }
    if (key.name === "down" && hasSuggestions) {
      setSelectedIndex((i) => (i >= suggestions.length - 1 ? 0 : i + 1));
      return;
    }

    // Tab — fill selected suggestion
    if (key.name === "tab" && hasSuggestions) {
      const selected = suggestions[selectedIndex];
      if (selected) {
        setInput(`/${selected.name} `);
        setSelectedIndex(0);
      }
      return;
    }

    // Escape — dismiss suggestions
    if (key.name === "escape") {
      setSelectedIndex(0);
      return;
    }

    // Enter — select suggestion or submit
    if (key.name === "return") {
      if (hasSuggestions) {
        const selected = suggestions[selectedIndex];
        if (selected) {
          setInput(`/${selected.name} `);
          setSelectedIndex(0);
          return;
        }
      }
      const trimmed = input.trim();
      if (trimmed.length > 0) {
        onSubmit(trimmed);
        setInput("");
        setSelectedIndex(0);
      }
      return;
    }
  });

  return (
    <box flexDirection="column">
      {/* Suggestion dropdown — renders above input */}
      {hasSuggestions && (
        <box
          flexDirection="column"
          borderStyle="rounded"
          borderColor={PALETTE.copperAccent}
          backgroundColor={PALETTE.surface}
          width="50%"
          marginBottom={0}
        >
          {suggestions.map((entry, i) => (
            <box
              key={entry.name}
              backgroundColor={i === selectedIndex ? PALETTE.amberDim : undefined}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={i === selectedIndex ? PALETTE.amberGlow : PALETTE.amberPrimary}>
                /{entry.name}
              </text>
              <text fg={PALETTE.textMuted}>  {entry.description}</text>
            </box>
          ))}
        </box>
      )}
      {/* Input field */}
      <box flexDirection="row" gap={1}>
        <text fg={PALETTE.amberGlow} bold>You &gt;</text>
        <input
          placeholder={placeholder}
          placeholderColor={PALETTE.textMuted}
          textColor={PALETTE.textPrimary}
          cursorColor={PALETTE.amberGlow}
          backgroundColor={PALETTE.background}
          onInput={setInput}
          value={input}
          focused={!disabled}
          width="100%"
        />
      </box>
    </box>
  );
}
```

> **Implementation note:** The exact `<input>` props may differ from what's shown. Use Context7 to check the `@opentui/react` `<input>` element API at implementation time — particularly how `value`, `onInput`, and `focused` work. The keyboard handling may also need adjustment depending on whether `<input>` consumes keystrokes before `useKeyboard` sees them.

**Step 2: Create input-bar.tsx**

```tsx
// src/cli/tui/components/input-bar.tsx
import { PALETTE } from "../theme.ts";
import { CommandTypeahead } from "./command-typeahead.tsx";
import type { TypeaheadEntry } from "../filter-commands.ts";

interface InputBarProps {
  commands: TypeaheadEntry[];
  disabled: boolean;
  placeholder: string;
  onSubmit: (input: string) => void;
  onExit: () => void;
}

export function InputBar(props: InputBarProps) {
  return (
    <box
      height={3}
      flexShrink={0}
      borderTop
      borderColor={PALETTE.copperAccent}
      backgroundColor={PALETTE.background}
      paddingLeft={1}
      paddingTop={0}
    >
      <CommandTypeahead {...props} />
    </box>
  );
}
```

**Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/tui/components/command-typeahead.tsx src/cli/tui/components/input-bar.tsx
git commit -m "feat(tui): add InputBar and CommandTypeahead with /command dropdown"
```

---

### Task 9: FridayApp root component — lifecycle, boot, shutdown, Forge restart

**Files:**
- Create: `src/cli/tui/app.tsx`

This is the largest component. It owns the FridayRuntime lifecycle and wires everything together.

**Step 1: Create app.tsx**

```tsx
// src/cli/tui/app.tsx
import { useReducer, useEffect, useCallback, useRef } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { toast, Toaster } from "@opentui-ui/toast/react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FridayRuntime } from "../../core/runtime.ts";
import type { ProviderName } from "../../core/types.ts";
import { DEFAULT_PROVIDER } from "../../providers/index.ts";
import { TuiChannel } from "./channels/tui-channel.ts";
import { appReducer, initialState, isExitWord, createMessage } from "./state.ts";
import { PALETTE } from "./theme.ts";
import { Header } from "./components/header.tsx";
import { ChatArea } from "./components/chat-area.tsx";
import { InputBar } from "./components/input-bar.tsx";
import type { TypeaheadEntry } from "./filter-commands.ts";

interface FridayAppProps {
  options: {
    provider: string;
    model?: string;
    fastModel?: string;
    fresh?: boolean;
  };
}

function FridayApp({ options }: FridayAppProps) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const runtimeRef = useRef<FridayRuntime | null>(null);
  const commandsRef = useRef<TypeaheadEntry[]>([]);
  const processingRef = useRef(false);

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

  const bootConfig = useCallback(() => ({
    provider: options.provider as ProviderName,
    model: options.model,
    fastModel: options.fastModel,
    smartsDir: resolve(projectRoot, "smarts"),
    dataDir: resolve(projectRoot, "data"),
    modulesDir: resolve(projectRoot, "src/modules"),
    forgeDir: resolve(projectRoot, "forge"),
    fresh: options.fresh,
  }), [options, projectRoot]);

  // Boot runtime on mount
  useEffect(() => {
    const runtime = new FridayRuntime();
    runtimeRef.current = runtime;

    (async () => {
      dispatch({ type: "add-message", message: createMessage("system", "Booting Friday...") });
      try {
        // Wire TuiChannel for notifications
        // The channel callback fires toast() in the React tree
        await runtime.boot(bootConfig());

        // Build command list for typeahead
        commandsRef.current = runtime.protocols.list().map((p) => ({
          name: p.name,
          description: p.description,
          aliases: p.aliases,
        }));

        const label = `${runtime.cortex.providerName}: ${runtime.cortex.modelName}`;
        dispatch({ type: "add-message", message: createMessage("system", `Friday online. (${label})`) });
        dispatch({ type: "set-phase", phase: "active" });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown boot error";
        dispatch({ type: "add-message", message: createMessage("system", `Boot failed: ${msg}`) });
        dispatch({ type: "add-message", message: createMessage("system", "Press any key to exit.") });
      }
    })();
  }, [bootConfig]);

  // Handle input submission
  const handleSubmit = useCallback(async (input: string) => {
    const runtime = runtimeRef.current;
    if (!runtime || state.phase !== "active" || processingRef.current) return;

    // Exit words trigger shutdown
    if (isExitWord(input)) {
      await handleShutdown();
      return;
    }

    dispatch({ type: "add-message", message: createMessage("user", input) });
    dispatch({ type: "set-thinking", value: true });
    processingRef.current = true;

    try {
      const result = await runtime.process(input);
      dispatch({ type: "set-thinking", value: false });
      dispatch({
        type: "add-message",
        message: createMessage(
          result.source === "protocol" ? "system" : "assistant",
          result.output,
        ),
      });

      // Forge restart check
      if (runtime.restartRequested) {
        dispatch({ type: "add-message", message: createMessage("system", "Forge restart requested. Rebooting subsystems...") });
        try {
          await runtime.shutdown((_, label) => {
            dispatch({ type: "add-message", message: createMessage("system", label) });
          });
          runtime.restartRequested = false;
          await runtime.boot({
            ...bootConfig(),
            fresh: false,
          });
          dispatch({ type: "add-message", message: createMessage("system", "Restart complete.") });

          // Report Forge health
          const health = runtime.forgeHealthReport;
          if (health) {
            if (health.loaded.length > 0) {
              dispatch({ type: "add-message", message: createMessage("system", `Forge modules loaded: ${health.loaded.join(", ")}`) });
            }
            for (const f of health.failed) {
              dispatch({ type: "add-message", message: createMessage("system", `Forge module failed: ${f.name} — ${f.error}`) });
            }
          }

          // Rebuild command list
          commandsRef.current = runtime.protocols.list().map((p) => ({
            name: p.name,
            description: p.description,
            aliases: p.aliases,
          }));
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          dispatch({ type: "add-message", message: createMessage("system", `Restart failed: ${msg}`) });
        }
      }
    } catch (error) {
      dispatch({ type: "set-thinking", value: false });
      const msg = error instanceof Error ? error.message : "Unknown error";
      dispatch({ type: "add-message", message: createMessage("system", `Error: ${msg}`) });
    } finally {
      processingRef.current = false;
    }
  }, [state.phase, bootConfig]);

  // Shutdown handler
  const handleShutdown = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || state.phase === "shutting-down") return;

    dispatch({ type: "set-phase", phase: "shutting-down" });
    try {
      await runtime.shutdown((_, label) => {
        dispatch({ type: "add-message", message: createMessage("system", label) });
      });
      dispatch({ type: "add-message", message: createMessage("system", "Shutdown complete.") });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      dispatch({ type: "add-message", message: createMessage("system", `Shutdown failed: ${msg}`) });
    }

    // Brief pause then exit
    setTimeout(() => {
      // renderer.destroy() is called by the launcher
      process.exit(0);
    }, 500);
  }, [state.phase]);

  // Wire toast notifications
  const handleToast = useCallback((level: string, text: string) => {
    if (level === "alert") {
      toast.error(text);
    } else {
      toast(text);
    }
  }, []);

  // Determine input state
  const inputDisabled = state.phase !== "active" || state.isThinking;
  const placeholder = state.phase === "booting"
    ? "Booting..."
    : state.phase === "shutting-down"
      ? "Shutting down..."
      : "Type a message or /command...";

  // Provider info for header
  const runtime = runtimeRef.current;
  const provider = runtime?.isBooted ? runtime.cortex.providerName : options.provider;
  const model = runtime?.isBooted ? runtime.cortex.modelName : (options.model ?? "...");

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={PALETTE.background}
    >
      <Toaster position="top-right" />
      <Header provider={provider} model={model} />
      <ChatArea messages={state.messages} isThinking={state.isThinking} />
      <InputBar
        commands={commandsRef.current}
        disabled={inputDisabled}
        placeholder={placeholder}
        onSubmit={handleSubmit}
        onExit={handleShutdown}
      />
    </box>
  );
}

// Entry point — called from chat.ts
export async function launchTui(options: {
  provider: string;
  model?: string;
  fastModel?: string;
  fresh?: boolean;
}): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("Interactive chat requires a TTY. Use 'friday serve' for the web UI.");
    process.exit(1);
  }

  try {
    const renderer = await createCliRenderer({ exitOnCtrlC: false });
    const root = createRoot(renderer);
    root.render(<FridayApp options={options} />);

    // Keep the process alive — OpenTUI handles the event loop
    // Cleanup happens via process.exit() in the shutdown handler
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Cannot start TUI: ${msg}`);
    console.error("Try 'friday serve' for the web UI instead.");
    process.exit(1);
  }
}
```

> **Implementation notes:**
> - The exact Toaster import path may be `@opentui-ui/toast/react` or `@opentui-ui/toast`. Check Context7 at implementation time.
> - The `exitOnCtrlC: false` option prevents OpenTUI from handling Ctrl+C — we handle it ourselves for graceful shutdown.
> - The `handleSubmit` callback uses `processingRef` (not state) to prevent double-submit, since `useCallback` would stale-capture a state boolean.
> - Toast integration: the `TuiChannel` is created in boot config but the wiring to `toast()` happens via the `handleToast` callback. The actual wiring of TuiChannel into the NotificationManager needs to happen during boot — this may require a small modification to RuntimeConfig or post-boot channel injection. Check if `NotificationManager.addChannel()` is accessible after boot.

**Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/tui/app.tsx
git commit -m "feat(tui): add FridayApp root with lifecycle, boot, shutdown, Forge restart"
```

---

### Task 10: Gut chat.ts — thin launcher

**Files:**
- Modify: `src/cli/commands/chat.ts`

**Step 1: Replace chat.ts contents**

Replace the entire file with the thin launcher:

```typescript
// src/cli/commands/chat.ts
import type { Command } from "commander";
import { DEFAULT_PROVIDER } from "../../providers/index.ts";

export function chatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session with Friday")
    .option(
      "-p, --provider <provider>",
      "LLM provider to use (anthropic, grok)",
      DEFAULT_PROVIDER,
    )
    .option("-m, --model <model>", "Model to use (defaults per provider)")
    .option("--fast-model <model>", "Fast model for utility tasks (summarization, knowledge extraction)")
    .option("--fresh", "Start a fresh session without loading previous conversation")
    .action(async (options) => {
      const { launchTui } = await import("../tui/app.tsx");
      await launchTui({
        provider: options.provider,
        model: options.model,
        fastModel: options.fastModel,
        fresh: options.fresh,
      });
    });
}
```

**Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "refactor: gut chat.ts to thin TUI launcher"
```

---

### Task 11: Update banner colors — cyan to amber

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/commands/serve.ts`

**Step 1: Update index.ts banner**

In `src/cli/index.ts`, change the banner from cyan to amber. Import `PALETTE` from the theme:

Replace:
```typescript
import chalk from "chalk";
import boxen from "boxen";
```

With chalk-based amber colors (boxen stays for now — serve still uses it):
```typescript
import chalk from "chalk";
import boxen from "boxen";
```

Replace the banner:
```typescript
console.log(
  boxen(
    chalk.hex("#F0A030").bold("F.R.I.D.A.Y.") + "\n" + chalk.hex("#8B6914")("Female Replacement Intelligent Digital Assistant Youth"),
    {
      padding: 1,
      borderColor: "#C07020",
      borderStyle: "round",
    },
  ),
);
```

> **Note:** boxen supports hex colors. We use the PALETTE values directly as hex strings rather than importing the module (boxen is a CLI tool, not a TUI component).

**Step 2: Update serve.ts colors**

In `src/cli/commands/serve.ts`, replace cyan with amber:

```typescript
console.log(
  boxen(
    `${chalk.hex("#F0A030").bold("F.R.I.D.A.Y. Web UI")}\n${chalk.hex("#8B6914")(`http://localhost:${server.port}`)}`,
    { padding: 1, borderColor: "#C07020", borderStyle: "round" },
  ),
);
```

And the shutdown message:
```typescript
console.log(chalk.hex("#8B6914")("\nShutting down server..."));
```

And the error:
```typescript
console.error(chalk.red("Invalid port number"));
```
(Error stays red — that's correct per the palette.)

**Step 3: Verify it still runs**

Run: `bun run start -- --help`
Expected: No crashes, banner displays

**Step 4: Commit**

```bash
git add src/cli/index.ts src/cli/commands/serve.ts
git commit -m "style: update CLI banner colors from cyan to Friday amber"
```

---

### Task 12: Remove old files and unused dependencies

**Files:**
- Delete: `src/cli/render.ts`
- Delete: `src/cli/typeahead-prompt.ts`
- Delete: `src/utils/strip-ansi.ts`
- Delete: `tests/unit/render.test.ts`
- Modify: `tests/unit/typeahead-prompt.test.ts` → rename to `tests/unit/filter-commands.test.ts`, remove `formatSuggestionLine` tests
- Modify: `package.json` — remove `ora`, `boxen`, `marked`, `marked-terminal`

**Step 1: Check strip-ansi.ts has no other consumers**

Run: `grep -r "strip-ansi" src/ tests/ --include="*.ts" --include="*.tsx"`

If only `typeahead-prompt.ts` and `typeahead-prompt.test.ts` reference it, safe to delete.

**Step 2: Delete old files**

```bash
rm src/cli/render.ts
rm src/cli/typeahead-prompt.ts
rm src/utils/strip-ansi.ts
rm tests/unit/render.test.ts
```

**Step 3: Rename and update typeahead test**

Rename `tests/unit/typeahead-prompt.test.ts` to `tests/unit/filter-commands.test.ts`.

Remove the `formatSuggestionLine` tests and `stripAnsi` import. Keep only the `filterCommands` tests. Update the import:

```typescript
import { describe, test, expect } from "bun:test";
import {
  filterCommands,
  type TypeaheadEntry,
} from "../../src/cli/tui/filter-commands.ts";

// Keep all existing filterCommands tests exactly as they are
```

**Step 4: Remove unused dependencies**

```bash
bun remove ora boxen marked marked-terminal
```

> **Wait:** `boxen` is still used by `index.ts` and `serve.ts`. Only remove it if those have been migrated off boxen. Since serve.ts still uses boxen (it's not getting the TUI treatment), keep `boxen` for now.

```bash
bun remove ora marked marked-terminal
```

> **Also check:** `inquirer` is installed but unused. Can remove as cleanup:
```bash
bun remove inquirer @types/inquirer
```

**Step 5: Run all tests**

Run: `bun test`
Expected: All tests pass. The removed test files no longer run. The renamed filter-commands test passes.

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove old CLI rendering, typeahead prompt, and unused dependencies"
```

---

### Task 13: Lint, typecheck, full test run

**Files:** None — verification only.

**Step 1: Run linter**

Run: `bun run lint`

If violations found: `bun run lint:fix`, review changes.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (both backend and web)

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 4: Manual smoke test**

Run: `bun run start chat`

Verify:
1. Full-screen TUI appears with amber header
2. "Booting Friday..." system message appears
3. "Friday online." message with provider info
4. Input becomes active
5. Type a message → thinking indicator → response renders
6. Type `/` → typeahead dropdown appears
7. Type `exit` → shutdown progress messages → clean exit to normal terminal

**Step 5: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes for TUI implementation"
```

---

## Key Files Summary

| File | Action |
|------|--------|
| `package.json` | Add opentui deps, remove ora/marked/marked-terminal |
| `tsconfig.json` | Add `jsxImportSource` |
| `bunfig.toml` | Create if @opentui/react needs preload |
| `src/cli/tui/theme.ts` | **NEW** — color palette, syntax style |
| `src/cli/tui/state.ts` | **NEW** — state types, reducer, exit words |
| `src/cli/tui/filter-commands.ts` | **NEW** — extracted filterCommands |
| `src/cli/tui/app.tsx` | **NEW** — root component, runtime lifecycle |
| `src/cli/tui/components/header.tsx` | **NEW** — title bar |
| `src/cli/tui/components/chat-area.tsx` | **NEW** — scrollable messages |
| `src/cli/tui/components/message.tsx` | **NEW** — message rendering |
| `src/cli/tui/components/thinking.tsx` | **NEW** — animated indicator |
| `src/cli/tui/components/input-bar.tsx` | **NEW** — input container |
| `src/cli/tui/components/command-typeahead.tsx` | **NEW** — input + dropdown |
| `src/cli/tui/channels/tui-channel.ts` | **NEW** — notification → toast |
| `src/cli/commands/chat.ts` | GUTTED → thin launcher |
| `src/cli/index.ts` | Colors: cyan → amber |
| `src/cli/commands/serve.ts` | Colors: cyan → amber |
| `src/cli/render.ts` | **DELETED** |
| `src/cli/typeahead-prompt.ts` | **DELETED** |
| `src/utils/strip-ansi.ts` | **DELETED** |
| `tests/unit/tui-theme.test.ts` | **NEW** — palette tests |
| `tests/unit/tui-state.test.ts` | **NEW** — state reducer tests |
| `tests/unit/tui-channel.test.ts` | **NEW** — channel tests |
| `tests/unit/filter-commands.test.ts` | RENAMED from typeahead-prompt.test.ts |
| `tests/unit/render.test.ts` | **DELETED** |

## Verification

1. `bun run typecheck` — no type errors (backend + web)
2. `bun test` — all tests pass, new TUI tests pass
3. `bun run lint` — no lint violations
4. Manual: `bun run start chat` — TUI renders, chat works, shutdown clean
5. Manual: `bun run start serve` — banner shows in amber, server works
6. Manual: `bun run start -- --help` — banner shows in amber
