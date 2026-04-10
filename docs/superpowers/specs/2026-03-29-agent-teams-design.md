# Agent Teams — Development Team Orchestration via OpenCode

**Date:** 2026-03-29
**Status:** Approved
**MCU Codename:** The Avengers Initiative

## Overview

Friday gains the ability to assemble and manage teams of autonomous OpenCode agents to build software. She acts as Project Manager / Product Owner — decomposing projects into tasks, dispatching agents, monitoring progress, handling failures, and merging results. BOSS sees everything via a full-screen Kanban board in the TUI.

### Core Principles

- **Supervised autonomy** — Friday proposes a task breakdown; BOSS approves before agents are dispatched. BOSS can intervene at any time via the TUI board or chat.
- **On-demand agents** — OpenCode instances are spawned per-task and torn down when done. No idle resources. The `AgentPool` abstraction supports a future swap to persistent pools without rewriting consumers.
- **Kanban with WIP limits** — Tasks flow through columns (Backlog → In Progress → In Review → Done → Failed). Friday manages ordering via her understanding of task dependencies. No formal DAG — fuzzy dependency tracking via `requires`/`produces` fields.
- **Uniform agents, task-typed roles** — All agents are identical. The task carries role context (dev prompt vs QA prompt). Any agent can do any work.
- **Tiered failure handling** — Minor failures (lint, test) auto-retry with feedback. Major failures (wrong approach, scope confusion) escalate to BOSS. Circuit breaker after N consecutive failures.
- **Worktree-per-task isolation** — Each task gets its own git worktree and branch. Agents can't step on each other. Merges are serialized through a queue.

## Architecture

### Subsystem Placement

Core subsystem in `src/teams/`, on par with Arc Rhythm, Sensorium, SMARTS, Psyche.

**Boot order:**
```
...Cortex → Recall → Arc Rhythm → Teams → Modules → session:start
```

Teams boots after Arc Rhythm (can use scheduling) and before Modules (Forge can dispatch work to teams).

### File Layout

```
src/teams/
├── types.ts              # Team, TeamTask, AgentHandle, KanbanColumn, signals, constants
├── store.ts              # TeamStore — SQLite CRUD for teams + tasks + agents
├── pool.ts               # AgentPool — OpenCode lifecycle (spawn, connect, monitor, teardown)
├── scheduler.ts          # TeamScheduler — watches board, dispatches tasks, manages flow
├── reviewer.ts           # TeamReviewer — post-task validation, failure classification, merge orchestration
├── protocol.ts           # /team protocol (create, list, board, assign, pause, resume, cancel, status)
├── tool.ts               # manage_team FridayTool for Cortex (LLM-facing)
└── planner.ts            # TaskPlanner — decomposes project descriptions into task cards via Cortex
```

### TUI Components

```
src/cli/tui/components/board/
├── Board.tsx              # Full-screen board container, column layout
├── BoardHeader.tsx        # Team name, status, keybinding hints
├── BoardColumn.tsx        # Single Kanban column with task list
├── TaskCard.tsx           # Individual task card rendering
├── TaskDetail.tsx         # Expanded detail panel (bottom)
├── TeamBadge.tsx          # Header badge component (for Header.tsx)
└── board-state.ts         # Board-specific state (selection, expanded task, active team)
```

## Data Model

### Team

```typescript
interface Team {
  id: string;                    // UUID
  name: string;                  // "auth-module"
  description: string;           // What this team is building
  status: TeamStatus;            // idle | planning | active | paused | completed | failed
  createdAt: Date;
  updatedAt: Date;
  wipLimit: number;              // Max concurrent "In Progress" tasks (default: 3)
  settings: TeamSettings;
}

type TeamStatus = "idle" | "planning" | "active" | "paused" | "completed" | "failed";

interface TeamSettings {
  maxRetries: number;            // Auto-retry limit before escalate (default: 2)
  autoMerge: boolean;            // Allow agents to self-merge clean merges (default: true)
  baseBranch: string;            // Branch to create worktrees from (default: current HEAD)
}
```

### TeamTask

```typescript
interface TeamTask {
  id: string;                    // UUID
  teamId: string;                // FK to Team
  title: string;                 // "Build JWT auth middleware"
  description: string;           // Full prompt/instructions for the agent
  column: KanbanColumn;          // Where it sits on the board
  priority: number;              // Lower = higher priority within column
  agentId: string | null;        // Assigned agent (null = unassigned)
  requires: string[];            // What inputs this task needs (human-readable)
  produces: string[];            // What outputs this task creates (human-readable)
  retryCount: number;            // How many times retried
  worktreePath: string | null;   // Git worktree path when in progress
  result: TaskResult | null;     // Output from agent when complete
  failureReason: string | null;  // Why it failed (if failed)
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

type KanbanColumn = "backlog" | "in-progress" | "in-review" | "done" | "failed";

interface TaskResult {
  summary: string;               // Agent's summary of what it did
  filesChanged: string[];        // List of modified files
  commitHash: string | null;     // Merge commit if auto-merged
  testsPassed: boolean | null;   // Post-merge test result
}
```

