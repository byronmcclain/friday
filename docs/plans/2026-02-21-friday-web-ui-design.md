# Friday Web UI Design

## Overview

A React-based web interface that mirrors all CLI features, communicating with Friday's backend over WebSocket. The web UI lives in a `web/` monorepo subfolder alongside the existing Bun/TypeScript backend.

**Key decisions:**
- **Monorepo subfolder** — `web/` inside the Friday repo, shares types with backend
- **WebSocket transport** — bidirectional, supports streaming, push events, and real-time Sensorium updates
- **Vite + React** — fast dev server, HMR, modern bundling, Bun-compatible
- **Tailwind CSS** — utility-first styling with custom Friday color palette
- **Thin WebSocket relay** — backend is a minimal wrapper around `FridayRuntime`
- **New `friday serve` command** — separate entry point from CLI chat
- **MCU HUD aesthetic** — dark background, warm amber/gold accents derived from the logo

## Project Structure

```
friday/
├── src/                          # Existing backend (unchanged)
├── web/                          # New React frontend
│   ├── src/
│   │   ├── main.tsx              # React entry point
│   │   ├── App.tsx               # Root layout + WebSocket provider
│   │   ├── components/           # UI components
│   │   │   ├── layout/           # Header, StatusBar, Sidebar, Layout
│   │   │   ├── chat/             # MessageList, UserMessage, AssistantMessage, SystemMessage
│   │   │   ├── input/            # CommandInput, TypeaheadDropdown, SendButton
│   │   │   ├── sensorium/        # CpuGauge, MemGauge, GitStatus, DockerCount, PortsList
│   │   │   ├── sidebar/          # HistoryPanel, SmartsPanel, NotificationPanel
│   │   │   └── shared/           # ThinkingIndicator, ToolActivity, ProviderBadge
│   │   ├── hooks/                # useWebSocket, useChat, useSensorium, useSmarts, useHistory, useTypeahead
│   │   ├── contexts/             # WebSocketContext, ChatContext, SessionContext, SensoriumContext
│   │   ├── types/                # Re-exports from shared protocol types
│   │   └── styles/               # Tailwind config extensions, global styles
│   ├── index.html                # Vite entry HTML
│   ├── vite.config.ts            # Vite config with WebSocket proxy for dev
│   ├── tailwind.config.ts        # Friday color palette
│   ├── tsconfig.json             # Extends root, path aliases to src/
│   └── package.json              # React + Vite deps
├── src/cli/commands/
│   └── serve.ts                  # NEW — `friday serve` command
├── src/server/                   # NEW — WebSocket API server
│   ├── index.ts                  # Bun.serve() setup, static file serving
│   ├── protocol.ts               # Shared WebSocket message types
│   └── handler.ts                # Message routing to FridayRuntime
└── package.json                  # Root — workspace config
```

## WebSocket Protocol

JSON messages with a `type` discriminator. Requests carry an `id`, responses carry a `requestId`. Push events have no `requestId`.

### Client → Server

```typescript
// Chat
{ type: "chat", id: string, content: string }

// Protocol commands
{ type: "protocol", id: string, command: string }      // e.g. "/env status"

// Session control
{ type: "session:boot", id: string, provider?: ProviderName, model?: string, fresh?: boolean }
{ type: "session:shutdown", id: string }

// History
{ type: "history:list", id: string, count?: number }
{ type: "history:load", id: string, sessionId: string }

// SMARTS
{ type: "smarts:list", id: string }
{ type: "smarts:search", id: string, query: string }
```

### Server → Client

```typescript
// Chat responses
{ type: "chat:response", requestId: string, content: string, source: "cortex" | "protocol" }
{ type: "chat:token", requestId: string, token: string }    // future streaming
{ type: "chat:done", requestId: string }                     // future streaming

// Protocol responses
{ type: "protocol:response", requestId: string, content: string, success: boolean }

// Session state
{ type: "session:booted", requestId: string, provider: string, model: string }
{ type: "session:closed", requestId: string }

// Push events (server-initiated, no requestId)
{ type: "sensorium:update", snapshot: SystemSnapshot }
{ type: "signal", name: SignalName, source: string, data?: Record<string, unknown> }
{ type: "notification", level: "info" | "warning" | "alert", title: string, body: string }
{ type: "tool:executing", name: string, args: Record<string, unknown> }
{ type: "tool:result", name: string, result: unknown }

// Errors
{ type: "error", requestId?: string, code: string, message: string }
```

## Backend: `friday serve` Command

### Entry Point

```
friday serve [--port 3000] [--provider grok] [--model grok-3]
```

- Boots `FridayRuntime` with the same config as `chat`
- Starts `Bun.serve()` with WebSocket upgrade
- Serves built SPA from `web/dist/` in production
- In dev, Vite dev server handles frontend and proxies WS

