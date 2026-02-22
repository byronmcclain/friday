<div align="center">
<br />

<img src="friday-logo.jpeg" alt="Friday Logo" width="300" />

<br />

# F.R.I.D.A.Y.

**Female Replacement Intelligent Digital Assistant Youth**

An autonomous AI agent runtime inspired by Tony Stark's companion.
CLI-first. Module-driven. Built to think, remember, and adapt.

<br />

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-270%20passing-brightgreen)]()
[![Biome](https://img.shields.io/badge/lint-Biome-60a5fa?logo=biome)](https://biomejs.dev)

<br />
</div>

---

Friday is an **agent runtime**, not a chatbot wrapper. She loads capabilities as **Modules**, executes **Protocols** on command, follows **Directives** autonomously, learns through **SMARTS** dynamic knowledge, monitors her environment via **Sensorium**, and remembers everything through persistent **Memory** — all within **Clearance** boundaries and a full **Audit** trail.

Built on [Bun](https://bun.sh) and TypeScript. Powered by Anthropic Claude and xAI Grok.

---

## Quick Start

```bash
# Clone and install
git clone <repo-url> && cd friday
bun install

# Configure your API key
cp .env.example .env
# Edit .env — add ANTHROPIC_API_KEY or XAI_API_KEY

# Start chatting
bun run start chat
```

Friday greets you and enters an interactive session. Type natural language to converse, `/command` to invoke a protocol, or `exit` to end the session.

---

## What's Inside

### 🧠 Cortex — The Brain

LLM reasoning engine with conversation memory, multi-provider support (Anthropic Claude, xAI Grok), and tool registration. Every module's capabilities flow through here.

### 📚 SMARTS — Dynamic Knowledge

Markdown files with YAML frontmatter, FTS5-indexed into SQLite. Knowledge is queried per-message to enrich the system prompt, and new insights are extracted from conversations automatically via the SmartsCurator.
`/smart list` · `/smart search <query>` · `/smart domains`

### 🌡️ Sensorium — Environmental Awareness

Dual-cadence polling (30s fast / 5min slow) gathers machine stats, Docker containers, git status, open ports, and installed runtimes. Alert hysteresis fires on state transitions, not every tick. A compact context block is injected into every system prompt so Friday always knows her environment.
`/env status` · `/env cpu` · `/env memory` · `/env docker` · `/env git`

### 📁 Filesystem Module — Hands On the Keyboard

Read, write, list, delete files and execute shell commands — Friday's first real module. Paged file reading for large files, clearance-gated execution, and full audit logging.

### 🔨 The Forge — Self-Improvement

Friday can write her own modules. The Forge system lets her propose new capabilities, validate them (import test, typecheck, lint), and gracefully restart to load them — all with human approval at every step. Failed modules don't crash the runtime; errors are reported back so Friday can iterate on fixes.
`/forge list` · `/forge status <name>` · `/forge history <name>` · `/forge protect <name>`

### ⚡ SignalBus — Reactive Nervous System

Typed events (`file:changed`, `test:failed`, `session:start`) flow through the bus, triggering directives and module behavior. Supports custom signals via `custom:*`.

### 🛡️ Clearance & Audit — Trust but Verify

Every tool call and directive execution passes through permission gates. Every action is logged with source, detail, success/failure, and metadata.

---

## MCU Concept Map

The architecture borrows its vocabulary from the MCU. Each subsystem maps to something in Tony Stark's world:

| MCU Concept | Framework Name | What It Does |
|---|---|---|
| Friday's brain | **Cortex** | LLM reasoning, conversation memory, provider routing |
| "Activate Protocol X" | **Protocol** | Named slash command executed without LLM reasoning |
| Standing orders | **Directive** | Autonomous rule triggered by signals or schedules |
| Suit module | **Module** | Bundled capability (tools + protocols + knowledge) |
| Suit function | **Tool** | Single executable action within a module |
| Event sensors | **Signal** | Internal event that triggers directives and modules |
| Security clearance | **Clearance** | Permission gate for tools, directives, and modules |
| Mission log | **Audit Log** | Record of every action, reason, and result |
| Alert system | **Notification** | Multi-channel alerts (terminal, Slack, webhook) |
| Field knowledge | **SMARTS** | Dynamic knowledge base — learns from conversations |
| Sensor suite | **Sensorium** | Environmental awareness — machine, Docker, dev tools |
| The workshop | **Forge** | Self-improvement — Friday authors and patches her own modules |

---

## Architecture

### Boot Sequence

```
SignalBus → ClearanceManager → AuditLogger → NotificationManager
  → ProtocolRegistry → DirectiveStore/Engine → Memory → SmartsStore
  → Sensorium → Cortex → Module Discovery → Forge Module Discovery
```

### Process Loop

```
User Input
  |-- Starts with /command?
  |     YES → ProtocolRegistry → Execute handler → Return result
  |     NO  → Cortex (LLM) → Reason with tools → Generate response
  |-- Cortex enriches prompt with:
  |     • Pinned + FTS5-matched SMARTS knowledge
  |     • Sensorium environment context block
  |-- Emit signal: command:post-execute
  |-- Check directives triggered by result
  '-- Return response + audit entry
```

### Subsystems

- **Cortex** (`src/core/cortex.ts`) — The LLM brain. Owns conversation history, delegates to providers (Anthropic or Grok), exposes tool registration, and enriches the system prompt with SMARTS knowledge and Sensorium context per message.

- **SMARTS** (`src/smarts/`) — Dynamic knowledge system. Markdown files with YAML frontmatter are FTS5-indexed into SQLite, queried per-message to enrich prompts, and new knowledge is extracted from conversations on shutdown via SmartsCurator.

- **Sensorium** (`src/sensorium/`) — Environmental awareness. Pure sensor functions gather machine stats (`node:os`), Docker containers (`Bun.$`), and dev environment (git, ports, runtimes). Dual-cadence polling with alert hysteresis injects a compact context block into the system prompt.

- **SignalBus** (`src/core/events.ts`) — Typed event system. Signals like `file:changed`, `test:failed`, and `session:start` flow through the bus, triggering directives and module behavior.

- **Modules** (`src/modules/`) — Discoverable capability bundles. Each module declares tools, protocols, knowledge, signal triggers, and required clearances. Auto-loaded from the filesystem at boot. First module: **Filesystem** (read, write, list, delete, exec).

- **Protocols** (`src/protocols/registry.ts`) — Slash-command routing with alias support. Input starting with `/` is dispatched directly to the matching handler.

- **Directives** (`src/directives/engine.ts`) — Autonomous rules. A directive binds a trigger (signal, schedule, pattern, or manual) to an action (tool, protocol, prompt, or sequence). The engine fires matching directives after clearance checks.

- **Clearance** (`src/core/clearance.ts`) — Permission gates. Every tool call and directive execution is checked against granted clearances.

- **Memory** (`src/core/memory.ts`) — SQLite-backed persistence via `bun:sqlite`. Namespaced KV store, conversation history, and FTS5 full-text search. Modules get scoped memory instances.

- **Audit** (`src/audit/logger.ts`) — Action tracking with source, action type, detail, success/failure, and metadata.

- **Notifications** (`src/core/notifications.ts`) — Multi-channel alerts: Terminal, Log file, Slack (webhook), and generic Webhook.

---

## CLI Usage

```bash
# Start interactive chat (default provider)
bun run start chat

# Use a specific provider
bun run start chat --provider grok

# Use a specific model
bun run start chat --model claude-sonnet-4-20250514

# Combine flags
bun run start chat --provider grok --model grok-3
```

### In-Session Commands

| Input | Behavior |
|---|---|
| Natural language | Sent to Cortex for LLM reasoning |
| `/command [args]` | Routed directly to a registered Protocol |
| `/smart list` | List all knowledge entries |
| `/smart search <query>` | FTS5 search across SMARTS knowledge |
| `/smart domains` | Show knowledge domains |
| `/env status` | Full environment snapshot |
| `/env cpu` / `/env memory` | System resource details |
| `/env docker` | Running container status |
| `/env git` | Git repository state |
| `/forge list` | List all forge-authored modules |
| `/forge status <name>` | Detailed health of a forge module |
| `/forge history <name>` | Version history of a forge module |
| `/forge protect <name>` | Mark a forge module as immutable |
| `exit`, `quit`, `bye` | Ends the session |

### Provider Defaults

| Provider | Default Model |
|---|---|
| `anthropic` | `claude-sonnet-4-20250514` |
| `grok` | `grok-3` |

---

## Creating a Module

Modules are the primary extension point. A module bundles tools, protocols, knowledge, and signal triggers into a discoverable unit.

```typescript
import type { FridayModule } from "../modules/types.ts";

const myModule: FridayModule = {
  name: "my-module",
  description: "Does something useful",
  version: "1.0.0",
  tools: [
    {
      name: "my-tool",
      description: "Performs an action",
      parameters: [
        { name: "target", type: "string", description: "What to act on", required: true },
      ],
      clearance: ["read-fs"],
      execute: async (args, context) => {
        context.audit.log({
          action: "my-tool:run",
          source: "my-module",
          detail: `Acting on ${args.target}`,
          success: true,
        });
        return { success: true, output: `Done with ${args.target}` };
      },
    },
  ],
  protocols: [],
  knowledge: [],
  triggers: ["file:changed"],
  clearance: ["read-fs"],

  async onLoad() {
    // Called when the module is loaded at boot
  },

  async onUnload() {
    // Called during runtime shutdown
  },
};

export default myModule;
```

---

## Environment Setup

```bash
cp .env.example .env
```

```env
# Required for Anthropic provider (default)
ANTHROPIC_API_KEY=sk-ant-...

# Required for Grok provider (--provider grok)
XAI_API_KEY=xai-...

# Optional: Override the default model
FRIDAY_MODEL=claude-sonnet-4-20250514
```

Bun loads `.env` automatically — no dotenv needed.

---

## Development

```bash
bun run dev              # Auto-restart on file changes
bun test                 # Run all tests (270 tests across 25 files)
bun test --watch         # Watch mode
bun test tests/unit/cortex.test.ts  # Single test file
bun run lint             # Lint check
bun run lint:fix         # Lint and auto-fix
bun run format           # Format source files
bun run typecheck        # TypeScript type checking
```

### Project Structure

```
src/
├── main.ts                # Entrypoint — CLI bootstrap
├── cli/
│   ├── index.ts           # Commander program definition
│   ├── render.ts          # Markdown → ANSI terminal rendering
│   └── commands/          # One file per CLI command
├── core/
│   ├── cortex.ts          # LLM brain and conversation state
│   ├── runtime.ts         # Boot/shutdown orchestrator
│   ├── events.ts          # SignalBus — typed event system
│   ├── clearance.ts       # Permission gates
│   ├── memory.ts          # SQLite persistence and FTS5 search
│   ├── notifications.ts   # Multi-channel notification system
│   ├── types.ts           # Core TypeScript interfaces
│   └── prompts.ts         # Friday's personality
├── audit/                 # Action tracking and filtering
├── modules/
│   ├── types.ts           # FridayModule, FridayTool interfaces
│   ├── loader.ts          # Module discovery and validation
│   ├── filesystem/        # Read, write, list, delete, exec tools
│   └── forge/             # The Forge — self-improvement system
├── protocols/             # Protocol registry and routing
├── directives/            # Autonomous rule engine
├── smarts/
│   ├── types.ts           # SmartEntry, SmartsConfig types
│   ├── parser.ts          # YAML frontmatter parser/serializer
│   ├── store.ts           # FTS5-indexed knowledge base
│   ├── protocol.ts        # /smart protocol handler
│   └── curator.ts         # Autonomous knowledge extraction
├── sensorium/
│   ├── types.ts           # SystemSnapshot, SensorConfig types
│   ├── sensors.ts         # Pure sensor functions (machine, Docker, dev)
│   ├── sensorium.ts       # Polling loop, alerts, context block
│   ├── protocol.ts        # /env protocol handler
│   └── tool.ts            # LLM-accessible environment tool
├── providers/             # LLM provider adapters
└── utils/                 # Shared utilities
smarts/                    # Seed knowledge files (YAML + markdown)
tests/
├── helpers/               # Shared test stubs
├── unit/                  # 270 tests across 25 files
└── integration/           # Integration tests — future
```

---

## Docker

```bash
# Build
docker build -t friday .

# Run
docker run -e ANTHROPIC_API_KEY=sk-ant-... friday chat

# With Grok
docker run -e XAI_API_KEY=xai-... friday chat --provider grok
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript (strict mode) |
| AI Providers | Anthropic Claude (`@anthropic-ai/sdk`), xAI Grok (`openai` SDK) |
| CLI Framework | [Commander.js](https://github.com/tj/commander.js) |
| Database | SQLite via `bun:sqlite` (KV, conversations, FTS5 search) |
| Knowledge | SMARTS — YAML frontmatter + FTS5-indexed markdown |
| Monitoring | Sensorium — dual-cadence polling with alert hysteresis |
| Linter/Formatter | [Biome](https://biomejs.dev) |
| CLI UX | chalk, ora, boxen, inquirer, marked + marked-terminal |
| Container | Docker (`oven/bun:1`) |

---

## License

Private project. Not published to any package registry.
