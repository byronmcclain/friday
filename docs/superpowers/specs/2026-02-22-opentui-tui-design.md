# OpenTUI Terminal User Interface Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Friday's chalk/ora/boxen/typeahead-prompt CLI with a full-screen persistent TUI built on OpenTUI + React.

**Decisions:**
- Replace `friday chat` entirely (TUI is the default interactive experience)
- `@opentui/react` binding (JSX, hooks, shared React knowledge with web UI)
- No persistent status bar — Sensorium stays behind `/env`
- Toast notifications via `@opentui-ui/toast` for alerts
- `friday serve` stays as-is (only chat gets the TUI)

---

## 1. Component Architecture

The TUI is a React component tree rendered via `@opentui/react`:

```
<FridayApp>                          # Root — owns FridayRuntime, manages app state
  <ToasterProvider>                  # @opentui-ui/toast context
    <AppLayout>                      # Full-screen Flexbox column
      <Header />                     # Title bar — "F.R.I.D.A.Y." + provider/model info
      <ChatArea>                     # flexGrow: 1, scrollable
        <Message role="user" />      # User messages — plain styled text
        <Message role="assistant" /> # Friday messages — MarkdownRenderable
        <ThinkingIndicator />        # Animated dots when waiting for LLM
        ...
      </ChatArea>
      <InputBar>                     # Fixed at bottom, bordered
        <CommandTypeahead />         # Input with /command autocomplete dropdown
      </InputBar>
    </AppLayout>
  </ToasterProvider>
</FridayApp>
```

- **`FridayApp`** owns the runtime lifecycle — boots on mount, shuts down on unmount/exit
- **`ChatArea`** is a scrollable container that auto-scrolls to bottom on new messages, allows scrolling up through history
- **`Message`** renders differently by role — user messages are simple styled text, assistant messages use `MarkdownRenderable` for full markdown + syntax highlighting
- **`ThinkingIndicator`** replaces `ora` — animated component inside the chat flow
- **`CommandTypeahead`** replaces the 337-line `typeahead-prompt.ts` — `<input>` with dropdown overlay for `/command` suggestions
- **Toast** notifications render in a corner via `@opentui-ui/toast` provider

## 2. Layout & Flexbox Structure

Full-screen layout with three fixed regions:

```
┌─────────────────────────────────────────────────────────┐
│  Header (height: 1, flexShrink: 0)                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ChatArea (flexGrow: 1, overflow: scroll)               │
│                                                         │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  InputBar (height: 3, flexShrink: 0)                    │
└─────────────────────────────────────────────────────────┘
```

**Header** — single line, no border. Left-aligned title, right-aligned provider info. Cyan replaced by amber. `<box flexDirection="row" justifyContent="space-between">` with two `<text>` children. Bottom border separates from chat.

**ChatArea** — takes all remaining vertical space. Messages stack vertically with gaps. Auto-scrolls to bottom on new messages. User can scroll up with arrow keys or mouse wheel.

**InputBar** — fixed 3-line height. Bordered top edge. Contains input field and typeahead dropdown (overlays upward). Green "You >" prompt replaced by amber.

**Terminal resize** — OpenTUI handles Flexbox reflow automatically. `MarkdownRenderable` re-wraps content to new width.

**Alternate screen buffer** — TUI takes over the alternate screen. On exit, terminal returns to previous state cleanly.

## 3. Color Palette

Extracted from the Friday logo (warm amber/gold glow on deep navy):

| Role | Hex | Usage |
|------|-----|-------|
| **Background** | `#0D1117` | App background — deep navy/near-black |
| **Surface** | `#161B22` | Header, InputBar, borders — slightly lighter |
| **Amber Primary** | `#F0A030` | Title "F.R.I.D.A.Y.", Friday's name in messages, active borders |
| **Amber Glow** | `#FFD080` | Highlighted text, selected typeahead item, focused input cursor |
| **Amber Dim** | `#8B6914` | Dim/secondary text — provider info, timestamps, hints |
| **Copper Accent** | `#C07020` | Borders, separator lines, toast outlines |
| **Text Primary** | `#E6EDF3` | User messages, main content — high contrast off-white |
| **Text Muted** | `#7D8590` | Placeholders, instructions, inactive items |
| **Success** | `#3FB950` | Shutdown complete, positive status |
| **Error** | `#F85149` | Errors, failed operations |
| **Warning** | `#D29922` | Warning toasts |

