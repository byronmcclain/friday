# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Friday** (F.R.I.D.A.Y. — Female Replacement Intelligent Digital Assistant Youth) is a personal AI assistant inspired by Tony Stark's assistant from the MCU. It features an interactive TUI (terminal UI) built with OpenTUI, a React-based web UI, and a modular agent runtime.

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **AI Providers**: Anthropic Claude (`@anthropic-ai/sdk`) and xAI Grok (`openai` SDK with xAI base URL)
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
│       ├── components/    # UI components (Header, ChatArea, InputBar, Message, Splash, etc.)
│       ├── lib/           # ANSI parser, color utils, chafa logo processor
│       └── channels/      # TuiChannel — notification bridge into TUI toasts
├── core/
│   ├── cortex.ts          # Cortex — LLM brain, conversation state, tool registration
│   ├── summarizer.ts      # ConversationSummarizer — generates session summaries via fast model
│   ├── runtime.ts         # FridayRuntime — boot/shutdown orchestrator, wires all subsystems
│   ├── events.ts          # SignalBus — typed event system (file:changed, test:failed, etc.)
│   ├── clearance.ts       # ClearanceManager — permission gates (read-fs, exec-shell, etc.)
│   ├── memory.ts          # SQLiteMemory — KV store, conversation history, FTS5 semantic search
│   ├── notifications.ts   # NotificationManager — multi-channel alerts (terminal, log, slack, webhook)
│   ├── types.ts           # Core types (FridayConfig, ConversationMessage, ProviderName)
│   └── prompts.ts         # System prompts defining Friday's personality and behavior
├── audit/
│   ├── types.ts           # AuditEntry, AuditFilter interfaces
│   └── logger.ts          # AuditLogger — action tracking with filtering
├── modules/
│   ├── types.ts           # FridayModule, FridayTool, FridayProtocol interfaces
│   ├── loader.ts          # Module discovery, validation, and loading
│   ├── filesystem/        # Filesystem module — read, write, list, delete, exec tools
│   └── forge/             # The Forge — self-improvement system
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
│   ├── protocol.ts        # /env protocol (status, cpu, memory, docker, ports, git)
│   └── tool.ts            # getEnvironmentStatus FridayTool
├── history/
│   └── protocol.ts        # /history protocol (list, show, clear) — session persistence
├── server/
│   ├── index.ts           # Bun.serve() HTTP + WebSocket server
│   ├── protocol.ts        # Shared message types (ClientMessage, ServerMessage)
│   ├── handler.ts         # WebSocketHandler — message routing to FridayRuntime
│   └── ws-channel.ts      # WebSocket notification channel
├── providers/             # LLM provider adapters (Anthropic, Grok)
├── config/                # Runtime configuration loading — future
└── utils/                 # Shared utilities — future
web/                       # React web UI (Vite + Tailwind)
├── src/
│   ├── components/        # React components (layout, chat, sidebar, input)
│   ├── hooks/             # useWebSocket, useChat, useSession, useSensorium, useSmarts, useHistory, useNotifications
│   ├── contexts/          # WebSocket, Chat, Session providers
│   └── index.css          # Tailwind theme (Friday amber palette)
smarts/                    # Runtime-generated knowledge files (gitignored, user-specific)
forge/                     # Friday-authored modules (gitignored, AI-generated)
tests/
├── helpers/               # Shared test stubs (stubProvider, grokStub)
├── unit/                  # Unit tests (bun:test) — 642 tests across 57 files
└── integration/           # Integration tests — future
```

### Key Design Patterns

- **FridayRuntime** (`src/core/runtime.ts`) is the composition root. It boots all subsystems in order: SignalBus, ClearanceManager, AuditLogger, NotificationManager, ProtocolRegistry, DirectiveStore/Engine, Memory, SmartsStore, Sensorium, Cortex, then discovers and loads Modules.
- **Cortex** (`src/core/cortex.ts`) is Friday's LLM brain. It owns conversation history, delegates to providers, and exposes tool registration for modules. When a SmartsStore is provided, Cortex enriches the system prompt with pinned and FTS5-matched knowledge per message. Replaces the old FridayCore.
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
- **TUI** (`src/cli/tui/`) is Friday's interactive terminal interface, built with OpenTUI (React for CLI). The `chat` command delegates to `launchTui()` which renders a React component tree: Header (shimmer animation), ChatArea (messages + thinking indicator), InputBar (command typeahead). State is managed via a reducer with phases: `splash → fading → booting → active → shutting-down`. TuiChannel bridges NotificationManager into TUI toasts. The splash screen uses chafa to convert the logo image to ANSI art with a fade animation.
- **History** (`src/history/protocol.ts`) provides the `/history` protocol (aliases: `/hist`) for browsing, viewing, and clearing past conversation sessions stored in SQLite.
- **Prompts** live in `src/core/prompts.ts` as exported constants. Friday's personality is defined here — keep it consistent when modifying.

## Testing

- 642 tests across 57 files (as of 2026-02-23)
- Runtime/Cortex tests use `injectedProvider` (stub `LLMProvider`) to avoid needing `ANTHROPIC_API_KEY`
- Shared test stubs live in `tests/helpers/stubs.ts` — import `stubProvider`/`grokStub` instead of defining inline
- SQLite tests must clean up WAL files: unlink `db`, `db-wal`, and `db-shm` in afterEach
- `bun:sqlite` transactions: `db.transaction(() => { ... })()` — must invoke the returned function
- `node:fs/promises` `appendFile` is an accepted exception where Bun has no native append API
- TUI tests (`tui-*.test.ts`) cover ANSI parser, color utils, logo processor, state reducer, theme, and notification channel

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
- Forge implementation: `docs/plans/2026-02-22-the-forge-implementation-plan.md`
- MCU concept mapping: Cortex=brain, Protocol=slash command, Directive=standing order, Module=suit upgrade, Signal=event, Clearance=permission, SMARTS=dynamic knowledge, Sensorium=sensor suite

## Worktrees

Feature work uses git worktrees in `.worktrees/` (gitignored). Create with:
`git worktree add .worktrees/<name> -b feature/<name>`

## Documentation Lookup

Always use Context7 MCP (`resolve-library-id` then `query-docs`) to fetch up-to-date documentation for any library before writing code that depends on it. Do not rely on training data for API details.

## Conventions

- Friday's personality is defined in `src/core/prompts.ts` — changes there affect all interactions
- The user is a 30+ year programming veteran — Friday should match that expertise level in generated code
- Interactive chat uses the OpenTUI-based TUI (`src/cli/tui/`) — not the legacy marked-terminal renderer
- `renderMarkdown()` in `src/cli/render.ts` is still used by the web server, not the primary CLI chat
- CLI banner and non-TUI output uses chalk (colors) with Friday amber palette
- Biome handles both linting and formatting — run `bun run lint:fix` before committing
