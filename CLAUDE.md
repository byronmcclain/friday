# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Friday** (F.R.I.D.A.Y. — Female Replacement Intelligent Digital Assistant Youth) is a personal AI assistant inspired by Tony Stark's assistant from the MCU. It features an interactive TUI (terminal UI) built with OpenTUI, a React-based web UI, and a modular agent runtime.

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **AI SDK**: Vercel AI SDK v6 (`ai`, `@ai-sdk/xai`) — Grok provider with native streaming
- **CLI Framework**: Commander.js
- **Linter/Formatter**: Biome (not ESLint/Prettier)

## Commands

```bash
bun link               # Register `friday` executable globally (reads bin from package.json)
bun run start          # Run Friday
bun run dev            # Run with --watch (auto-restart on changes)
bun test               # Run all tests
bun test --watch       # Run tests in watch mode
bun test tests/unit/friday.test.ts  # Run a single test file
bun run lint           # Lint check (no changes)
bun run lint:fix       # Lint and auto-fix
bun run format         # Format all source files
bun run typecheck      # TypeScript type checking (tsc --noEmit)
bun run serve          # Start Friday web UI server (default port 3000)
bun run web:dev        # Start Vite dev server for frontend (port 5173)
bun run web:build      # Build frontend for production
bun run start genesis init    # Seed GENESIS.md from built-in template
bun run start genesis show    # Print current identity prompt
bun run start genesis edit    # Open GENESIS.md in $EDITOR
bun run start genesis update  # Overwrite GENESIS.md with latest template
bun run start genesis check   # Validate file exists and permissions
bun run start genesis path    # Print resolved file path
friday serve &                 # Start server (must be running before chat)
friday chat                    # Connect to running server via TUI
friday --debug serve          # Serve with debug inference logging (writes last-inference-payload.log)
```

## Architecture

