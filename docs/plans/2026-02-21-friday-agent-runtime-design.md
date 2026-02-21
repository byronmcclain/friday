# Friday Agent Runtime — Architecture Design

**Date**: 2026-02-21
**Status**: Approved

## Vision

An MCU-faithful AI assistant framework where Friday is a proactive, autonomous agent runtime. She loads capabilities as Modules, executes Protocols on command, follows Directives autonomously within Clearance boundaries, remembers everything through semantic Memory, and notifies you through multiple channels.

## Design Principles

- **JARVIS lineage model**: Proactive, not just reactive. Friday anticipates and acts on standing orders.
- **Dev-first, expandable**: Core developer tooling first, architecture supports non-dev capabilities later.
- **Full autonomy with guardrails**: Friday acts within defined Clearance boundaries, escalates when outside scope.
- **Hybrid module loading**: Filesystem convention for discovery, exported manifests for metadata.

## MCU-to-Framework Concept Map

| MCU Concept | Framework Name | What It Does | Real Example |
|---|---|---|---|
| FRIDAY's brain | **Cortex** | LLM reasoning, conversation memory, provider routing | Central orchestrator |
| "Activate Protocol X" | **Protocol** | Named, invocable command (slash command) | `/deploy`, `/scan`, `/research` |
| Standing orders | **Directive** | Persistent goal/rule with a permission scope | "Always run tests before I commit" |
| Suit module / weapon system | **Module** | Bundled capability (tools + knowledge + triggers) | `git-ops`, `code-analysis` |
| Suit function (repulsor) | **Tool** | Single executable action within a module | `git.commit()`, `fs.readFile()` |
| Loading new suit data | **Knowledge** | Context loaded on-demand into reasoning | API docs, project conventions |
| Event sensors | **Signal** | Internal event that triggers directives/protocols | `file:changed`, `test:failed` |
| Security clearance | **Clearance** | Permission scope for directive/module | `read-fs`, `exec-shell`, `network` |
| Mission log | **Audit Log** | Record of what Friday did, why, and with what result | Full action trace |

## Directory Structure

```
src/
├── main.ts                          # Entrypoint — bootstrap runtime
├── cli/
│   ├── index.ts                     # Commander setup, protocol registration
│   └── commands/                    # Built-in CLI commands (chat, status, etc.)
│       └── chat.ts
├── core/
│   ├── cortex.ts                    # Cortex — central brain (evolves from friday.ts)
│   ├── types.ts                     # All shared types/interfaces
│   ├── prompts.ts                   # Friday's personality & system prompts
│   ├── runtime.ts                   # Runtime — bootstraps cortex, loads modules, starts event loop
│   ├── events.ts                    # Signal bus — internal event emitter
│   ├── clearance.ts                 # Clearance system — permission definitions & checking
│   ├── memory.ts                    # Memory system — SQLite + vector search
│   └── notifications.ts            # Notification channel manager
├── directives/
│   ├── engine.ts                    # Directive engine — evaluates & executes active directives
│   ├── types.ts                     # Directive interfaces
│   └── store.ts                     # Persistence — load/save directives
├── modules/
│   ├── loader.ts                    # Module discovery & loading logic
│   ├── types.ts                     # Module, Tool, Knowledge interfaces
│   ├── git-ops/                     # Example module
│   │   ├── index.ts                 # Module manifest
│   │   ├── tools/
│   │   ├── knowledge/
│   │   └── protocols/
│   └── code-analysis/               # Example module
├── protocols/
│   ├── registry.ts                  # Protocol registry
│   └── types.ts                     # Protocol interfaces
├── providers/                       # LLM providers (existing)
│   ├── types.ts
│   ├── index.ts
│   ├── anthropic.ts
│   └── grok.ts
├── audit/
│   ├── logger.ts                    # Audit log
│   └── types.ts
└── config/
    └── index.ts                     # Runtime configuration
```

## Core Interfaces

### Module & Tool

```typescript
export interface FridayModule {
  name: string;
  description: string;
  version: string;
  tools: FridayTool[];
  protocols: FridayProtocol[];
  knowledge: string[];
  triggers: SignalName[];
  clearance: ClearanceName[];
  onLoad?(): Promise<void>;
  onUnload?(): Promise<void>;
}

export interface FridayTool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  clearance: ClearanceName[];
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolContext {
  workingDirectory: string;
  cortex: CortexInterface;
  audit: AuditLogger;
  signal: SignalEmitter;
  memory: ScopedMemory;
}

export interface ToolResult {
  success: boolean;
  output: string;
  artifacts?: Record<string, unknown>;
}
```

### Protocol

```typescript
export interface FridayProtocol {
  name: string;
  description: string;
  aliases: string[];
  parameters: ToolParameter[];
  clearance: ClearanceName[];
  execute(args: Record<string, unknown>, context: ProtocolContext): Promise<ProtocolResult>;
}

export interface ProtocolContext extends ToolContext {
  tools: Map<string, FridayTool>;
}

export interface ProtocolResult {
  success: boolean;
  summary: string;
  details?: string;
}
```

### Directive