**MarkdownRenderable syntax styles:**

```typescript
const fridaySyntax = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex("#F0A030"), bold: true },
  "markup.heading":   { fg: RGBA.fromHex("#FFD080"), bold: true },
  "markup.list":      { fg: RGBA.fromHex("#C07020") },
  "markup.raw":       { fg: RGBA.fromHex("#FFD080") },
  "markup.link":      { fg: RGBA.fromHex("#F0A030"), underline: true },
  default:            { fg: RGBA.fromHex("#E6EDF3") },
})
```

The `serve.ts` and `cli/index.ts` banners also swap from cyan to amber to match.

## 4. Input & Command Typeahead

The `CommandTypeahead` component replaces `typeahead-prompt.ts`. An OpenTUI `<input>` with a suggestion dropdown that overlays upward when the user types `/`.

**Behavior:**

1. Normal input — user types freely, Enter submits to `runtime.process()`
2. Slash triggers typeahead — typing `/` activates the dropdown, filtered by what follows
3. Navigation — Up/Down move through suggestions, Tab/Enter selects, Escape dismisses
4. Submit — Enter on completed command or plain text submits. Empty Enter ignored.
5. Exit words — `exit`, `quit`, `bye` trigger shutdown

**Dropdown rendering:**

```
│  ┌──────────────────────────────────┐                 │
│  │  /smart    Manage SMARTS entries │  ← amber bg on selected
│  │  /status   System status check   │
│  │  /env      Environment info      │
│  └──────────────────────────────────┘                 │
├───────────────────────────────────────────────────────┤
│  You > /s_                                            │
└───────────────────────────────────────────────────────┘
```

Position absolute, overlays bottom of ChatArea. Filters against `ProtocolRegistry.list()`.

**Keybindings:**

| Key | Action |
|-----|--------|
| Enter | Submit input / select suggestion |
| Tab | Accept selected suggestion |
| Up/Down | Navigate suggestions |
| Escape | Dismiss suggestions |
| Ctrl+C | Graceful shutdown |
| Ctrl+U | Clear input line |

Cursor movement and word deletion handled natively by OpenTUI `<input>`.

Single-line input only in v1. Multi-line available later by swapping to `<textarea>`.

## 5. Chat Messages & Markdown Rendering

**User messages** — simple styled text:

```tsx
<box flexDirection="row" gap={1}>
  <text fg="#FFD080" bold>You:</text>
  <text fg="#E6EDF3">{content}</text>
</box>
```

**Assistant messages** — `MarkdownRenderable` with Friday amber `SyntaxStyle`. Each message gets its own instance with width bound to ChatArea width.

**Protocol responses** — same markdown rendering, labeled "System:" in muted text.

**ThinkingIndicator** — animated dots component in the message flow:

```tsx
function ThinkingIndicator() {
  const [dots, setDots] = useState(".")
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(d => d.length >= 3 ? "." : d + ".")
    }, 400)
    return () => clearInterval(interval)
  }, [])
  return (
    <box flexDirection="row" gap={1}>
      <text fg="#F0A030" bold>Friday:</text>
      <text fg="#8B6914">thinking{dots}</text>
    </box>
  )
}
```

**Scroll behavior:**

- New messages auto-scroll to bottom
- User can scroll up (Up arrow / mouse wheel / Page Up)
- When scrolled up, subtle `↓ New message` indicator appears
- Pressing End or typing in input snaps back to bottom

## 6. Lifecycle & Runtime Integration

**Boot sequence:**

1. Commander parses args
2. `createCliRenderer()` takes over alternate screen buffer
3. `createRoot(renderer).render(<FridayApp config={...} />)`
4. FridayApp mounts → boots FridayRuntime in `useEffect`
5. Boot progress shown as system messages in ChatArea
6. Input becomes active on boot complete

During boot, InputBar is disabled with "Booting..." placeholder.

**Message processing flow:**

1. Add user Message to state
2. Show ThinkingIndicator
3. Disable input
4. `await runtime.process(input)`
5. Remove ThinkingIndicator
6. Add assistant/system Message to state
7. Re-enable input, refocus

**Shutdown triggers:**

| Trigger | How |
|---------|-----|
| `exit`/`quit`/`bye` | Detected before sending to runtime |
| Ctrl+C (SIGINT) | `useKeyboard` handler or process signal |
| SIGTERM | Process signal handler |