### AgentHandle

```typescript
interface AgentHandle {
  id: string;                    // UUID
  teamId: string;                // Which team it's working for
  taskId: string;                // Current task
  sessionId: string;             // OpenCode session ID
  serverPort: number;            // OpenCode server port
  serverPid: number;             // OS process ID
  status: AgentStatus;           // spawning | working | merging | idle | failed | stopped
  spawnedAt: Date;
  lastActivityAt: Date;
}

type AgentStatus = "spawning" | "working" | "merging" | "idle" | "failed" | "stopped";
```

### Kanban State Machine

Valid transitions:

```
backlog → in-progress      (agent assigned, work begins)
in-progress → in-review    (agent completes, awaiting merge/validation)
in-progress → failed       (agent fails, retry limit exceeded)
in-review → done           (merge + tests pass)
in-review → in-progress    (review failed, re-dispatched)
in-review → failed         (merge conflicts escalated, BOSS decides to abort)
failed → backlog           (BOSS or Friday requeues after fixing the issue)
```

### Fuzzy Dependency Tracking

`requires` and `produces` are human-readable strings, not task IDs. Friday uses semantic understanding to infer ordering:

- Before moving a backlog task to in-progress, Friday checks: does any `in-progress` or `backlog` task `produce` something this task `requires`?
- If yes, hold the task in backlog until the dependency is in `done`.
- This is LLM-powered judgment (Phase 5), not graph traversal. In earlier phases, ordering is manual via priority field.

## OpenCode Integration

### AgentPool Lifecycle

```
spawn(teamId, taskId):
  → Pick available port (scan from 14096 upward)
  → Create git worktree: git worktree add .worktrees/teams/{teamId}/{taskId} -b friday/{teamId}/{taskId}
  → Spawn child process: opencode serve --port {port} in worktree directory
  → Wait for health check: GET http://localhost:{port}/global/health
  → Connect SDK client: createOpencodeClient({ baseUrl })
  → Create session: client.session.create({ title: task.title })
  → Return AgentHandle

teardown(agentHandle):
  → client.session.abort() (stop in-flight work)
  → Kill child process (SIGTERM, then SIGKILL after 5s)
  → Clean up worktree (only if merged or failed — preserve on success for review)
  → Update AgentHandle status → "stopped"
```

### Agent Prompt Construction

```
You are working on task "{task.title}" for project "{team.name}".

## Your Task
{task.description}

## Context
- Working directory: {worktreePath}
- Base branch: {team.settings.baseBranch}
- You are working in an isolated git worktree

## What You Need (inputs)
{task.requires joined}

## What You Must Produce (outputs)
{task.produces joined}

## Rules
- Commit your work with clear, descriptive commit messages
- Run tests before marking complete
- Do not modify files outside the scope of this task
- If you encounter a blocker, describe it clearly in your final message
```

### SSE Event Monitoring

Each dispatched agent gets an SSE listener on `http://localhost:{port}/event`. Events update `AgentHandle.lastActivityAt` and detect completion.

### Stall & Crash Detection

- **Stall:** No SSE events for `AGENT_STALL_TIMEOUT` (default: 5 min) → health check → nudge prompt or treat as crash
- **Crash:** Child process exit event → task marked with failure reason → TeamReviewer classifies severity and decides retry vs escalate
- **Resource guard:** Maximum `MAX_CONCURRENT_AGENTS` (default: 5) concurrent agents. Pool queues spawn requests beyond limit.

### Port Management

`PortAllocator` tracks allocated ports starting from 14096. Ports released on agent teardown.

## Git Workflow

### Worktree Layout

```
.worktrees/teams/
└── {teamId}/
    ├── {taskId-1}/    ← branch: friday/{teamId}/{taskId-1}
    ├── {taskId-2}/    ← branch: friday/{teamId}/{taskId-2}
    └── {taskId-3}/    ← branch: friday/{teamId}/{taskId-3}
```

### Tiered Merge Strategy

When a task completes and moves to `in-review`:

1. **Validate:** Did the agent commit? Do tests pass in the worktree?
2. **Attempt merge:** `git merge --no-ff friday/{teamId}/{taskId}` into base branch
3. **Classify result:**
   - **Clean (no conflicts):** Run tests on merged result. Pass → Done. Fail → revert, classify as minor failure.
   - **Simple conflict (auto-resolvable):** Send conflict context back to agent session. Agent resolves → test → Done. Can't resolve → escalate.
   - **Complex conflict (overlapping changes):** Revert merge. Build decision summary for BOSS. Task → failed with escalation flag. BOSS picks direction. Friday creates reconciliation task.

