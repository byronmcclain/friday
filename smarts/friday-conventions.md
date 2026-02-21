---
name: friday-conventions
domain: project-friday
tags: [friday, conventions, architecture, mcu]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Friday Project Conventions

## MCU Naming
- Cortex = LLM brain, conversation state
- Protocol = slash command (/command routing)
- Directive = standing order (signal-triggered action)
- Module = suit upgrade (bundled tools/protocols/knowledge)
- Signal = event (typed, flows through SignalBus)
- Clearance = permission gate

## Architecture
- FridayRuntime is the composition root
- Boot order: SignalBus → ClearanceManager → AuditLogger → NotificationManager → ProtocolRegistry → DirectiveStore/Engine → SmartsStore → Cortex → Modules
- Protocols bypass LLM entirely
- Everything flows through typed interfaces

## Testing
- Use `injectedProvider` stubs for tests (never real API keys)
- SQLite tests clean up WAL: unlink .db, .db-wal, and .db-shm in afterEach
- Temp files in /tmp/friday-test-*
