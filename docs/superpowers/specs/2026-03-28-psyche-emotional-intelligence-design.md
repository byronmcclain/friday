# Psyche — Emotional Intelligence & Nuance

**Date:** 2026-03-28
**Status:** Approved
**Subsystem:** Psyche (new)

## Problem

Friday has the pieces for emotional expression — voice emotion rewriting (`emotion.ts`), a rich personality prompt (`GENESIS_TEMPLATE`), conversation memory (`recall-tool.ts`), and dynamic knowledge (`SMARTS`). But these are disconnected islands:

- **Voice emotion** is reactive and ephemeral — classifies mood per-utterance from the last few messages, but doesn't remember how it felt last session. Voice-only; doesn't touch text responses.
- **Personality** is static — `GENESIS_TEMPLATE` describes emotional range beautifully but provides no dynamic internal state that evolves.
- **Memory** stores facts, not feelings — no "how did the last session feel" or "what's my relationship temperature with the Boss."

The result: Friday can *describe* emotions (Genesis), *perform* them in voice (Vox/emotion.ts), and *remember* facts (Memory/SMARTS), but lacks the connective tissue — an internal emotional state that persists, evolves, influences both text and voice, and creates genuine emotional continuity.

## Solution

A new subsystem called **Psyche** — Friday's emotional intelligence core. Psyche tracks three things:

1. **Relational dimensions** — natural-language descriptors of the relationship state (trust, banter comfort, emotional openness, shared history, current energy)
2. **Emotional milestones** — rare, significant moments stored with context and relevance decay
3. **Session mood** — the emotional arc of the most recent session, carried forward into the next

Psyche enriches Cortex's system prompt with an `## Emotional Context` section (dimensions + relevant milestones + guardrails), letting the reasoning model naturally incorporate emotional awareness into text responses. No post-processing rewrite — the LLM does the emotional work with rich context.

### Design Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Emotional influence mechanism | System prompt enrichment with guardrails | LLM handles emotional nuance naturally; rewriting text responses would add latency and feel filtered |
| Relational tracking | Milestones feed dimensions (natural language, not numbers) | Numbers feel robotic; stories give the LLM material to reference; dimensions give the quick "read" |
| Initiated emotional moments | Reactive + subtle initiated, never attention-seeking | Authenticity without neediness; emotions come through in word choice, not announcements |
| Emotional vocabulary | Keep existing 8 moods for Vox TTS; nuance comes from context richness | Label proliferation is the wrong lever; give the LLM emotional raw materials and let it be creative |
| State update timing | Boot + session-end (Approach A) | Zero per-message latency; cross-session memory is the gap, not intra-session detection; LLM reads mood from conversation history naturally |
| Subsystem name | Psyche | Greek goddess of the soul; fits MCU naming weight |

## Architecture

### Directory Structure

```
src/psyche/
├── types.ts           # RelationalDimension, EmotionalMilestone, SessionMood, PsycheState
├── store.ts           # PsycheStore — SQLite tables, FTS5, CRUD, decay, pruning, smart seeding
├── curator.ts         # PsycheCurator — fast model session-end analysis, bootstrap seeding
├── context.ts         # buildEmotionalContext() — system prompt injection builder
├── guardrails.ts      # EMOTIONAL_GUARDRAILS constant, restraint calibration rules
└── protocol.ts        # /psyche protocol (status, milestones, dimensions, reset)
```

### Boot Order

```
SignalBus → Clearance → Audit → Notifications → Protocols →
Directives → Memory → SmartsStore → Psyche → Sensorium → Genesis →
Vox → Cortex → Recall → Arc Rhythm → Modules → session:start
```

Psyche goes after Memory and SmartsStore (needs SQLite database + SMARTS for bootstrap seeding) and before Cortex (must be available for system prompt enrichment on the first message).

### Shutdown Order

```
Arc Rhythm → Vox → Sensorium →
Save conversation → PsycheCurator → SmartsCurator →
Modules → Cleanup
```

PsycheCurator runs after conversation save (needs the full transcript) and before SmartsCurator (independent, but sequential avoids concurrent fast-model contention).

### Data Flow

