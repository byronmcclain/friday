# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Friday** (F.R.I.D.A.Y. — Female Replacement Intelligent Digital Assistant Youth) is a personal AI assistant inspired by Tony Stark's assistant from the MCU. It features an interactive TUI (terminal UI) built with OpenTUI, a React-based web UI, and a modular agent runtime.

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **AI SDK**: Vercel AI SDK v6 (`ai`, `@ai-sdk/xai`, `@ai-sdk/anthropic`) — unified multi-provider with native streaming
- **CLI Framework**: Commander.js
- **Linter/Formatter**: Biome (not ESLint/Prettier)

## Commands

```bash
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
friday --debug chat           # Chat with debug inference logging (writes last-inference-payload.log)
friday --debug serve          # Serve with debug inference logging
friday --debug                # Default (chat) with debug inference logging
```

## Architecture

```
src/
├── main.ts                # Entrypoint — CLI bootstrap
├── cli/
│   ├── index.ts           # Commander program definition, command registration
│   ├── render.ts          # renderMarkdown() — marked + marked-terminal ANSI output (legacy, used by web)
│   ├── commands/          # One file per CLI command (chat.ts delegates to TUI)
│   └── tui/               # OpenTUI-based terminal interface (React for CLI)
│       ├── app.tsx         # FridayApp root — lifecycle, boot phases, runtime integration
│       ├── state.ts        # AppState reducer, Message types, phase state machine
│       ├── theme.ts        # Friday amber palette, SyntaxStyle, shared text attributes
│       ├── filter-commands.ts  # TypeaheadEntry and filterCommands() for /command suggestions
│       ├── log-store.ts   # LogStore — state store for TUI debug log panel
│       ├── log-types.ts   # LogEntry types for structured log display
│       ├── components/    # UI components (Header, ChatArea, InputBar, Message, Splash, LogPanel, etc.)
│       ├── lib/           # ANSI parser, color utils, chafa logo processor
│       └── channels/      # TuiChannel — notification bridge into TUI toasts
├── core/
│   ├── cortex.ts          # Cortex — LLM brain, streamText() with AI SDK, tool registration
│   ├── history-manager.ts # HistoryManager — token-budget conversation history with compaction
│   ├── stream-types.ts    # ChatStream interface — textStream, fullText, usage
│   ├── summarizer.ts      # ConversationSummarizer — generates session summaries via generateText()
│   ├── runtime.ts         # FridayRuntime — boot/shutdown orchestrator, wires all subsystems
│   ├── events.ts          # SignalBus — typed event system (file:changed, test:failed, etc.)
│   ├── clearance.ts       # ClearanceManager — permission gates (read-fs, exec-shell, etc.)
│   ├── memory.ts          # SQLiteMemory — KV store, conversation history, FTS5 search, conversation indexing
│   ├── recall-tool.ts     # recall_memory tool — FTS5 search across past conversations (Deja Vu)
│   ├── genesis.ts         # Genesis — identity prompt loader (load/seed/check from ~/.friday/GENESIS.md)
│   ├── notifications.ts   # NotificationManager — multi-channel alerts (terminal, log, slack, webhook)
│   ├── types.ts           # Core types (FridayConfig, ConversationMessage, ProviderName)
│   ├── prompts.ts         # GENESIS_TEMPLATE — seed template for Friday's identity prompt
│   ├── secrets.ts         # SecretStore — AES-256-GCM encrypted storage (OS keychain + fallback)
│   ├── bridges/           # Runtime bridge abstractions for singleton mode
│   │   ├── local.ts       # LocalBridge — direct in-process runtime access
│   │   ├── socket.ts      # SocketBridge — Unix socket IPC to running server
│   │   └── types.ts       # RuntimeBridge interface — abstraction over local/socket access
│   └── voice/             # Vox — voice output subsystem (TTS via Grok Voice Agent API)
│       ├── types.ts        # VoiceMode, GrokVoice, VoxConfig, VoxOptions, VOX_DEFAULTS
│       ├── audio.ts        # pcmToWav, detectPlayer, playAudio, cleanupTempFile
│       ├── prompt.ts       # classifyContent, buildTtsPrompt, FRIDAY_VOICE_IDENTITY
│       ├── vox.ts          # Vox class — WebSocket lifecycle, modes, speak/cancel, idle eviction
│       ├── bridge.ts       # VoiceBridge — Grok realtime API WebSocket for conversational voice
│       ├── channel.ts      # VoiceChannel — notification bridge (NotificationChannel impl)
│       └── protocol.ts     # /voice protocol (on, off, whisper, test, status)
├── audit/
│   ├── types.ts           # AuditEntry, AuditFilter interfaces
│   └── logger.ts          # AuditLogger — action tracking with filtering
├── modules/
│   ├── types.ts           # FridayModule, FridayTool, FridayProtocol interfaces
│   ├── loader.ts          # Module discovery, validation, and loading
│   ├── validation.ts      # Shared input validation (path traversal, SSRF, flag injection)
│   ├── filesystem/        # Filesystem module — read, write, list, delete, exec tools
│   ├── git/               # Git module — status, diff, log, branch, stash, push, pull
│   ├── docker/            # Docker module — ps, logs, inspect, stats, exec
│   ├── code-exec/         # Code execution module — sandboxed script runner
│   ├── web-fetch/         # Web fetch module — HTTP requests with SSRF protection
│   ├── notify/            # Notification module — multi-channel dispatch
│   ├── forge/             # The Forge — self-improvement system
│   └── gmail/             # Gmail module — read, search, send, reply, label, archive
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
│   ├── client-registry.ts # ClientRegistry — multi-client WebSocket tracking
│   ├── socket.ts          # Unix socket server for singleton IPC (~/.friday/friday.sock)
│   ├── ttyd.ts            # Terminal-in-browser support (spawns ttyd on port 7681)
│   └── ws-channel.ts      # WebSocket notification channel
├── providers/             # AI SDK model factory (createModel), Zod schema converter
│   ├── index.ts           # createModel(), PROVIDER_DEFAULTS, DEFAULT_PROVIDER
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
│   │   ├── voice/         # VoiceControls, VoiceOrb, VoiceMode, VoiceStatus
│   │   ├── terminal/      # TerminalEmbed — embedded terminal via ttyd
│   │   └── menu/          # MenuBar — navigation and controls
│   ├── hooks/             # useVoiceAudio, useVoiceSession
│   └── index.css          # Tailwind theme (Friday amber palette)
smarts/                    # Runtime-generated knowledge files (gitignored, user-specific)
forge/                     # Friday-authored modules (gitignored, AI-generated)
tests/
├── helpers/               # Shared test stubs (createMockModel, createErrorModel)
├── unit/                  # Unit tests (bun:test)
└── integration/           # Integration tests — future
```

