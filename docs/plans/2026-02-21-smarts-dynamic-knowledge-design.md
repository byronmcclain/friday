# SMARTS — Dynamic Knowledge System Design

**Date**: 2026-02-21
**Status**: Approved
**MCU Mapping**: SMARTS = Friday's specialized expertise, like suit modules for her brain

## Overview

SMARTS (Specialized Modular Adaptive Runtime Training System) extends Friday's prompt with dynamically loaded domain knowledge. Instead of a static system prompt, Friday searches a directory of markdown knowledge files and injects relevant context into each LLM call based on what the user is asking about.

Friday also autonomously generates and curates SMARTS files based on conversations, building institutional knowledge over time.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | Markdown files + FTS5 index | Human-readable, git-trackable, leverages existing SQLiteMemory |
| Architecture | Standalone subsystem | Clean separation, doesn't overload modules |
| Injection timing | Per-message + explicit pinning | Adaptive context with manual override via `/smart` protocol |
| Content scope | Domain expertise + project context | Both general knowledge and institutional memory |
| Authoring | Hybrid: user + Friday auto-generation | Friday learns autonomously, user can also author manually |
| Token budget | 24K tokens (configurable) | Grok 2M context makes this trivial (~1.2%) |
| SMARTS per message | 5 (configurable) | Generous default, token budget is the real constraint |
| Auto-generation | Non-blocking async | Never blocks CLI/UI; fire-and-forget on session:end |

## SMARTS File Format

Each SMARTS file is a markdown file with YAML frontmatter living in `smarts/` at the project root (configurable via `RuntimeConfig.smartsDir`).

```markdown
---
name: security-best-practices
domain: security
tags: [owasp, xss, sql-injection, auth, encryption]
confidence: 0.9
source: auto
created: 2026-02-21
updated: 2026-02-21
---

# Security Best Practices

## Input Validation
Always sanitize user input at system boundaries...
```

### Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique identifier, kebab-case, matches filename |
| `domain` | string | Broad category (security, docker, typescript, bun, project-friday, etc.) |
| `tags` | string[] | Fine-grained keywords for FTS5 matching |
| `confidence` | number | 0.0-1.0 reliability score |
| `source` | enum | `"manual"` (user-authored), `"auto"` (Friday-generated), `"conversation"` (extracted from chat) |
| `created` | date | Creation date |
| `updated` | date | Last modification date |

### Confidence Levels

- `1.0` — Manually authored or manually reviewed
- `0.8` — Auto-generated and confirmed useful in a conversation
- `0.7` — Auto-generated, unreviewed (default for Friday-created SMARTS)
- Below `0.5` — Flagged as potentially outdated or conflicting

## Architecture

### SmartsStore Subsystem

The `SmartsStore` is a new subsystem booted by FridayRuntime, positioned between DirectiveEngine and Cortex in the boot sequence:

```
SignalBus → ClearanceManager → AuditLogger → NotificationManager
  → ProtocolRegistry → DirectiveStore/Engine → SmartsStore → Cortex → Modules
```

SmartsStore boots before Cortex so Cortex can reference it during chat calls.

### Core API

```typescript
interface SmartEntry {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  source: "manual" | "auto" | "conversation";
  content: string;          // Markdown body without frontmatter
  filePath: string;         // Absolute path to the .md file
}

interface SmartsConfig {
  smartsDir: string;        // Path to smarts/ directory
  maxPerMessage: number;    // Default: 5
  tokenBudget: number;      // Default: 24000
  minConfidence: number;    // Default: 0.5
}

class SmartsStore {
  async initialize(config: SmartsConfig, memory: SQLiteMemory): Promise<void>;
  async findRelevant(query: string, limit?: number): Promise<SmartEntry[]>;
  async getByDomain(domain: string): Promise<SmartEntry[]>;
  async getByName(name: string): Promise<SmartEntry | undefined>;
  async create(entry: Omit<SmartEntry, 'filePath'>): Promise<SmartEntry>;
  async update(name: string, content: string): Promise<void>;
  async reindex(): Promise<void>;
  domains(): string[];
  all(): SmartEntry[];
}
```

### Lifecycle

1. **Boot**: Scan `smarts/` for `*.md` files, parse frontmatter + body, index content into SQLiteMemory FTS5 (namespace: `"smarts"`), store parsed metadata in `Map<string, SmartEntry>`
2. **Query**: On each `Cortex.chat()` call, extract keywords from user message, query FTS5, return top-N ranked by relevance score filtered by minimum confidence
3. **Write**: When Friday creates a new SMARTS file, write the `.md` file to disk, add to the FTS5 index, update the in-memory map
4. **Reindex**: On-demand via `/smart reload` — re-scan directory, rebuild FTS5 index

## Cortex Integration — Dynamic Prompt Assembly

### Current Flow (static)
```
user message → Cortex.chat() → provider.chat(SYSTEM_PROMPT, history) → response
```

### New Flow (dynamic)
```
user message → Cortex.chat()
  → smartsStore.findRelevant(userMessage, limit=5)
  → Assemble enriched system prompt:
      BASE_PROMPT (personality, guidelines from prompts.ts)
      + PINNED_SMARTS (from /smart pin)
      + RELEVANT_SMARTS (from FTS5 query, up to token budget)
  → provider.chat(enrichedPrompt, history)
  → response
```