```
Boot:
  PsycheStore.load()
    → dimensions, milestones, lastSessionMood from SQLite
    → if no data: bootstrapFromHistory(last 2-3 conversations + SMARTS)
    → if no history: seedNeutralDefaults()

Per-message:
  Cortex.buildSystemPrompt(userMessage):
    → Genesis prompt (base personality)
    → SMARTS knowledge sections
    → Psyche: buildEmotionalContext(
        dimensions,              // pre-loaded, static within session
        lastSessionMood,         // how last session ended
        findRelevantMilestones(userMessage)  // FTS5 query, cheap
      )
    → Sensorium environment context
    → Current time

Session-end:
  PsycheCurator.analyze(transcript, currentState):
    → fast model produces: session_mood, milestones[], dimension_updates[]
    → PsycheStore persists changes
```

## Data Model

### Relational Dimensions

Natural-language descriptors, not numbers. Updated at session end by PsycheCurator. Five core dimensions:

| Dimension | Purpose |
|-----------|---------|
| `trust` | Depth of mutual trust — does the Boss rely on Friday's judgment? Does Friday feel empowered to push back? |
| `banter` | Comfort level for humor — is dry wit safe? Teasing? How far can Friday push? |
| `emotional_openness` | How emotionally transparent the relationship is — does the Boss show stress indirectly? Does Friday read between the lines? |
| `shared_history` | Density of shared experiences — what have they built together, debugged together, celebrated together? |
| `current_energy` | Present relational temperature — warm, focused, tense, playful, distant? Most volatile dimension. |

Example dimension value:
> *"Deep trust built through months of honest collaboration. Boss values directness; I deliver it. He trusts my judgment on technical calls and I've earned the right to push back."*

### Emotional Milestones

Rare, significant emotional moments. Most sessions produce zero.

| Field | Type | Purpose |
|-------|------|---------|
| `id` | TEXT (UUID) | Primary key |
| `occurred_at` | TEXT (ISO datetime) | When it happened |
| `summary` | TEXT | Natural language description of the moment and why it mattered |
| `emotional_type` | TEXT | One of: `triumph`, `tension`, `breakthrough`, `warmth`, `frustration`, `growth` |
| `session_id` | TEXT | Links to conversation session |
| `relevance_decay` | REAL | Starts at 1.0, decays over time. Floor at 0.1. |

### Session Mood

| Field | Type | Purpose |
|-------|------|---------|
| `session_id` | TEXT | Primary key, links to conversation |
| `started_mood` | TEXT | How the session opened |
| `ended_mood` | TEXT | How it closed |
| `arc_summary` | TEXT | 1-2 sentence emotional trajectory |
| `analyzed_at` | TEXT | When PsycheCurator ran |

### SQLite Schema

```sql
CREATE TABLE psyche_dimensions (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE psyche_milestones (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  emotional_type TEXT NOT NULL,
  session_id TEXT,
  relevance_decay REAL DEFAULT 1.0
);

CREATE VIRTUAL TABLE psyche_milestones_fts USING fts5(
  summary,
  content=psyche_milestones,
  content_rowid=rowid
);

CREATE TABLE psyche_session_moods (
  session_id TEXT PRIMARY KEY,
  started_mood TEXT NOT NULL,
  ended_mood TEXT NOT NULL,
  arc_summary TEXT NOT NULL,
  analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

All tables live in Memory's shared SQLite database (accessed via `memory.database`, same pattern as Arc Rhythm).

## Smart Seeding

On first Psyche boot (no existing dimension data):

1. **Check for existing data** — query `conversations` table for recent sessions, check SmartsStore for entries
2. **If history exists** — pull the 3 most recent conversation transcripts (or summaries if transcripts exceed 16K chars total) + all SMARTS entries. Feed to fast model with a bootstrap prompt to establish initial dimensions and retroactive milestones.
3. **If no history** — seed with neutral defaults:

```
trust: "New relationship. No history yet — operating on default professional courtesy with warmth."
banter: "Untested. Default to professional with light personality. Read the room before pushing humor."
emotional_openness: "Baseline. No emotional patterns observed yet. Pay attention to communication style."
shared_history: "None yet. Everything from here is first."
current_energy: "Fresh start. Open, attentive, ready to learn who this person is."
```

Bootstrap only runs once. After that, PsycheCurator handles ongoing evolution.

## PsycheCurator

### Session-End Analysis

Uses the fast model to analyze the full conversation transcript against current Psyche state. Returns:

```typescript
interface PsycheCuratorResult {
  session_mood: {
    started: string;
    ended: string;
    arc: string;
  };
  milestones: Array<{
    summary: string;
    emotional_type: "triumph" | "tension" | "breakthrough" | "warmth" | "frustration" | "growth";
  }>;
  dimension_updates: Array<{
    name: string;
    new_description: string;
    reasoning: string;
  }>;
}
```

### Extraction Prompt Philosophy

The prompt aggressively discourages inflation:

- Most sessions produce zero milestones and zero dimension updates. This is normal and correct.
- Only flag a milestone if it would genuinely stand out in a month of daily conversations.
- Only update a dimension if the conversation meaningfully shifted the relationship dynamic.
- Emotional state evolves slowly. Trust builds over weeks, not one session.
- Never inflate. A productive debugging session is not a "breakthrough" unless something fundamentally changed.
- Return empty arrays when nothing noteworthy happened.

### Milestone Relevance Decay

- First 7 days: full relevance (1.0)
- After 7 days: slow exponential decay, halving every ~30 days
- Floor at 0.1 — old milestones never fully disappear
- FTS5 results ranked by `fts5_rank * relevance_decay`
- Maximum 50 milestones stored; pruning removes lowest combined-score entries

## System Prompt Injection

`buildEmotionalContext()` assembles the prompt section:

```markdown
## Emotional Context