### Key Design Patterns

- **FridayRuntime** (`src/core/runtime.ts`) is the composition root. It boots all subsystems in order: SignalBus, ClearanceManager, AuditLogger, NotificationManager, ProtocolRegistry, DirectiveStore/Engine, Memory, SmartsStore, Sensorium, Genesis, Vox, Cortex, Recall Tool, Arc Rhythm, then discovers and loads Modules.
- **Cortex** (`src/core/cortex.ts`) is Friday's LLM brain. Uses AI SDK `streamText()` with `stopWhen: stepCountIs(N)` for automatic tool loop execution. Exposes `chat()` (blocking, with error rollback) and `chatStream()` (streaming `ChatStream` with `textStream`, `fullText`, `usage`). `HistoryManager` handles token-budget conversation history with compaction. Tools registered via `registerTool()` are converted to AI SDK tools via `toZodSchema()`. When a SmartsStore is provided, Cortex enriches the system prompt with pinned and FTS5-matched knowledge per message.
- **SMARTS** (`src/smarts/`) is Friday's dynamic knowledge system. Markdown files with YAML frontmatter in `smarts/` are indexed into FTS5, queried per-message to enrich prompts, and new knowledge is extracted from conversations on shutdown via SmartsCurator. The `/smart` protocol provides manual control (list, show, search, reload).
- **SignalBus** (`src/core/events.ts`) is the reactive nervous system. Typed signals (file:changed, test:failed, etc.) flow through here, triggering directives and module behavior.
- **Protocols** bypass LLM reasoning entirely — `/command` input is routed directly to a protocol handler via the ProtocolRegistry, while everything else flows through Cortex.
- **Directives** are autonomous rules: signal triggers fire actions (tools, protocols, prompts) after clearance checks. The DirectiveEngine wires the SignalBus to the DirectiveStore.
- **Modules** bundle tools, protocols, knowledge, triggers, and clearance into discoverable units. They're auto-loaded from directories and validated against the manifest contract.
- **Commands** are registered via Commander.js in `src/cli/index.ts`. Each command lives in its own file under `src/cli/commands/`.
- **Types** are split by domain: core config in `src/core/types.ts`, tool/module contracts in `src/modules/types.ts`, directive structures in `src/directives/types.ts`.
- **Sensorium** (`src/sensorium/`) is Friday's environmental awareness. Pure sensor functions gather machine stats (`node:os`), Docker containers (`Bun.$`), and dev environment (git, ports, runtimes). The Sensorium class runs a dual-cadence polling loop (30s fast / 5min slow), evaluates alert thresholds with hysteresis, and injects a compact context block into the system prompt via `getContextBlock()`. The `/env` protocol provides CLI access; `getEnvironmentStatus` tool provides LLM access.
- **Dual-Model Architecture** — FridayRuntime resolves two models per provider: a reasoning model (for Cortex conversations) and a fast model (for SmartsCurator knowledge extraction and ConversationSummarizer). Resolution priority: CLI flag > env var > `PROVIDER_DEFAULTS`. `FridayConfig.fastModel` carries the fast model through the config chain.
- **The Forge** (`src/modules/forge/`) is Friday's self-improvement system. She can author new modules in `forge/` and patch existing forge modules, subject to human approval. The Forge validates modules (import, manifest, typecheck, lint) before triggering an in-process restart. Failed forge modules don't crash boot — errors are reported back so Friday can iterate. The filesystem module and Forge itself are core-protected.
- **TUI** (`src/cli/tui/`) is Friday's interactive terminal interface, built with OpenTUI (React for CLI). The `chat` command delegates to `launchTui()` which renders a React component tree: Header (shimmer animation), ChatArea (messages + thinking indicator), InputBar (command typeahead). State is managed via a reducer with phases: `splash → fading → booting → active → shutting-down`. TuiChannel bridges NotificationManager into TUI toasts. The splash screen uses chafa to convert the logo image to ANSI art with a fade animation. Mouse-enabled text selection with auto-copy to clipboard.
- **History** (`src/history/protocol.ts`) provides the `/history` protocol (aliases: `/hist`) for browsing, viewing, and clearing past conversation sessions stored in SQLite.
- **Recall (Deja Vu)** (`src/core/recall-tool.ts`) is Friday's conversational memory search. The `recall_memory` tool provides two modes: `search` (FTS5 keyword search across conversation summaries, returns session IDs + dates + snippets) and `recall` (retrieves full message transcript for a session). Conversations are auto-indexed on save via `memory.indexConversation()` with pruning of deleted sessions. Wired into Cortex as a registered tool at boot.
- **Arc Rhythm** (`src/arc-rhythm/`) is Friday's autonomous scheduling subsystem — her heartbeat. RhythmStore persists rhythms and execution history to SQLite (shared database with Memory). RhythmScheduler ticks every 60s, finds due rhythms, and dispatches them through RhythmExecutor which routes prompt/tool/protocol actions through Cortex, the tool registry, or the ProtocolRegistry respectively. Auto-pause disables rhythms after 5 consecutive failures. Emits signals (`custom:arc-rhythm-executed`, `custom:arc-rhythm-failed`, `custom:arc-rhythm-paused`). The `/arc` protocol provides human CLI access; `manage_rhythm` tool provides LLM access. Built-in zero-dependency cron parser supports 5-field expressions, ranges, lists, steps, named days/months, and shorthands (@hourly, @daily, @weekly, @monthly).
- **Operational Modules** — Beyond the filesystem module, Friday has 6 additional modules: **git** (status, diff, log, branch, stash, push, pull), **docker** (ps, logs, inspect, stats, exec), **code-exec** (sandboxed script execution), **web-fetch** (HTTP with SSRF protection), **notify** (multi-channel dispatch), and **gmail** (search, read, send, reply, modify, labels via Gmail API with OAuth 2.0). All use shared validation from `src/modules/validation.ts` for path traversal, SSRF, and flag injection protection.
- **Gmail** (`src/modules/gmail/`) provides Friday's email identity via the Gmail API. `GmailAuth` handles OAuth 2.0 with encrypted token storage via `SecretStore` (AES-256-GCM, OS keychain). `GmailClient` wraps the googleapis SDK. Six tools for Cortex (`gmail.search`, `gmail.read`, `gmail.send`, `gmail.reply`, `gmail.modify`, `gmail.list_labels`), one `/gmail` protocol for humans (aliases: `/mail`, `/email`). Send/reply tools require `"email-send"` clearance. The `SecretStore` (`src/core/secrets.ts`) is a reusable core component.
- **SMARTS Staleness Prevention** — SMARTS entries carry a `sessionId` field. On boot, `SmartsStore.pruneStale()` removes entries whose session hasn't been seen within a TTL window. The SmartsCurator filters volatile extractions (greetings, meta-commentary) and stamps `sessionId` on create/update for TTL renewal.
- **Genesis** (`src/core/genesis.ts`) is Friday's identity prompt, loaded from `~/.friday/GENESIS.md` at boot. The file is protected: `chmod 600`, filesystem tools and Forge reject writes to it, and it lives outside the repo. The BOSS edits it via `friday genesis edit`. `GENESIS_TEMPLATE` in `src/core/prompts.ts` is the seed template used by `friday genesis init`. Override path with `FRIDAY_GENESIS_PATH` env var.
- **Prompts** live in `src/core/prompts.ts` as exported constants. `GENESIS_TEMPLATE` is the seed template for Friday's identity — it gets written to `~/.friday/GENESIS.md` on first run. The system prompt includes current date/time injection and recall_memory tool usage guidance.
- **Vox** (`src/core/voice/`) is Friday's voice output — her mouth. Uses the xAI Grok Voice Agent API via persistent WebSocket to speak responses aloud. Three modes: Off (default), On, Whisper. Dynamic TTS prompt system classifies content (tables, code, lists) and adjusts instructions per utterance. Persistent WebSocket with 60s idle eviction. Fire-and-forget speech after Cortex chat responses. VoiceChannel bridges notifications into speech. `/voice` protocol for human control (aliases: `/vox`, `/speak`). Default voice: Eve (override with `FRIDAY_VOICE` env var). Platform-detected audio: `afplay` (macOS), `paplay` (Linux), PowerShell (Windows).
- **Debug Inference Logging** — `--debug` global CLI flag enables inference payload and response logging on every `provider.chat()` call. At the start of each `Cortex.chat()`, two files are cleared: `last-inference-payload.log` and `last-inference-response.log` in the project root. Each tool loop round appends a timestamped separator and the provider-specific wire-format JSON (the exact params sent to the API and the raw response received). This captures what the LLM actually sees and returns — essential for debugging hallucinations. The system prompt is also logged to the AuditLogger (`action: "debug:system-prompt"`). A `debug:enabled` audit entry is logged at boot. File I/O uses `appendFile` from `node:fs/promises` for round appending and `Bun.write()` for clearing — all wrapped in try/catch so debug failures never crash the primary chat function. `ChatOptions.debug` carries `payloadPath`, `responsePath`, and `round` number from Cortex to providers. Config flows: CLI global option → `optsWithGlobals()` → `launchTui()` → `RuntimeConfig.debug` → `CortexConfig.debug` → Cortex private fields. The default command handler explicitly forwards `--debug` through re-parse args.
- **Singleton Mode** — Friday supports a singleton runtime pattern: run `friday serve` in one terminal, then `friday chat` in another. The chat command auto-detects a running server via `~/.friday/friday.pid` and `~/.friday/friday.sock` and connects via `SocketBridge` instead of booting a local runtime. `RuntimeBridge` (`src/core/bridges/types.ts`) is the abstraction — `LocalBridge` wraps an in-process runtime, `SocketBridge` wraps Unix socket IPC to the server. The server writes PID/socket files at startup and cleans them on shutdown.
- **Client Registry** (`src/server/client-registry.ts`) tracks connected WebSocket clients with metadata (client type: chat, voice, tui). Enables the server to push targeted messages to specific client types.
- **VoiceBridge** (`src/core/voice/bridge.ts`) is the realtime conversational voice interface — distinct from Vox's fire-and-forget TTS. Connects to the Grok Realtime API via WebSocket (`wss://api.x.ai/v1/realtime`), with a state machine (idle → listening → thinking → speaking → error). Handles session updates, audio deltas, and transcript deltas with callbacks.
- **TUI Log Panel** (`src/cli/tui/components/log-panel.tsx`) provides an in-TUI debug log viewer. `LogStore` (`log-store.ts`) manages log entries, and `LogEntry` types (`log-types.ts`) define the structured log format.
- **Terminal-in-Browser** (`src/server/ttyd.ts`) spawns a ttyd process on port 7681 when the web server starts (if ttyd is installed), enabling a terminal interface embedded in the web UI via the `TerminalEmbed` component.