```
src/
├── main.ts                # Entrypoint — CLI bootstrap
├── cli/
│   ├── index.ts           # Commander program definition, command registration
│   ├── commands/          # One file per CLI command (chat.ts delegates to TUI)
│   └── tui/               # OpenTUI-based terminal interface (React for CLI)
│       ├── app.tsx         # FridayApp root — lifecycle, boot phases, runtime integration
│       ├── state.ts        # AppState reducer, Message types, phase state machine
│       ├── theme.ts        # Friday amber palette, SyntaxStyle, shared text attributes
│       ├── filter-commands.ts  # TypeaheadEntry and filterCommands() for /command suggestions
│       ├── log-store.ts   # LogStore — state store for TUI debug log panel
│       ├── log-types.ts   # LogEntry types for structured log display
│       ├── components/    # UI components (Header, ChatArea, InputBar, Message, Splash, LogPanel, CommandTypeahead, Thinking, Welcome)
│       └── lib/           # ANSI parser, color utils, chafa logo processor, usePulse hook, external editor launcher
├── core/
│   ├── cortex.ts          # Cortex — LLM brain, chatStream() + chatStreamVoice() dual-mode
│   ├── history-manager.ts # HistoryManager — token-budget conversation history with compaction
│   ├── stream-types.ts    # ChatStream, VoiceChatStream interfaces
│   ├── tool-bridge.ts     # Portable tool bridge — buildToolDefinitions, createToolExecutor, toGrokTools
│   ├── workers/           # CortexWorker implementations
│   │   ├── types.ts        # CortexWorker interface, WorkerRequest, WorkerResult, ToolEvent
│   │   ├── text-worker.ts  # TextWorker — AI SDK streamText() agent loop
│   │   ├── voice-worker.ts # VoiceWorker — Grok realtime WebSocket agent loop
│   │   └── push-iterable.ts # Push-based AsyncIterable utility
│   ├── summarizer.ts      # ConversationSummarizer — generates session summaries via generateText()
│   ├── runtime.ts         # FridayRuntime — boot/shutdown orchestrator, wires all subsystems
│   ├── events.ts          # SignalBus — typed event system (file:changed, test:failed, etc.)
│   ├── clearance.ts       # ClearanceManager — permission gates (read-fs, exec-shell, etc.)
│   ├── memory.ts          # SQLiteMemory — KV store, conversation history, FTS5 search, conversation indexing
│   ├── recall-tool.ts     # recall_memory tool — FTS5 search across past conversations (Deja Vu)
│   ├── genesis.ts         # Genesis — identity prompt loader (load/seed/check from ~/.friday/GENESIS.md)
│   ├── notifications.ts   # NotificationManager — multi-channel alerts (terminal, log, slack, webhook)
│   ├── types.ts           # Core types (FridayConfig, ConversationMessage)
│   ├── prompts.ts         # GENESIS_TEMPLATE — seed template for Friday's identity prompt
│   ├── secrets.ts         # SecretStore — AES-256-GCM encrypted storage (OS keychain + fallback)
│   ├── bridges/           # Runtime bridge abstractions for singleton mode
│   │   ├── socket.ts      # SocketBridge — Unix socket IPC to running server
│   │   └── types.ts       # RuntimeBridge interface — abstraction for socket access
│   └── voice/             # Vox — voice output subsystem (TTS via Grok REST API)
│       ├── types.ts        # VoiceMode (off/on/whisper/flat), EmotionMood, EmotionProfile, GrokVoice, VoxConfig
│       ├── audio.ts        # detectPlayer, playAudio, cleanupTempFile
│       ├── prompt.ts       # FRIDAY_VOICE_IDENTITY, buildVoiceSystemPrompt, VOICE_DELIVERY_RULES
│       ├── vox.ts          # Vox class — REST TTS lifecycle, modes, speak/cancel
│       ├── session-manager.ts # VoiceSessionManager — thin audio I/O + lifecycle (replaces VoiceBridge)
│       ├── narration.ts    # NarrationPicker, ACK_PHRASES, TOOL_NARRATIONS — Vox notification TTS phrases
│       ├── channel.ts      # VoiceChannel — notification bridge (NotificationChannel impl)
│       ├── emotion.ts      # emotionalRewrite() — conversation-aware emotional TTS rewriting
│       ├── ws.ts            # openGrokWebSocket() — authenticated Grok realtime WebSocket factory
│       └── protocol.ts     # /voice protocol (on, off, whisper, flat, test, status)
├── audit/
│   ├── types.ts           # AuditEntry, AuditFilter interfaces
│   └── logger.ts          # AuditLogger — action tracking with filtering
├── modules/
│   ├── types.ts           # FridayModule, FridayTool, FridayProtocol interfaces
│   ├── loader.ts          # Module discovery, validation, and loading
│   ├── validation.ts      # Shared argument validation (SSRF protection, flag injection guards)
│   ├── filesystem/        # Filesystem module — read, write, list, delete, exec tools
│   ├── git/               # Git module — status, diff, log, branch, stash, push, pull
│   ├── docker/            # Docker module — ps, logs, inspect, stats, exec
│   ├── code-exec/         # Code execution module — sandboxed script runner
│   ├── web-fetch/         # Web fetch module — HTTP requests with SSRF protection
│   ├── notify/            # Notification module — multi-channel dispatch
│   ├── forge/             # The Forge — self-improvement system
│   └── telegram/          # Telegram bot — mobile chat + notifications
├── protocols/
│   ├── types.ts           # Re-exports from modules/types.ts
│   └── registry.ts        # ProtocolRegistry — /command routing with aliases
├── directives/
│   ├── types.ts           # FridayDirective, DirectiveTrigger, DirectiveAction
│   ├── store.ts           # DirectiveStore — CRUD + signal-based lookup
│   └── engine.ts          # DirectiveEngine — autonomous rule execution
├── smarts/
│   ├── types.ts           # SmartEntry, SmartsConfig, SmartSource types
│   ├── parser.ts          # YAML frontmatter parser/serializer for .md files
│   ├── store.ts           # SmartsStore — FTS5-indexed knowledge base with CRUD
│   ├── protocol.ts        # /smart protocol (list, show, domains, search, reload)
│   └── curator.ts         # SmartsCurator — autonomous knowledge extraction from conversations
├── sensorium/
│   ├── types.ts           # SystemSnapshot, SensorConfig, AlertThresholds
│   ├── sensors.ts         # Pure functions: gatherMachine(), gatherContainers(), gatherDev()
│   ├── sensorium.ts       # Sensorium class — polling loop, snapshot management, alert evaluation
│   ├── format.ts          # Formatting utilities for snapshot display
│   ├── protocol.ts        # /env protocol (status, cpu, memory, docker, ports, git)
│   └── tool.ts            # getEnvironmentStatus FridayTool
├── arc-rhythm/
│   ├── types.ts           # Rhythm, RhythmAction, RhythmExecution, constants
│   ├── cron.ts            # Built-in cron parser: validate, nextOccurrence, describe
│   ├── store.ts           # RhythmStore — SQLite CRUD, execution tracking, scheduling state
│   ├── executor.ts        # RhythmExecutor — dispatches prompt/tool/protocol actions
│   ├── scheduler.ts       # RhythmScheduler — polling loop, reentrant guard, auto-pause
│   ├── protocol.ts        # /arc protocol (list, show, create, pause, resume, delete, history, run)
│   └── tool.ts            # manage_rhythm FridayTool for Cortex
├── history/
│   └── protocol.ts        # /history protocol (list, show, clear) — session persistence
├── server/
│   ├── index.ts           # Bun.serve() HTTP + WebSocket server
│   ├── protocol.ts        # Shared message types (ClientMessage, ServerMessage, voice messages)
│   ├── handler.ts         # WebSocketHandler — message routing to FridayRuntime
│   ├── session-hub.ts     # SessionHub — session lifecycle, hydration, cross-client sync
│   ├── client-registry.ts # ClientRegistry — multi-client WebSocket tracking
│   ├── socket.ts          # Unix socket server for singleton IPC (~/.friday/friday.sock)
│   ├── ttyd.ts            # Terminal-in-browser support (spawns ttyd on port 7681)
│   └── push-channel.ts    # PushNotificationChannel — bridges notifications to WebSocket/socket clients
├── providers/             # AI SDK model factory (createModel), Zod schema converter
│   ├── index.ts           # createModel(), GROK_DEFAULTS
│   ├── schemas.ts         # toZodSchema() — converts FridayTool parameters to Zod for AI SDK
│   └── debug-log.ts       # appendInferenceLog() — shared debug logging for providers
├── config/                # Runtime configuration loading — future
└── utils/
    └── timeout.ts         # Shared timeout utilities
web/                       # React web UI (Vite + Tailwind) — voice-focused architecture
├── src/
│   ├── App.tsx            # Root app component
│   ├── main.tsx           # Vite entry point
│   ├── components/
│   │   ├── voice/         # VoiceControls, VoiceOrb, VoiceMode, VoiceStatus + types, constants, barrel
│   │   ├── terminal/      # TerminalEmbed — embedded terminal via ttyd
│   │   └── menu/          # MenuBar — navigation and controls
│   ├── hooks/             # useVoiceAudio, useVoiceSession
│   └── index.css          # Tailwind CSS v4 theme (Friday amber palette, @theme block)
smarts/                    # Runtime-generated knowledge files (gitignored, user-specific)
forge/                     # Friday-authored modules (gitignored, AI-generated)
tests/
├── helpers/               # Shared test stubs (createMockModel, createErrorModel)
├── unit/                  # Unit tests (bun:test)
└── integration/           # Integration tests — future
```