### Enriched Prompt Structure

```
[Base Friday personality — existing SYSTEM_PROMPT]

## Active Knowledge

The following domain knowledge is available for this conversation.
Use it to inform your responses when relevant.

### Security Best Practices (confidence: 0.9)
[content from security-best-practices.md]

### Bun Runtime Patterns (confidence: 1.0)
[content from bun-patterns.md]
```

### Token Budget Enforcement

- Default budget: 24,000 tokens (~24K)
- Pinned SMARTS are always included (counted against budget first)
- Auto-matched SMARTS fill remaining budget, ranked by FTS5 score
- If a single SMARTS file exceeds remaining budget, it's truncated or skipped
- Rough token estimation: `content.length / 4` (conservative for English text)

## Auto-Generation — Friday Learning

### Triggers

1. **Session end**: When `session:end` signal fires, if the conversation had 5+ exchanges on a substantive topic without existing SMARTS coverage
2. **Explicit save**: During conversation, Friday can proactively create a SMARTS file when she accumulates reusable knowledge (requires `write-fs` clearance)

### Process (Non-Blocking)

```
session:end signal fires
  → SmartsCurator directive triggers (fire-and-forget async)
  → Analyzes conversation history for extractable knowledge
  → Calls LLM with extraction meta-prompt
  → LLM returns structured SMARTS content
  → SmartsStore.create() writes .md file + indexes
  → AuditLogger records creation
```

**Critical**: Auto-generation NEVER blocks the CLI or UI. It runs as an unblocked async operation. For shutdown scenarios, a brief grace period (5s) allows in-flight writes to complete, or the task is persisted for next boot.

### Extraction Meta-Prompt

```
Review this conversation and extract any reusable domain knowledge.
For each piece of knowledge:
- Give it a clear, specific name (kebab-case)
- Assign a domain and relevant tags
- Write concise, actionable content (not conversation-specific)
- Set confidence based on how authoritative the information is

Only extract knowledge that would be useful in future conversations.
Do not extract conversation-specific context or personal information.
```

### Confidence Evolution

- Auto-generated SMARTS start at `0.7`
- Referenced in conversation where user confirms usefulness → bump to `0.8`
- Manually reviewed by user → `1.0`
- Conflicting knowledge detected → flag for review, don't overwrite existing

## /smart Protocol

A new protocol for manual SMARTS management, registered via ProtocolRegistry.

| Command | Description |
|---------|-------------|
| `/smart list` | List all SMARTS (name, domain, confidence, source) |
| `/smart show <name>` | Display a specific SMARTS file content |
| `/smart pin <name\|domain>` | Pin SMARTS for this session (always injected) |
| `/smart unpin <name\|domain>` | Remove pin |
| `/smart reload` | Re-scan smarts/ directory and re-index FTS5 |
| `/smart search <query>` | Manual FTS5 search to preview matches |
| `/smart create <name>` | Interactively create a new SMARTS file |
| `/smart domains` | List all known domains |

## File Structure

```
src/
├── smarts/
│   ├── types.ts           # SmartEntry, SmartsConfig interfaces
│   ├── store.ts           # SmartsStore class
│   ├── parser.ts          # YAML frontmatter parsing, markdown extraction
│   └── curator.ts         # Auto-generation logic (meta-prompt extraction)
smarts/                    # Default SMARTS directory (project root)
│   └── (auto-generated and user-authored .md files)
tests/
├── unit/
│   ├── smarts-store.test.ts
│   ├── smarts-parser.test.ts
│   └── smarts-curator.test.ts
```

## Testing Strategy

- **SmartsStore tests**: Parse frontmatter, index files, FTS5 queries, create/update SMARTS, re-index, token budget enforcement
- **Cortex integration tests**: Verify enriched prompt assembly, pinning behavior, empty SMARTS directory handling
- **Protocol tests**: Each `/smart` subcommand, error cases, unknown commands
- **Curator tests**: Mock conversation history, verify extraction prompt, verify file writes, non-blocking behavior
- **All tests use**: `injectedProvider` stubs (existing pattern), temp directories with test `.md` files, cleanup in `afterEach`

## Configuration

New fields on `RuntimeConfig`:

```typescript
interface RuntimeConfig extends Partial<FridayConfig> {
  modulesDir?: string;
  smartsDir?: string;           // Default: "./smarts"
  smartsTokenBudget?: number;   // Default: 24000
  smartsMaxPerMessage?: number; // Default: 5
  smartsMinConfidence?: number; // Default: 0.5
  injectedProvider?: LLMProvider;
}
```

## Open Questions (for implementation)

1. Should SMARTS files use `.smarts.md` extension to distinguish from regular markdown? (Leaning no — `.md` is cleaner)
2. Should the `smarts/` directory be gitignored (auto-generated only) or tracked (mixed)? (Leaning tracked — version control is a feature)
3. Frontmatter parsing: use a library (gray-matter) or hand-roll? (Decide during implementation based on Bun compatibility)
