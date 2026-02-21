# F.R.I.D.A.Y.

**Female Replacement Intelligent Digital Assistant Youth**

A CLI-first personal AI assistant inspired by Tony Stark's companion from the MCU. Friday is an autonomous agent runtime that loads capabilities as Modules, executes Protocols on command, follows Directives within Clearance boundaries, and remembers everything through persistent Memory.

Built on [Bun](https://bun.sh) and TypeScript. Powered by Anthropic Claude and xAI Grok.

---

## Quick Start

```bash
# Clone and install
git clone <repo-url> && cd friday
bun install

# Configure your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Start chatting
bun run start chat
```

Friday greets you and enters an interactive session. Type natural language to converse, `/command` to invoke a protocol, or `exit` to end the session.

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

---

## Architecture

Friday is an **agent runtime**, not just a chatbot wrapper. The `FridayRuntime` orchestrator boots all subsystems, wires them together, and manages the full lifecycle.

### Boot Sequence

```
SignalBus -> ClearanceManager -> AuditLogger -> NotificationManager
  -> ProtocolRegistry -> DirectiveStore/Engine -> Cortex -> Module Discovery
```

### Process Loop

```
User Input
  |-- Starts with /command?
  |     YES -> ProtocolRegistry -> Execute handler -> Return result
  |     NO  -> Cortex (LLM) -> Reason with tools -> Generate response
  |-- Emit signal: command:post-execute
  |-- Check directives triggered by result
  '-- Return response + audit entry
```

Protocols bypass the LLM entirely for deterministic, fast execution. Everything else flows through the Cortex for reasoning.

### Subsystems

- **Cortex** (`src/core/cortex.ts`) -- The LLM brain. Owns conversation history, delegates to providers (Anthropic or Grok), and exposes tool registration for modules.

- **SignalBus** (`src/core/events.ts`) -- Typed event system. Signals like `file:changed`, `test:failed`, and `session:start` flow through the bus, triggering directives and module behavior. Supports `on`, `off`, `once`, and custom signals via `custom:*`.

- **Modules** (`src/modules/types.ts`) -- Discoverable capability bundles. Each module declares its tools, protocols, knowledge, signal triggers, and required clearances. Auto-loaded from the filesystem at boot.

- **Protocols** (`src/protocols/registry.ts`) -- Slash-command routing with alias support. Input starting with `/` is parsed and dispatched directly to the matching protocol handler.

- **Directives** (`src/directives/engine.ts`) -- Autonomous rules. A directive binds a trigger (signal, schedule, pattern, or manual) to an action (tool, protocol, prompt, or sequence). The engine listens on the SignalBus and fires matching directives after clearance checks.

- **Clearance** (`src/core/clearance.ts`) -- Permission gates. Every tool call and directive execution is checked against granted clearances (`read-fs`, `write-fs`, `exec-shell`, `network`, `git-read`, `git-write`, `provider`, `system`).

- **Memory** (`src/core/memory.ts`) -- SQLite-backed persistence via `bun:sqlite`. Namespaced key-value store, conversation history, and FTS5 full-text search. Modules get scoped memory instances.

- **Audit** (`src/audit/logger.ts`) -- Action tracking with source, action type, detail, success/failure, and metadata. Filterable by source, action, and time range.

- **Notifications** (`src/core/notifications.ts`) -- Multi-channel alert system. Built-in channels: Terminal, Log file, Slack (webhook), and generic Webhook. Notifications carry a level (`info`, `warning`, `alert`) and optional action buttons that map to protocols.

---

## CLI Usage

```bash
# Start interactive chat (default: Anthropic Claude)
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
| `exit`, `quit`, `bye` | Ends the session and shuts down the runtime |

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

Copy the example environment file and add your API keys:

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

Bun loads `.env` automatically -- no dotenv needed.

---

## Development

```bash
# Run with auto-restart on file changes
bun run dev

# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run a single test file
bun test tests/unit/friday.test.ts

# Lint (check only)
bun run lint

# Lint and auto-fix
bun run lint:fix

# Format source files
bun run format

# TypeScript type checking
bun run typecheck
```

### Project Structure

```
src/
├── main.ts              # Entrypoint -- CLI bootstrap
├── cli/
│   ├── index.ts         # Commander program definition
│   └── commands/        # One file per CLI command
├── core/
│   ├── cortex.ts        # LLM brain and conversation state
│   ├── runtime.ts       # Boot/shutdown orchestrator
│   ├── events.ts        # SignalBus -- typed event system
│   ├── clearance.ts     # Permission gates
│   ├── memory.ts        # SQLite persistence and FTS5 search
│   ├── notifications.ts # Multi-channel notification system
│   ├── types.ts         # Core TypeScript interfaces
│   └── prompts.ts       # Friday's personality
├── audit/               # Action tracking and filtering
├── modules/             # Module interface and loader
├── protocols/           # Protocol registry and routing
├── directives/          # Autonomous rule engine
└── providers/           # LLM provider adapters
tests/
├── unit/                # Unit tests (bun:test)
└── integration/         # Integration tests (future)
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

The image uses `oven/bun:1` as the base and runs with `--frozen-lockfile --production` for reproducible builds.

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript (strict mode) |
| AI Providers | Anthropic Claude (`@anthropic-ai/sdk`), xAI Grok (`openai` SDK) |
| CLI Framework | [Commander.js](https://github.com/tj/commander.js) |
| Database | SQLite via `bun:sqlite` (KV, conversations, FTS5 search) |
| Linter/Formatter | [Biome](https://biomejs.dev) |
| CLI UX | chalk (colors), ora (spinners), boxen (bordered boxes), inquirer (prompts) |
| Container | Docker (`oven/bun:1`) |

---

## License

Private project. Not published to any package registry.