### Serial Merge Queue

Only one merge at a time against the base branch. Tasks complete in parallel, merges serialize. Prevents race conditions where two agents' merges see different base states.

### Worktree Cleanup

- **Done (merged):** Keep 1 hour for inspection, then `git worktree remove` + `git branch -d`
- **Failed (not retrying):** Keep indefinitely for debugging. `/team cleanup` removes manually.
- **Team completed:** Clean up all remaining worktrees and branches. Keep team record in SQLite.

### Conflict Escalation UX

Complex conflicts surface to BOSS as a decision:

```
FRIDAY: Merge conflict on auth-module between two completed tasks.

  Task "API routes" changed src/auth/handler.ts:
    → Added session-based login with cookie storage

  Task "DB schema" changed src/auth/handler.ts:
    → Added JWT validation middleware

  These overlap in the auth handler. Options:
  [1] Keep API routes approach (rewrite other task)
  [2] Keep DB schema approach (rewrite other task)
  [3] Open both diffs in $EDITOR

  Which direction?
```

BOSS picks a direction. Friday creates a reconciliation task and dispatches to an agent.

## TUI

### Header Badge

Lives in existing `Header` component, top-right. Only renders when teams are active.

```
[● 2 agents · 3/5 tasks · ^B]
```

- Green dot `●` pulses when agents working (reuses `usePulse` hook)
- Amber dot when paused
- Red dot / `⚠` when escalation pending (badge flashes)
- `^B` = Ctrl+B hotkey hint

### Full-Screen Board

Toggled by Ctrl+B. Replaces chat view entirely. ESC returns to chat.

**Layout:**
- Top: Board header — team name, status, keybinding hints
- Sub-header: Summary bar — agent count, WIP status, progress, elapsed time
- Main: 5 Kanban columns side by side (Backlog, In Progress, In Review, Done, Failed)
- Bottom: Task detail panel (expands on Enter)

**Task Cards show:**
- Title
- `requires`/`produces` fields
- Assigned agent (with green pulse indicator)
- Elapsed time
- Mini progress bar (for in-progress tasks)

**Keyboard Navigation (vim-style):**

| Key | Action |
|-----|--------|
| `j/k` | Move selection up/down within column |
| `h/l` | Move selection between columns |
| `Enter` | Expand task detail panel |
| `ESC` | Return to chat view |
| `p` | Pause/resume selected task or team |
| `r` | Retry failed task |
| `d` | View diff for completed/in-review task |
| `?` | Help overlay |
| `/` | Filter tasks |
| `Tab` | Switch between teams (if multiple) |

### ViewMode Integration

```typescript
type ViewMode = "chat" | "board";
// FridayApp state gains viewMode field
// Ctrl+B toggles between them
// Board view renders <Board /> instead of <ChatArea /> + <InputBar />
```

## Protocol & Tool Surface

### `/team` Protocol

Aliases: `/teams`, `/squad`

| Command | Description |
|---------|-------------|
| `/team create <name> "<description>"` | Create team. Friday decomposes into tasks, presents for approval. |
| `/team list` | List all teams with status |
| `/team board [name]` | Open board view (same as Ctrl+B) |
| `/team status <name>` | Detailed status — agents, tasks, elapsed, escalations |
| `/team pause <name>` | Pause team — stop dispatching, in-progress agents finish |
| `/team resume <name>` | Resume paused team |
| `/team cancel <name>` | Cancel team — abort agents, clean worktrees, mark failed |
| `/team retry <name> <taskId>` | Requeue failed task to backlog |
| `/team add <name> "<task description>"` | Add task to existing team's backlog |
| `/team remove <name> <taskId>` | Remove task from backlog (not if in-progress) |
| `/team cleanup <name>` | Remove worktrees/branches for completed/failed team |
| `/team history` | Show completed teams and results |

### `manage_team` Tool (Cortex-facing)

Registered with Cortex for conversational project initiation and Friday self-initiated work.

```typescript
{
  name: "manage_team",
  description: "Create and manage development teams of AI agents to build software.",
  parameters: [
    { name: "action", type: "string", required: true,
      description: "create | status | pause | resume | cancel | add-task" },
    { name: "name", type: "string", required: true,
      description: "Team name (kebab-case)" },
    { name: "description", type: "string", required: false,
      description: "Project description (for create)" },
    { name: "taskDescription", type: "string", required: false,
      description: "Task description (for add-task)" },
  ],
  clearance: ["team-manage"],
}
```

### Conversational Flow

BOSS describes a project in natural language → Cortex recognizes project-scale request → calls `manage_team` with `action: "create"` → TaskPlanner decomposes → Friday presents plan → BOSS approves → agents dispatch.