## Testing

- 949 tests across 94 files (as of 2026-02-28)
- Tests use `injectedModel: createMockModel()` (AI SDK `MockLanguageModelV3` from `ai/test` with call capture via `.doStreamCalls`/`.doGenerateCalls`)
- Use `createErrorModel()` for models that throw on `doGenerate`/`doStream`
- Shared test stubs live in `tests/helpers/stubs.ts`
- SQLite tests must clean up WAL files: unlink `db`, `db-wal`, and `db-shm` in afterEach
- `bun:sqlite` transactions: `db.transaction(() => { ... })()` — must invoke the returned function
- `node:fs/promises` `appendFile` is an accepted exception where Bun has no native append API
- TUI tests (`tui-*.test.ts`) cover ANSI parser, color utils, logo processor, state reducer, theme, and notification channel
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

Requires `XAI_API_KEY` in `.env` for the default Grok provider. Bun loads `.env` automatically.
Optional: `ANTHROPIC_API_KEY` for Anthropic provider (`--provider anthropic`).
Optional: `FRIDAY_REASONING_MODEL` and `FRIDAY_FAST_MODEL` to override default models (resolution: CLI flag > env var > provider default).
Optional: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Gmail module (OAuth 2.0).
Optional: `FRIDAY_SECRET_KEY` — fallback master key for SecretStore when OS keychain is unavailable.
Optional: `FRIDAY_GENESIS_PATH` to override default `~/.friday/GENESIS.md` location.
Optional: `FRIDAY_VOICE` to override default voice (Eve). Available: Ara, Eve, Rex, Sal, Leo.
Optional: `FRIDAY_SLACK_WEBHOOK_URL` for Slack notification channel.
Optional: `FRIDAY_WEBHOOK_URL` for generic webhook notification channel.
Optional: `FRIDAY_EMAIL_WEBHOOK_URL` for email webhook notification channel.

