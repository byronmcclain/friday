# Coming Soon

Future features and enhancements planned for Friday.

## Email Delegation

Give Friday the ability to compose and send emails on behalf of the user. Friday would draft professional emails based on high-level instructions, handle formatting and tone, and send them through a connected email provider. Think of it as having a personal executive assistant managing your outbox — just tell Friday what you need communicated and to whom, and she handles the rest.

## Audit Log Trimming & Detail View

Trim long audit log entries in the default display so the log stays clean and scannable. Entries that exceed a reasonable length would be truncated with an indicator showing there's more to see. A CLI command (or selecting an entry) would open a dialog displaying the full, untruncated detail of that log entry — giving you the quick overview by default without losing access to the complete picture when you need it.

## Sub-Friday Spawning (Mother Friday)

Allow the main Friday instance to spawn child Fridays that work on tasks in parallel. The primary Friday acts as the "mom" — she delegates subtasks to spawned child instances, monitors their progress, and collects their results. Each child Friday operates independently on its assigned work but reports back to the parent. Mother Friday orchestrates the whole operation: breaking down complex requests, dispatching children, handling failures, and assembling the final outcome. A parent-child hierarchy that lets Friday scale herself out when the workload demands it.