### Clearance

New clearance type: `"team-manage"` — gates team creation, agent spawning, task dispatch. Added to `ClearanceName` union. Individual agents inherit clearance from team settings.

## Notification & Escalation

### Event Tiers

| Tier | Events | Behavior |
|------|--------|----------|
| **Silent** | task dispatched, agent spawned/stopped, task → in-review | Header badge update only |
| **Informational** | task completed & merged, team completed, team auto-paused | Inline chat card + badge + Vox acknowledgment |
| **Attention** | merge conflict, major failure, approval needed | Chat card with action required + badge flashes + Vox alert + push to all channels |

### Integration with NotificationManager

Team events flow through the existing `notifications.notify()` pipeline. No new channels needed — TuiChannel, VoiceChannel, PushNotificationChannel, SlackChannel all handle routing automatically.

### Signal-to-Notification Mapping

```typescript
const SIGNAL_TIERS: Record<string, "silent" | "info" | "attention"> = {
  "custom:agent-spawned":    "silent",
  "custom:agent-stopped":    "silent",
  "custom:task-dispatched":  "silent",
  "custom:task-completed":   "info",
  "custom:team-completed":   "info",
  "custom:task-failed":      "attention",
  "custom:task-escalated":   "attention",
  "custom:merge-conflict":   "attention",
  "custom:team-failed":      "attention",
};
```

### Dual Transport

Team signals must be wired through both WebSocket (`handler.ts`) and Unix socket (`socket.ts`). The signal bus already handles this — both transports subscribe to signals. Verify both paths carry `custom:team-*` signals during implementation.

## Signals

```typescript
type TeamSignals =
  | "custom:team-created"
  | "custom:team-completed"
  | "custom:team-failed"
  | "custom:task-dispatched"
  | "custom:task-completed"
  | "custom:task-failed"
  | "custom:task-escalated"
  | "custom:agent-spawned"
  | "custom:agent-stopped"
  | "custom:merge-conflict";
```

## Implementation Phases

### Phase 1: Core Engine (Foundation)

**Delivers:** types, TeamStore (SQLite), TeamScheduler skeleton, `/team` protocol (all 12 subcommands), `manage_team` tool, boot integration, `"team-manage"` clearance, signals, full test suite with mock agents.

**BOSS can:** Create teams, add/remove tasks, see status via protocol commands. State machine proven before real agents.

### Phase 2: OpenCode Integration (Agents Come Alive)

**Delivers:** AgentPool (spawn, connect, monitor, teardown), port allocation, health checks, stall/crash detection, SSE monitoring, agent prompt construction, TaskPlanner stub.

**Depends on:** Phase 1

### Phase 3: Git Workflow (Safe Parallel Work)

**Delivers:** Worktree creation/cleanup, TeamReviewer, serial merge queue, tiered merge classification, conflict escalation UX, post-merge test validation.

**Depends on:** Phase 2

### Phase 4: TUI Board (Make It Visible)

**Delivers:** Board, BoardHeader, BoardColumn, TaskCard, TaskDetail, TeamBadge components. ViewMode toggle (Ctrl+B). Vim-style navigation. Notification tier rendering.

**Depends on:** Phase 1 (store interface). Can be developed in parallel with Phases 2-3 using mock data.

### Phase 5: Intelligence Layer (Make It Smart)

**Delivers:** Full TaskPlanner (LLM decomposition with `requires`/`produces` inference), conversational detection in Cortex, dependency inference, failure severity classifier, conflict decision summarizer, Friday self-initiation.

**Depends on:** Phases 1-3 (full pipeline), Phase 4 (approval flow UI)

### Phase Dependency Graph

```
Phase 1 (Core Engine)
  ├──→ Phase 2 (OpenCode Integration)
  │      └──→ Phase 3 (Git Workflow)
  │             └──→ Phase 5 (Intelligence Layer)
  └──→ Phase 4 (TUI Board) ←── parallel with Phases 2-3
```

## Dependencies

- `@opencode-ai/sdk` — npm package for OpenCode client
- `opencode` — CLI must be installed on the system (`opencode serve`)
- No other new dependencies — uses existing Bun, SQLite, git infrastructure

## Testing Strategy

- Phase 1: Mock agents via injected `AgentPool` interface. Test state machine transitions, store CRUD, protocol commands.
- Phase 2: Integration tests spawn real OpenCode instances (requires `opencode` installed). Stall/crash detection tested with process signal injection.
- Phase 3: Git workflow tested in temp repos. Merge queue tested with concurrent completion simulation.
- Phase 4: TUI tests follow existing patterns (state reducer tests, component rendering).
- Phase 5: Planner tested with mock Cortex responses. Dependency inference tested with known `requires`/`produces` scenarios.