## Docker

```bash
docker build -t friday .
docker run -e ANTHROPIC_API_KEY=sk-ant-... friday chat
```

## Design Documents

- Architecture design: `docs/plans/2026-02-21-friday-agent-runtime-design.md`
- SMARTS design: `docs/plans/2026-02-21-smarts-dynamic-knowledge-design.md`
- CLI markdown rendering: `docs/plans/2026-02-21-cli-markdown-rendering-design.md`
- Sensorium design: `docs/plans/2026-02-21-sensorium-environment-awareness-design.md`
- Web UI design: `docs/plans/2026-02-21-friday-web-ui-design.md`
- Agentic tool loop: `docs/plans/2026-02-21-agentic-tool-loop-design.md`
- OpenTUI TUI design: `docs/plans/2026-02-22-opentui-tui-design.md`
- Hero header splash: `docs/plans/2026-02-22-hero-header-design.md`
- Forge design: `docs/plans/2026-02-22-the-forge-self-improvement-design.md`
- SMARTS staleness prevention: `docs/plans/2026-02-22-smarts-staleness-prevention-design.md`
- TUI text selection & copy: `docs/plans/2026-02-22-tui-text-selection-copy-design.md`
- Conversational memory recall (Deja Vu): `docs/plans/2026-02-23-conversational-memory-recall-design.md`
- Arc Rhythm scheduling: `docs/plans/2026-02-24-arc-rhythm-scheduling-design.md`
- Gmail module design: `docs/plans/2026-02-25-gmail-module-design.md`
- Genesis identity prompt design: `docs/plans/2026-02-25-genesis-identity-prompt-design.md`
- TUI log panel: `docs/plans/2026-02-24-tui-log-panel-design.md`
- Vox voice output: `docs/plans/2026-02-25-vox-voice-output-design.md`
- Debug prompt logging: `docs/plans/2026-02-26-debug-prompt-logging-design.md`
- Genesis prompt optimization: `docs/plans/2026-02-26-genesis-prompt-optimization-design.md`
- Max tokens truncation: `docs/plans/2026-02-26-max-tokens-truncation-design.md`
- Inference payload logging: `docs/plans/2026-02-27-inference-payload-logging-design.md`
- Cortex AI SDK migration: `docs/plans/2026-02-27-cortex-ai-sdk-migration-design.md`
- Voice conversation UI PoC: `docs/plans/2026-02-27-voice-conversation-ui-poc-design.md`
- Voice UI React components: `docs/plans/2026-02-27-voice-ui-react-components-design.md`
- Voice web integration: `docs/plans/2026-02-27-voice-web-integration-design.md`
- MCU concept mapping: Cortex=brain, Protocol=slash command, Directive=standing order, Module=suit upgrade, Signal=event, Clearance=permission, SMARTS=dynamic knowledge, Sensorium=sensor suite, Deja Vu=recall, Arc Rhythm=heartbeat/scheduler, Genesis=identity template, Vox=voice

## Worktrees

Feature work uses git worktrees in `.worktrees/` (gitignored). Create with:
`git worktree add .worktrees/<name> -b feature/<name>`

## Documentation Lookup

Always use Context7 MCP (`resolve-library-id` then `query-docs`) to fetch up-to-date documentation for any library before writing code that depends on it. Do not rely on training data for API details.

## Conventions

- Friday's personality is defined in `~/.friday/GENESIS.md` (loaded at boot) — seed template lives in `src/core/prompts.ts` as `GENESIS_TEMPLATE`
- The user is a 30+ year programming veteran — Friday should match that expertise level in generated code
- Interactive chat uses the OpenTUI-based TUI (`src/cli/tui/`) — not the legacy marked-terminal renderer
- `renderMarkdown()` in `src/cli/render.ts` is still used by the web server, not the primary CLI chat
- CLI banner and non-TUI output uses chalk (colors) with Friday amber palette
- Biome handles both linting and formatting — run `bun run lint:fix` before committing