### Subsystem Map

| Subsystem | Location | Key Constraint |
|---|---|---|
| **FridayRuntime** | `src/core/runtime.ts` | Composition root. Boot order is strict dependency chain (see below). |
| **Cortex** | `src/core/cortex.ts` | LLM brain. `chat()` blocks, `chatStream()` streams (TextWorker), `chatStreamVoice()` streams (VoiceWorker). Enriches system prompt per message with SMARTS + Sensorium. |
| **HistoryManager** | `src/core/history-manager.ts` | Token-budget conversation history. Auto-compacts, keeps min 4 messages. |
| **SignalBus** | `src/core/events.ts` | Typed events. Error-isolated handlers. `custom:${string}` for custom signals. |
| **Protocols** | `src/protocols/registry.ts` | `/command` routing. **Bypass LLM entirely** — direct handler dispatch. |
| **Directives** | `src/directives/` | Autonomous signal→action rules. Clearance-gated. Dynamic subscriptions via `store.onStoreChange()`. |
| **Modules** | `src/modules/` | Auto-loaded tool/protocol bundles. Shared validation in `validation.ts`. 8 modules: filesystem, git, docker, code-exec, web-fetch, notify, forge, telegram. |
| **SMARTS** | `src/smarts/` | FTS5-indexed knowledge. Pinned + FTS5-matched injected per message. Staleness pruning on boot via `sessionId`. |
| **Sensorium** | `src/sensorium/` | Dual-cadence polling (30s/5min). Hysteresis alerts. CPU needs delta between two tick samples. |
| **Genesis** | `src/core/genesis.ts` | Identity prompt at `~/.friday/GENESIS.md`. Protected path (`chmod 600`). Seed template: `GENESIS_TEMPLATE` in `prompts.ts`. |
| **Vox** | `src/core/voice/vox.ts` | Fire-and-forget TTS via REST API (`POST /v1/tts`). 4 modes: off/on/whisper/flat. Emotional rewrite via fast model with native speech tags. |
| **VoiceWorker** | `src/core/workers/voice-worker.ts` | Grok realtime WebSocket agent loop. Implements CortexWorker — reasoning + tool calling + speech natively. |
| **VoiceSessionManager** | `src/core/voice/session-manager.ts` | Thin audio I/O + lifecycle. Manages Grok WebSocket, VAD, routes transcripts through `cortex.chatStreamVoice()`. |
| **Recall (Deja Vu)** | `src/core/recall-tool.ts` | `search` (FTS5 summaries) → `recall` (full transcript). Registered in Cortex at boot. |
| **Arc Rhythm** | `src/arc-rhythm/` | 60s scheduler tick. Auto-pause after 5 failures. Shares Memory's SQLite via `memory.database`. |
| **The Forge** | `src/modules/forge/` | Self-improvement. Failed modules don't crash boot. Filesystem module + Forge are core-protected. Validate sanitizes LLM HTML entities before typecheck. |
| **Bridges** | `src/core/bridges/` | Singleton mode IPC. `SocketBridge` (Unix socket to server). `friday chat` requires a running `friday serve`. |
| **SessionHub** | `src/server/session-hub.ts` | Session lifecycle for singleton. Hydrates clients on connect, saves on last disconnect, reconnect guard. Unified ClientRegistry across transports. |
| **Server** | `src/server/` | HTTP + WebSocket + Unix socket. SessionHub coordinates session lifecycle. ttyd for terminal-in-browser. |