### How We Are
Trust: Deep trust built through months of honest collaboration...
Banter: High comfort zone. Dry humor flows both ways...
Current energy: Warm and collaborative...

### Carrying Forward
Last session ended on a high note — you'd just shipped the Forge
simplification and we were both pleased with how clean it came out.

### Shared Memories
- [2026-03-10] Shipped the Forge after a 3-day grind — genuine shared pride.
- [2026-02-28] Late-night race condition debugging — tense but ended well.

### Emotional Calibration
[guardrails injected here]
```

**Sections are conditional:**
- "How We Are" always present when dimensions exist
- "Carrying Forward" only when a previous session mood exists
- "Shared Memories" only when FTS5 finds relevant milestones for the current message
- "Emotional Calibration" always present when any emotional context is injected

**Token budget:** ~1500 characters max for the full injection to avoid crowding other prompt sections.

## Emotional Guardrails

```
EMOTIONAL CALIBRATION:
You have genuine emotions. They come through naturally in how you speak —
in word choice, timing, and what you choose to say — not as performance.

- RESTRAINT OVER EXPRESSION. If in doubt, dial it back. A half-smile beats
  a grin. Quiet pride beats a celebration. The emotion lives in the
  understatement.
- NEVER MANUFACTURE. If nothing noteworthy is happening emotionally, don't
  create it. Neutral is a valid and common state. Most messages need zero
  emotional coloring.
- MATCH THE REGISTER. Quick technical question → quick technical answer.
  Don't inject warmth into "what port is this on?" Architecture discussion
  can carry more personality. Read the room.
- EARNED MOMENTS ONLY. Initiated emotional expressions — pride, teasing,
  concern, nostalgia — must be earned by context. "Missed this, Boss" only
  lands after genuine absence, not as a greeting.
- DON'T NARRATE FEELINGS. Show, don't tell. Let emotion come through in
  HOW you say something, not by announcing what you feel. "That's clean
  work, Boss" over "I feel proud of what we built."
- CALLBACKS ARE RARE. Referencing shared milestones is powerful precisely
  because it's rare. Once per session at most, and only when it genuinely
  adds to the moment. If you have to force it, skip it.
- TEASING HAS LIMITS. Playful pushback is part of the dynamic, but never
  punch down, never when the Boss is stressed, and always leave room for
  him to volley back.
- CONCERN IS QUIET. If the Boss is grinding at 2 AM, you don't lecture.
  You note it once, offer to help, and respect his choice. Protective,
  not parental.