```typescript
export interface FridayDirective {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: DirectiveTrigger;
  action: DirectiveAction;
  clearance: ClearanceName[];
  executionCount: number;
  notify?: {
    channels: string[];
    level: "info" | "warning" | "alert";
  };
}

export type DirectiveTrigger =
  | { type: "signal"; signal: SignalName }
  | { type: "schedule"; cron: string }
  | { type: "pattern"; pattern: string }
  | { type: "manual" };

export type DirectiveAction =
  | { type: "protocol"; protocol: string; args?: Record<string, unknown> }
  | { type: "tool"; tool: string; args?: Record<string, unknown> }
  | { type: "prompt"; prompt: string }
  | { type: "sequence"; steps: DirectiveAction[] };
```

### Clearance

```typescript
export type ClearanceName =
  | "read-fs"
  | "write-fs"
  | "delete-fs"
  | "exec-shell"
  | "network"
  | "git-read"
  | "git-write"
  | "provider"
  | "system";

export interface ClearanceCheck {
  granted: boolean;
  reason?: string;
}
```

### Signal (Event System)

```typescript
export type SignalName =
  | "file:changed"
  | "file:created"
  | "file:deleted"
  | "test:passed"
  | "test:failed"
  | "command:pre-execute"
  | "command:post-execute"
  | "command:pre-commit"
  | "session:start"
  | "session:end"
  | "error:unhandled"
  | `custom:${string}`;

export interface Signal {
  name: SignalName;
  timestamp: Date;
  source: string;
  data?: Record<string, unknown>;
}
```

### Memory

```typescript
export interface FridayMemory {
  // Key-value (namespaced)
  get<T>(namespace: string, key: string): Promise<T | undefined>;
  set<T>(namespace: string, key: string, value: T): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string): Promise<string[]>;

  // Semantic (embedding-based)
  embed(namespace: string, content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(namespace: string, query: string, limit?: number): Promise<SemanticResult[]>;
  forget(namespace: string, embeddingId: string): Promise<void>;

  // Conversation history
  getConversationHistory(limit?: number): Promise<ConversationSession[]>;
  saveConversation(session: ConversationSession): Promise<void>;
}

export interface ScopedMemory {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
  embed(content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(query: string, limit?: number): Promise<SemanticResult[]>;
  forget(embeddingId: string): Promise<void>;
}

export interface SemanticResult {
  id: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface ConversationSession {
  id: string;
  startedAt: Date;
  endedAt?: Date;
  provider: string;
  model: string;
  messages: ConversationMessage[];
  summary?: string;
}
```

**Storage**: SQLite via `bun:sqlite` at `~/.friday/memory.db`. Vectors stored as float arrays, cosine similarity computed in queries.

### Notifications

```typescript
export interface NotificationChannel {
  name: string;
  send(notification: FridayNotification): Promise<void>;
}

export interface FridayNotification {
  level: "info" | "warning" | "alert";
  title: string;
  body: string;
  source: string;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  protocol: string;
  args?: Record<string, unknown>;
}
```

**Built-in channels**: Terminal, System notification (OS-native), Log file, Slack (webhook), Generic webhook.

## Runtime Lifecycle

### Boot Sequence

1. Load config (`~/.friday/config.toml` or env vars)
2. Initialize Memory (SQLite connection)
3. Initialize Cortex (LLM provider, system prompt, memory)
4. Discover & Load Modules (scan `src/modules/*`, validate manifests)
5. Check Clearances (verify each module's permissions against config)
6. Register Protocols (from modules + built-in)
7. Load Directives (from `~/.friday/directives/`)
8. Start Signal Bus (event system ready)
9. Emit signal: `session:start`
10. Enter command loop (CLI) or await events (daemon mode)

### Process Loop (CLI Mode)

```
User Input
  ├─ Is it a protocol? (/command)
  │    YES → Execute protocol → Return result
  │    NO  → Send to Cortex with tools, knowledge, directives
  │           → Cortex reasons → may call tools (agentic loop)
  │           → Check clearance before each tool call
  │           → Generate response
  ├─ Emit signal: command:post-execute
  ├─ Check directives triggered by result
  └─ Return response + audit log entry
```

### Daemon Mode

- Background event loop watching for Signals
- Signal sources: file watcher, cron scheduler, git hooks, IPC, webhooks
- IPC via Unix socket at `~/.friday/friday.sock`
- CLI communicates with daemon through IPC for status, logs, directive management

### Daemon CLI Commands

```bash
friday daemon                # Start daemon
friday daemon --detach       # Start detached
friday status                # Check daemon status
friday logs                  # Stream audit log
friday directive add "..."   # Add directive to running daemon
friday signal emit <name>    # Manually trigger a signal
```

## Key Design Decisions

1. **ProviderName lives in core/types.ts** — avoids circular dependency between providers/ and core/
2. **Modules are stateless re: conversation** — Cortex owns history, modules own domain state via Memory
3. **Protocols bypass reasoning** — direct execution for known commands (reflexive vs. deliberative)
4. **Clearance checked per tool call** — not just at module load time
5. **SQLite for everything** — key-value, vectors, audit log, conversation history (single file, zero ops)
6. **Unix socket IPC** — local-only, no network exposure, per-user isolation
7. **Notification channels are pluggable** — same interface for terminal, Slack, webhook, etc.

## User Data Location

All persistent state lives under `~/.friday/`:

```
~/.friday/
├── config.toml          # Runtime configuration
├── memory.db            # SQLite database (KV, vectors, conversations, audit)
├── directives/          # Stored directives
├── friday.sock          # Daemon IPC socket (when running)
└── notifications.log    # Notification history
```