### WebSocket Handler

Thin relay around `FridayRuntime`:

```
Message received → parse JSON → switch on type:
  "chat"             → runtime.process(content)     → chat:response
  "protocol"         → runtime.process(command)      → protocol:response
  "session:boot"     → runtime.boot(config)          → session:booted
  "session:shutdown"  → runtime.shutdown()            → session:closed
  "history:*"        → delegate to runtime.memory     → response
  "smarts:*"         → delegate to runtime.smarts     → response
```

### Push Event Wiring

On boot, the server subscribes to existing subsystems:

- **Sensorium** — push `sensorium:update` on each poll cycle
- **SignalBus** — push `signal` for all signals
- **NotificationManager** — add `WebSocketChannel` that pushes `notification` events
- **Tool execution** — intercept tool calls to push `tool:executing` / `tool:result`

## Frontend Architecture

### Component Tree

```
App
├── WebSocketProvider
├── Layout
│   ├── Header
│   │   ├── FridayLogo (animated amber glow)
│   │   ├── ProviderBadge (dropdown to switch provider/model)
│   │   └── SessionControls (New / Load / Fresh)
│   ├── StatusBar (bottom, always visible)
│   │   ├── CpuGauge
│   │   ├── MemGauge
│   │   ├── GitStatus
│   │   ├── DockerCount
│   │   └── PortsList
│   ├── ChatPanel (main content)
│   │   ├── MessageList
│   │   │   ├── UserMessage
│   │   │   ├── AssistantMessage (markdown rendered)
│   │   │   └── SystemMessage (protocol responses, errors)
│   │   ├── ToolActivity (inline tool execution cards)
│   │   └── ThinkingIndicator (pulsing amber glow)
│   ├── InputArea (bottom-anchored, above StatusBar)
│   │   ├── CommandInput (text input with / typeahead)
│   │   ├── TypeaheadDropdown (protocol suggestions)
│   │   └── SendButton
│   └── Sidebar (collapsible)
│       ├── HistoryPanel
│       ├── SmartsPanel (list, search, domains)
│       └── NotificationPanel
```

### State Management

React Context + `useReducer` (no external state library):

- **WebSocketContext** — connection state, `send()`, `subscribe(type, handler)`
- **ChatContext** — message array, current request status, typing indicator
- **SessionContext** — boot state, provider info, runtime status
- **SensoriumContext** — latest snapshot, pushed from server

### Key Hooks

```typescript
useWebSocket()   // Connect, reconnect, send, subscribe by message type
useChat()        // Send chat/protocol, track response, message history
useSensorium()   // Live system metrics from push events
useSmarts()      // SMARTS list/search/domains operations
useHistory()     // Conversation history list/load/clear
useTypeahead()   // Protocol command typeahead (reuses filterCommands logic)
```

### Markdown Rendering

- `react-markdown` (or `marked` with HTML output) replaces `marked-terminal`
- Same `marked` parser engine as CLI
- Code blocks get syntax highlighting via `highlight.js`
- Dark code theme with amber accent highlights

## Visual Design

### Color Palette (derived from logo)