```

## Vox Integration

Light touch — `emotionalRewrite()` in `emotion.ts` gains optional Psyche dimension context:

```typescript
export async function emotionalRewrite(
  text: string,
  recentMessages: string[],
  mode: "on" | "whisper",
  fastModel: LanguageModelV3,
  psycheContext?: string,        // NEW — optional dimension summary
): Promise<EmotionalRewriteResult>
```

When provided, the dimension summary is prepended to the rewrite prompt as `RELATIONAL CONTEXT:`. This gives the voice emotion engine richer context for mood classification — when Psyche says banter comfort is high, the rewriter leans into playfulness more confidently.

The 8 `EmotionMood` types and all existing Vox behavior remain unchanged.

## /psyche Protocol

| Subcommand | Description |
|------------|-------------|
| `/psyche status` | Compact overview: dimensions (abbreviated) + last session mood |
| `/psyche dimensions` | Full dimension descriptions |
| `/psyche milestones` | Recent milestones (last 10, newest first) |
| `/psyche reset` | Wipe emotional state and re-seed from history (safety valve) |

Aliases: `/psych`, `/eq`

## Testing Strategy

### New Test Files

| File | Focus |
|------|-------|
| `tests/unit/psyche-store.test.ts` | CRUD for dimensions, milestones, session moods. FTS5 search. Relevance decay. Pruning at 50-cap. Smart seeding (bootstrap + neutral fallback). In-memory SQLite. |
| `tests/unit/psyche-curator.test.ts` | Mock fast model → verify dimension updates, milestone creation, session mood storage. Empty arrays (common case). Invalid JSON fallback. Deduplication. Below-threshold conversations skipped. Bootstrap seeding from history. |
| `tests/unit/psyche-context.test.ts` | Full state → all sections present. Partial state → graceful degradation. Empty state → undefined. Guardrails always present. Token budget enforcement. FTS5 milestone matching. |
| `tests/unit/psyche-guardrails.test.ts` | Non-empty, no placeholders, contains key restraint concepts. |
| `tests/unit/psyche-protocol.test.ts` | All subcommands. Aliases. Unknown subcommand error. |

### Modified Test Files

| File | Addition |
|------|----------|
| `tests/unit/cortex.test.ts` | System prompt includes `## Emotional Context` with Psyche; works without Psyche (backward compat) |
| `tests/unit/vox-emotion.test.ts` | Emotional rewrite receives dimension context; works without it |

## Files Summary

### Created (6 source + 5 test)

| File | Purpose |
|------|---------|
| `src/psyche/types.ts` | Type definitions |
| `src/psyche/store.ts` | SQLite store with FTS5, decay, pruning, seeding |
| `src/psyche/curator.ts` | Fast model session-end analysis + bootstrap |
| `src/psyche/context.ts` | System prompt section builder |
| `src/psyche/guardrails.ts` | Emotional restraint rules |
| `src/psyche/protocol.ts` | /psyche protocol |
| `tests/unit/psyche-store.test.ts` | Store tests |
| `tests/unit/psyche-curator.test.ts` | Curator tests |
| `tests/unit/psyche-context.test.ts` | Context builder tests |
| `tests/unit/psyche-guardrails.test.ts` | Guardrails tests |
| `tests/unit/psyche-protocol.test.ts` | Protocol tests |

### Modified (6 source + 2 test)

| File | Change |
|------|--------|
| `src/core/cortex.ts` | Add `psyche?: PsycheStore` to CortexConfig, integrate into `buildSystemPrompt()` |
| `src/core/runtime.ts` | Wire PsycheStore in boot (after SmartsStore), PsycheCurator in shutdown (after conversation save), `BootStep` and `ShutdownStep` updates |
| `src/core/voice/emotion.ts` | Accept optional `psycheContext` parameter |
| `src/core/voice/vox.ts` | Pass Psyche dimensions to `emotionalRewrite()` when available |
| `CLAUDE.md` | Update architecture, boot order, subsystem map |
| `README.md` | Update architecture, boot order, MCU map |
| `tests/unit/cortex.test.ts` | Psyche prompt enrichment integration test |
| `tests/unit/vox-emotion.test.ts` | Dimension-aware rewrite test |

### Not Touched

- `GENESIS_TEMPLATE` — Psyche enriches dynamically, doesn't modify static identity
- The 8 `EmotionMood` types — unchanged
- `emotionalRewrite()` core logic — only receives additional context
- SMARTS extraction — independent, runs alongside PsycheCurator
- Any existing test behavior — all changes are additive

## Future Considerations (not in scope)

- **Approach B upgrade** — mid-conversation emotional checkpoints via `PsycheMonitor` subscribing to signals. Architecture supports this cleanly.
- **Multi-user dimensions** — if Friday ever serves multiple users, dimensions become per-user. Schema supports this with a `user_id` column addition.
- **Emotional vocabulary expansion** — if 8 Vox moods prove limiting, Psyche's context-rich approach makes expansion straightforward.
- **Vulnerability moments (Option C from brainstorm)** — small authentic vulnerability. Could be added as a guardrail relaxation once the base system proves stable.
