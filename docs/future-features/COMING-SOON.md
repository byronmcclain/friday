# Coming Soon

Future features and enhancements planned for Friday.

## Email Delegation

Give Friday the ability to compose and send emails on behalf of the user. Friday would draft professional emails based on high-level instructions, handle formatting and tone, and send them through a connected email provider. Think of it as having a personal executive assistant managing your outbox — just tell Friday what you need communicated and to whom, and she handles the rest.

## Audit Log Trimming & Detail View

Trim long audit log entries in the default display so the log stays clean and scannable. Entries that exceed a reasonable length would be truncated with an indicator showing there's more to see. A CLI command (or selecting an entry) would open a dialog displaying the full, untruncated detail of that log entry — giving you the quick overview by default without losing access to the complete picture when you need it.

## Sub-Friday Spawning (Mother Friday)

Allow the main Friday instance to spawn child Fridays that work on tasks in parallel. The primary Friday acts as the "mom" — she delegates subtasks to spawned child instances, monitors their progress, and collects their results. Each child Friday operates independently on its assigned work but reports back to the parent. Mother Friday orchestrates the whole operation: breaking down complex requests, dispatching children, handling failures, and assembling the final outcome. A parent-child hierarchy that lets Friday scale herself out when the workload demands it.

## Visor — Dynamic HUD Overlay

Give Friday an Iron Man-style heads-up display. The Visor is a dynamic UI layer that directives can activate on the fly — alert banners, confirmation dialogs, text inputs, selection lists, and progress bars that appear over the chat interface without interrupting the conversation flow. Think of it as Friday's helmet display: contextual information and interactive controls that surface exactly when a directive needs them.

Any directive action can attach a HUD side-effect with a timing hint: **before** (gate the action behind a confirmation or input), **during** (show a progress bar while the action runs), or **after** (display a result alert once the action completes). This keeps HUD behavior composable — a "push to remote" directive can require a tap-to-confirm before executing, while a "run test suite" directive can show a live progress bar.

Five fixed widget templates cover the use cases:

- **Alert** — A directive-triggered banner (info, warning, or critical) with an optional auto-dismiss timer. Styled in the Friday amber palette: copper borders, amber text, matching the existing Header and LogPanel aesthetic.
- **Confirm** — A yes/no decision gate. BOSS taps a button instead of having to say "yes" aloud.
- **Text Input** — A single text field for structured input: branch names, commit messages, search queries. Optional regex validation.
- **Select** — Pick from a list of labeled options: choose a branch, a label, a deployment target.
- **Progress** — A horizontal gauge with percentage and status (running, done, failed) for long-running directives.

The real power is the voice-mode synergy. When Vox is active and BOSS is speaking to Friday, the Visor gives him a tactile fallback — Friday says "I need a target branch, check the HUD" and a text-input widget appears in the TUI or Web UI. BOSS types instead of dictating. Form responses flow back through the bridge to resolve the directive's pending request, so the action sequence continues seamlessly.

Under the hood, a `VisorManager` core subsystem (MCU name: **Visor**) manages an ordered stack of active widgets with max-concurrency limits and TTL-based auto-dismiss. It boots after Vox and before Cortex so both directives and Cortex tools can trigger HUD elements. Both the TUI (OpenTUI `HudOverlay` component) and the Web UI (React `HudLayer` floating cards) subscribe to the same VisorManager events via their respective bridges, keeping rendering fully decoupled from logic. The WebSocket protocol gains `hud:show`, `hud:dismiss`, `hud:update`, and `hud:response` message types.

## Clearance Control Panel

Give BOSS a control panel for managing Friday's clearance permissions — the 12 security gates that determine what Friday is allowed to do. Right now every clearance is hardcoded as granted at boot with no way to restrict, review, or adjust them at runtime. The control panel makes clearances a first-class, user-configurable system backed by persistent SQLite storage.

The `/clearance` protocol (aliases: `/perm`, `/permissions`) exposes the interface:

- **status** — Show all 12 clearances with their current state (granted/denied), grouped by risk category.
- **grant \<name\>** — Enable a specific clearance. Takes effect immediately and persists across restarts.
- **revoke \<name\>** — Disable a specific clearance. Active tools and directives that depend on it start failing gracefully.
- **profile list** — Show saved permission profiles (e.g., "lockdown", "full-access", "dev-only").
- **profile save \<name\>** — Snapshot the current clearance state as a named profile.
- **profile load \<name\>** — Restore all clearances from a saved profile in one shot.
- **reset** — Restore the default all-granted configuration.

Clearance settings live in Friday's existing SQLite database (via `Memory`) in a `clearance_settings` table — a simple key-value layout mapping each `ClearanceName` to its granted/denied state. On boot, `ClearanceManager` hydrates from the database instead of the hardcoded array. If no database rows exist (first run), the current all-granted default seeds the table.

Profiles are stored in a companion `clearance_profiles` table — each profile is a named snapshot of all 12 permission states. BOSS can build profiles for different contexts: a "lockdown" profile that disables `exec-shell`, `write-fs`, `delete-fs`, and `forge-modify` when he wants Friday on a short leash; a "read-only" profile for safe browsing; a "full-access" profile for trusted sessions.

Risk categories organize the status display so BOSS can eyeball his exposure at a glance:

- **Filesystem** — `read-fs`, `write-fs`, `delete-fs`
- **Execution** — `exec-shell`, `forge-modify`
- **Network** — `network`, `email-send`
- **Git** — `git-read`, `git-write`
- **System** — `provider`, `system`, `audio-output`

Audit entries track every grant/revoke/profile-load action so there's a full trail of who changed what and when. The `ClearanceManager` gains a `persist()` method that writes back to SQLite on every `grant()`/`revoke()` call, and a static `hydrate()` factory that reads from the database at boot. A `manage_clearance` Cortex tool lets Friday herself suggest permission changes — but BOSS always has final say through the protocol.