```css
/* Backgrounds */
--friday-bg-deep:     #0B0E14;    /* Deepest background */
--friday-bg:          #111620;    /* Main background */
--friday-bg-surface:  #1A1F2E;    /* Cards, panels */
--friday-bg-elevated: #232A3B;    /* Hover states, active items */

/* Primary accent — logo amber/gold glow */
--friday-amber:       #F5A623;    /* Primary accent */
--friday-amber-light: #FFCC66;    /* Highlights, active states */
--friday-amber-dim:   #8B6914;    /* Muted borders */
--friday-copper:      #E8852A;    /* Secondary accent — logo edge */

/* Text */
--friday-text:        #E8E0D4;    /* Primary text — warm white */
--friday-text-dim:    #7A7262;    /* Secondary text */
--friday-text-muted:  #4A4438;    /* Disabled text */

/* Status colors */
--friday-success:     #4ADE80;
--friday-warning:     #FBBF24;
--friday-error:       #F87171;

/* Effects */
--friday-glow:        0 0 20px rgba(245, 166, 35, 0.3);
```

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  [F logo]  F.R.I.D.A.Y.          grok: grok-3  [⚙]   │  Header
├─────────────────────────────────────────────────────────┤
│                                              │ History  │
│  You >                                       │ ──────── │
│  Tell me about the Docker containers         │ Today    │
│                                              │  • sess1 │
│  Friday >                                    │  • sess2 │
│  ┌─────────────────────────────────────┐     │ Yester.. │
│  │ Here are the running containers:    │     │  • sess3 │
│  │                                     │     │ ──────── │
│  │ ```                                 │     │ SMARTS   │
│  │ nginx  (cpu: 2%, mem: 128MB)        │     │ ──────── │
│  │ redis  (cpu: 0%, mem: 64MB)         │     │  bun-..  │
│  │ ```                                 │     │  friday..│
│  └─────────────────────────────────────┘     │  csharp..│
│                                              │          │
├──────────────────────────────────────────────┴──────────┤
│  [/] Type a message or command...              [Send ▶] │  Input
├─────────────────────────────────────────────────────────┤
│  CPU 42% ▮▮▮▮░░  MEM 68% ▮▮▮▮▮░  ⎇ main ● 3🐳 :3000  │  Status Bar
└─────────────────────────────────────────────────────────┘
```

### Visual Effects

- **Logo:** Subtle pulsing amber glow animation (`@keyframes`)
- **Thinking state:** Amber glow pulse on input area border
- **Message borders:** Thin amber-dim border on assistant message cards
- **Status bar gauges:** Color transitions: green (ok) → amber (high) → red (critical)
- **Typeahead:** Dark elevated panel, amber highlight on selected item
- **Sidebar:** Collapsible with smooth transition, dark glass-morphism
- **Code blocks:** Dark theme with amber keyword highlights

## Feature Parity Map

| CLI Feature | Web Equivalent |
|---|---|
| Interactive chat REPL | ChatPanel + MessageList |
| `ora` spinner | ThinkingIndicator (pulsing amber glow) |
| `chalk` colors | Tailwind amber palette |
| `marked-terminal` ANSI markdown | `react-markdown` HTML output |
| Typeahead `/command` input | TypeaheadDropdown component |
| `/env status` | StatusBar (always visible, live-updated) |
| `/env cpu`, `/env memory` | StatusBar gauges with thresholds |
| `/env docker`, `/env ports`, `/env git` | StatusBar compact badges |
| `/history list` | HistoryPanel in sidebar |
| `/history show <id>` | Click to load into ChatPanel |
| `/history clear` | Button with confirmation |
| `/smart list` | SmartsPanel in sidebar |
| `/smart show <name>` | Expand inline in SmartsPanel |
| `/smart search <query>` | Search input in SmartsPanel |
| `/smart domains` | Filter chips in SmartsPanel |
| `/smart reload` | Button in SmartsPanel header |
| `--provider` / `--model` | ProviderBadge dropdown |
| `--fresh` flag | "New Session" button |
| Notifications (terminal) | NotificationPanel + toast popups |
| Tool execution | ToolActivity inline cards |

### Web-Only Features

- Persistent Sensorium dashboard (no `/env` commands needed)
- Click-to-load past conversations
- Visual tool execution cards (collapsible, show args + result)
- Multi-panel layout (chat + sidebar simultaneously)
- Toast notifications without interrupting chat

## Error Handling

### WebSocket Lifecycle

- **Connect:** Client sends `session:boot` → server boots runtime → `session:booted`
- **Reconnect:** Auto-reconnect with exponential backoff (1s → 2s → 4s → max 30s). On reconnect, server re-sends current Sensorium snapshot
- **Graceful close:** `session:shutdown` → server saves conversation + flushes curator → `session:closed`
- **Unexpected close:** Server auto-saves conversation, stops Sensorium

### Error Categories

- **Provider errors** (bad key, rate limit) → `error` with `code: "PROVIDER_ERROR"`, shown as SystemMessage
- **Protocol errors** (unknown command) → `protocol:response` with `success: false`
- **Runtime not booted** → `error` with `code: "NOT_BOOTED"`, UI shows boot prompt
- **Connection lost** → Reconnect overlay with countdown, local message queue

## Testing Strategy

- **Backend WebSocket:** Bun test runner with mock WS clients
- **Frontend components:** Vitest + React Testing Library
- **Protocol types:** Compile-time — shared types catch wire mismatches
- **Integration:** Manual for v1, Playwright later

## Dependencies

### Backend (additions to existing)

None — uses `Bun.serve()` built-in WebSocket support.

### Frontend (`web/package.json`)

```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "react-markdown": "^9",
    "highlight.js": "^11"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "vite": "^6",
    "tailwindcss": "^4",
    "@tailwindcss/vite": "^4",
    "typescript": "^5",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@testing-library/react": "^16",
    "vitest": "^3"
  }
}
```

## Open Questions for Implementation

- Token streaming: Requires provider-level streaming support (not yet implemented). V1 sends full response; streaming added as a follow-up
- Multi-user: V1 is single-user (one runtime per server). Multi-user sessions would need session management
- Mobile: Layout should be responsive but optimized for desktop first