**Boot order:** SignalBus → ClearanceManager → AuditLogger → NotificationManager → ProtocolRegistry → DirectiveStore/Engine → Memory → SmartsStore → Sensorium → Genesis → Vox → Cortex → Recall Tool → Arc Rhythm → Modules → `session:start`

### Patterns & Gotchas

- **Dual-model architecture**: reasoning model (Cortex) + fast model (SmartsCurator, Summarizer). Resolution: CLI flag > env var > `GROK_DEFAULTS`. `FridayConfig.fastModel` carries through config chain.
- **Tool registration**: `registerTool()` → `toZodSchema()` converts FridayTool params to AI SDK tools
- **Module pattern**: `satisfies FridayModule` preferred over `: FridayModule` for literal type preservation. Mutable arrays for triggers/clearance (no `as const`). `onLoad(context: ModuleContext)` receives `ScopedMemory` for persistent storage (namespaced by module name), plus optional `cortex` (for bidirectional chat), `audit` (for logging), and `notifications` (for registering channels).
- **`AuditEntry`** requires `action`, `source`, `detail`, `success` — NOT `target` or `message`
- **Types split by domain**: core config in `src/core/types.ts`, tool/module contracts in `src/modules/types.ts`, directive structures in `src/directives/types.ts`
- **Commands** registered via Commander.js in `src/cli/index.ts`, one file per command under `src/cli/commands/`
- **Debug logging**: `--debug` writes `last-inference-payload.log` + `last-inference-response.log` — cleared per `Cortex.chat()`, round-appended. Config chain: CLI → `RuntimeConfig.debug` → `CortexConfig.debug`.
- **Singleton mode**: `friday serve` writes PID + socket files; `friday chat` requires a running server and connects via `SocketBridge` (no local runtime fallback — exits with error if no server is running)
- **SessionHub**: Owns client lifecycle in server mode. Both WebSocket and Unix socket transports register/unregister via hub. History hydrated on connect via `conversation:message` with `source: "replay"`. Saves conversation + clears history on last client disconnect. Reconnect guard prevents clearing if a new client connects during save.
- **Protected paths**: `isProtectedPath()` in `src/modules/filesystem/containment.ts` — blocks writes to Genesis and core modules
- **Dual-mode Cortex**: `chatStream()` (TextWorker/AI SDK) for CLI, `chatStreamVoice()` (VoiceWorker/Grok realtime) for browser voice. Both share system prompt enrichment, tool bridge, history, clearance. Voice mode uses Grok as native agent — no sentence splitting, no TTS pipe.
- **Voice narration**: NarrationPicker + ACK_PHRASES still available for Vox (notification TTS). VoiceSessionManager routes through Cortex natively — Grok handles its own speech.
- **ToolResult.error** is an optional field — tool-bridge falls back to `result.output || result.error || "Tool returned no output"`
- **Forge template** imports `FridayModule, FridayTool, ToolContext, ToolResult` and includes commented usage examples with proper validation patterns
- **Cortex inference audit**: `inference:start`, `inference:complete` (with duration), `inference:error` (with duration + error message) emitted per `chatStream()` call
- **Input bar**: Multi-line `<textarea>` with dynamic height (1–10 rows). Enter submits, Shift+Enter inserts newline, Tab inserts tab (or accepts suggestion when dropdown showing), Ctrl+E opens vim (TUI suspends, resumes on editor exit). Up/Down navigates history when cursor is on first/last line, moves cursor otherwise.
- **Prompt cache routing**: `createModel(modelId, sessionId?)` — when `sessionId` is provided, creates a session-scoped xAI provider with `x-grok-conv-id` header for cache routing. Runtime generates UUID at boot, reuses `_sessionId` when `dataDir` is configured. Fast/subsystem model intentionally omits session ID (one-shot calls don't benefit).

## Testing

- 1143 tests across 108 files (as of 2026-03-27)
- Tests use `injectedModel: createMockModel()` (AI SDK `MockLanguageModelV3` from `ai/test` with call capture via `.doStreamCalls`/`.doGenerateCalls`)
- Use `createErrorModel()` for models that throw on `doGenerate`/`doStream`
- Shared test stubs live in `tests/helpers/stubs.ts`
- SQLite tests must clean up WAL files: unlink `db`, `db-wal`, and `db-shm` in afterEach
- `bun:sqlite` transactions: `db.transaction(() => { ... })()` — must invoke the returned function
- `node:fs/promises` `appendFile` is an accepted exception where Bun has no native append API
- TUI tests (`tui-*.test.ts`) cover ANSI parser, color utils, logo processor, state reducer, and theme
- `AuditEntry` interface requires `action`, `source`, `detail`, `success` fields — not `target` or `message`
- Arc Rhythm tests use in-memory SQLite via `new Database(":memory:")` — no WAL cleanup needed

## Bun-Specific Rules

Default to Bun APIs instead of Node.js equivalents or third-party packages:

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` (with `bun:test`) instead of jest or vitest
- `bun install` instead of npm/yarn/pnpm install
- `Bun.serve()` for HTTP/WebSocket servers (not express)
- `Bun.file()` over `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` instead of execa for shell commands
- `bun:sqlite` for SQLite (not better-sqlite3)
- Bun auto-loads `.env` files — do not use dotenv

## TUI (OpenTUI)

- Terminal UI uses `@opentui/react` — React components rendered to the terminal
- JSX is configured with `jsxImportSource: "@opentui/react"` in tsconfig.json (not React DOM)
- TUI components live in `src/cli/tui/` — `.tsx` files use OpenTUI primitives (`<box>`, `<text>`)
- The `web/` directory is excluded from tsconfig to avoid JSX runtime conflicts with the browser React app
- `chat` command is a thin launcher: it calls `launchTui()` from `src/cli/tui/app.tsx`

## Environment

Requires `XAI_API_KEY` in `.env` for the Grok provider. Bun loads `.env` automatically.
Optional: `FRIDAY_REASONING_MODEL` and `FRIDAY_FAST_MODEL` to override default models (resolution: CLI flag > env var > `GROK_DEFAULTS`).
Optional: `FRIDAY_SECRET_KEY` — fallback master key for SecretStore when OS keychain is unavailable.
Optional: `FRIDAY_GENESIS_PATH` to override default `~/.friday/GENESIS.md` location.
Optional: `FRIDAY_VOICE` to override default voice (Eve). Available: Ara, Eve, Rex, Sal, Leo.
Optional: `TELEGRAM_BOT_TOKEN` for Telegram bot module (from @BotFather).
Optional: `TELEGRAM_OWNER_ID` to restrict Telegram bot to a single user.
Optional: `TELEGRAM_WEBHOOK_URL` for Telegram webhook mode (requires public URL, e.g., Cloudflare tunnel).
Optional: `FRIDAY_SLACK_WEBHOOK_URL` for Slack notification channel.
Optional: `FRIDAY_WEBHOOK_URL` for generic webhook notification channel.
Optional: `FRIDAY_EMAIL_WEBHOOK_URL` for email webhook notification channel.

## Docker

```bash
docker build -t friday .
docker run -e XAI_API_KEY=xai-... friday chat
```

## Design Documents

All design docs live in `docs/plans/` with naming convention `YYYY-MM-DD-<topic>-design.md` (42 documents as of 2026-03-27). Key ones: `friday-agent-runtime-design`, `cortex-ai-sdk-migration-design`, `vox-voice-output-design`, `voice-web-integration-design`.

**MCU concept mapping:** Cortex=brain, Protocol=slash command, Directive=standing order, Module=suit upgrade, Signal=event, Clearance=permission, SMARTS=dynamic knowledge, Sensorium=sensor suite, Deja Vu=recall, Arc Rhythm=heartbeat/scheduler, Genesis=identity template, Vox=voice

## Worktrees

Feature work uses git worktrees in `.worktrees/` (gitignored). Create with:
`git worktree add .worktrees/<name> -b feature/<name>`

## Documentation Lookup

Always use Context7 MCP (`resolve-library-id` then `query-docs`) to fetch up-to-date documentation for any library before writing code that depends on it. Do not rely on training data for API details.

## Conventions

- Friday's personality is defined in `~/.friday/GENESIS.md` (loaded at boot) — seed template lives in `src/core/prompts.ts` as `GENESIS_TEMPLATE`
- The user is a 30+ year programming veteran — Friday should match that expertise level in generated code
- Interactive chat uses the OpenTUI-based TUI (`src/cli/tui/`) — not a legacy marked-terminal renderer
- CLI banner and non-TUI output uses chalk (colors) with Friday amber palette
- Biome handles both linting and formatting — run `bun run lint:fix` before committing