**Shutdown flow:**

1. Disable input
2. Show shutdown progress as system messages via `onProgress` callback
3. Brief pause (500ms) for user to read final message
4. `renderer.destroy()` exits alternate screen buffer
5. `console.log("See you later, boss!")` prints to normal terminal
6. `process.exit(0)`

**TuiChannel** — new `NotificationChannel` that bridges to `@opentui-ui/toast`:

```typescript
class TuiChannel implements NotificationChannel {
  name = "tui"
  async send(notification: FridayNotification): Promise<void> {
    const toastFn = {
      info: toast,
      warning: toast,
      alert: toast.error,
    }[notification.level]
    toastFn(`${notification.title}: ${notification.body}`)
  }
}
```

Replaces `TerminalChannel` in the chat command. Other channels (Log, Webhook, Slack) unaffected.

## 7. File Structure

**New directory: `src/cli/tui/`**

```
src/cli/
├── index.ts              # Modified — banner colors cyan → amber
├── render.ts             # REMOVED
├── typeahead-prompt.ts   # REMOVED
├── commands/
│   ├── chat.ts           # GUTTED — thin launcher for launchTui()
│   └── serve.ts          # Modified — colors cyan → amber
└── tui/
    ├── app.tsx           # Root component, runtime lifecycle, state
    ├── theme.ts          # Color palette, SyntaxStyle
    ├── components/
    │   ├── header.tsx
    │   ├── chat-area.tsx
    │   ├── message.tsx
    │   ├── thinking.tsx
    │   ├── input-bar.tsx
    │   └── command-typeahead.tsx
    └── channels/
        └── tui-channel.ts
```

**Removed:** `render.ts` (42 lines), `typeahead-prompt.ts` (337 lines)

**Gutted:** `chat.ts` (140 → ~20 lines)

**Untouched:** Everything in `src/core/`, `src/server/`, `src/providers/`, `src/modules/`, `src/smarts/`, `src/sensorium/`, `web/`, tests.

## 8. State Management

Pure React state — `useState` and `useReducer`, no external library.

```typescript
interface AppState {
  phase: "booting" | "active" | "shutting-down"
  messages: Message[]
  isThinking: boolean
}

interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
}
```

Three fields. `messages` is the display history (includes system messages, errors, boot progress) separate from Cortex's LLM conversation history. No global context needed — component tree is shallow enough for props.

## 9. Error Handling & Edge Cases

**Boot failures:** Render error as system message in ChatArea, "Press any key to exit", clean exit.

**LLM errors:** Render inline as error-colored system message, re-enable input for retry.

**Renderer init failure:** Falls back to plain `console.error` + exit (can't show TUI).

**TTY detection:** Check `process.stdin.isTTY` in `launchTui()` before `createCliRenderer()`.

**Terminal resize:** Handled automatically by OpenTUI Flexbox reflow.

**Ctrl+C during processing:** Set phase to `shutting-down`, show "Waiting for current request...", proceed with shutdown when `runtime.process()` resolves.

**Empty input:** Ignored silently.

**Long messages:** `MarkdownRenderable` handles word-wrap. Input scrolls horizontally.

## 10. Testing Strategy

Focus on boundaries between TUI and runtime, not visual rendering.

**Test files:**

| File | Coverage |
|------|----------|
| `tests/unit/tui-state.test.ts` | State reducer, phase transitions, exit word detection |
| `tests/unit/tui-channel.test.ts` | TuiChannel → toast mapping |
| `tests/unit/tui-theme.test.ts` | Palette constants, SyntaxStyle construction |

~15-20 new tests. No visual rendering tests — OpenTUI owns that. Runtime integration already covered by existing `runtime.test.ts`.

## 11. Migration

**Dependencies added:** `@opentui/core`, `@opentui/react`, `@opentui-ui/toast`

**Dependencies removed:** `ora`, `boxen`, `marked`, `marked-terminal`

**Dependencies kept:** `chalk` (serve.ts, pre-TUI errors), `commander` (arg parsing)

**Config:** Add `"jsx": "react-jsx"`, `"jsxImportSource": "@opentui/react"` to `tsconfig.json`. Add preload to `bunfig.toml` if required.

**Net effect:** Remove ~520 lines, add ~400-500 lines. Line-neutral, but declarative React components replace raw ANSI escape sequences.
