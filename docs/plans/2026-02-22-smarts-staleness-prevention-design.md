# SMARTS Staleness Prevention Design

## Problem

The SmartsCurator extracts knowledge from conversations on shutdown. Some of this "knowledge" captures volatile system state (tool inventories, module lists, capability counts) that becomes stale when code changes. Stale entries are injected into the system prompt via FTS5 matching, causing the LLM to report incorrect information. The LLM's incorrect responses are then re-extracted by the curator on the next shutdown — creating a self-reinforcing feedback loop.

Additionally, the curator's LLM-based deduplication is weak — it creates near-duplicate entries with slightly different names across sessions (`friday-toolkit-current` vs `friday-current-toolkit` vs `friday-current-tools`), all containing the same stale data.

## Solution

Two complementary mechanisms:

1. **Volatile extraction prevention** — stop the curator from extracting system state in the first place
2. **Session-based TTL** — auto-expire old entries so stale data that does get created has a limited lifespan

### 1. Volatile Extraction Prevention

**Prompt exclusion**: Add explicit exclusions to the curator's extraction prompt telling it not to extract enumerations of the system's own state (tool lists, module inventories, capability counts).

**Post-extraction filter**: After the LLM returns extracted entries, programmatically reject entries whose content matches volatile patterns via regex. This is the safety net — the prompt is the primary defense, the filter catches what slips through.

Volatile patterns:
- `\b\d+\s+tools?\b` — "11 tools", "29 tools"
- `\btool(?:s|kit)\s*\(` — "Tools (11)", "Toolkit (Current)"
- `\bcurrent.*(?:tools|modules)` — "Current Friday Toolkit"
- `\bvisible\s+tools` — "Visible Tools"
- `\blive\s+tools` — "Live Tools"

### 2. Session-Based TTL

Each SMART entry gets a `sessionId` field tracking which session created or last refreshed it. A global session counter (persisted in SQLite KV) increments on every boot. Entries older than 5 sessions are pruned from disk during boot, before FTS5 indexing.

**TTL rules:**
- `source: "manual"` — never expires (user-curated knowledge)
- `source: "conversation"` or `"auto"` — expires when `currentSession - sessionId > 5`
- Legacy entries (no `sessionId`) get stamped with the current session on first boot after migration

**Why session-count, not calendar time**: Ties freshness to actual usage. If the user is away for a week, knowledge doesn't expire. If they run 10 rapid sessions, stale data cleans out quickly.

## Data Model Changes

### SmartEntry

```typescript
interface SmartEntry {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  source: SmartSource;    // "manual" | "auto" | "conversation"
  sessionId?: number;     // NEW — session when created/last updated
  content: string;
  filePath: string;
}
```

### Frontmatter

```yaml
---
name: "friday-env-specs"
domain: "project-context"
tags: ["hardware", "m3-max"]
confidence: 0.7
source: "conversation"
session_id: 42
created: 2026-02-23
updated: 2026-02-23
---
```

### Session Counter

Stored in SQLite via `memory.set("smarts", "session-counter", N)`. Incremented on every `SmartsStore.initialize()` call.

## Boot Sequence (SmartsStore.initialize)

1. **Read and increment session counter** from SQLite KV
2. **Scan `.md` files** — parse frontmatter only (lightweight, no FTS5)
3. **Stamp legacy entries** — files with no `sessionId` get stamped with current session (one-time migration)
4. **Prune expired entries** — delete files from disk where `source !== "manual"` and `currentSession - sessionId > 5`
5. **Proceed to `scanAndIndex()`** — only surviving files get FTS5-indexed

Pruning happens at the file level — expired entries are deleted from disk, not just filtered at query time. This prevents the feedback loop.

## Curator Changes

### Extraction Prompt

Add to the "DO NOT extract" section:

```
- Enumerations of the system's own state: tool inventories, module lists,
  capability counts, component catalogs, or "what tools does Friday have" summaries.
  These are defined in code and change with every deploy — they are not knowledge.
- Lists that are just restating what the API tool definitions already provide
```

### Post-Extraction Filter

After `parseResponse()`, before persisting, reject entries matching volatile patterns:

```typescript
const VOLATILE_PATTERNS = [
  /\b\d+\s+tools?\b/i,
  /\btool(?:s|kit)\s*\(/i,
  /\bcurrent.*(?:tools|modules)/i,
  /\bvisible\s+tools/i,
  /\blive\s+tools/i,
];
```

### Session Stamping

The curator receives the current session counter from the store. On `create()` and `update()`, entries are stamped with `sessionId: currentSession`. Re-extracted knowledge gets its freshness renewed.

## Files Changed

- `src/smarts/types.ts` — add `sessionId?: number` to SmartEntry
- `src/smarts/parser.ts` — parse/serialize `session_id` frontmatter field
- `src/smarts/store.ts` — session counter management, boot-time pruning, pass session to curator
- `src/smarts/curator.ts` — prompt exclusions, volatile pattern filter, session stamping
- `tests/unit/smarts-*.test.ts` — tests for TTL pruning, volatile filter, session stamping

## What This Does NOT Address

- **Deduplication** — the weak dedup (LLM creating similar-named entries) is partially solved by TTL (old dupes expire) and partially by the volatile filter (the worst offenders are system state dupes). A full semantic dedup system is out of scope.
- **Manual entry management** — no changes to `/smart` protocol or manual CRUD workflows.
