---
name: bun-patterns
domain: bun
tags: [bun, runtime, javascript, typescript, sqlite, testing]
confidence: 1.0
source: manual
created: 2026-02-21
updated: 2026-02-21
---

# Bun Runtime Patterns

## File Operations
- Use `Bun.file()` over `node:fs` readFile/writeFile
- Use `Bun.write()` for writing files

## HTTP/WebSocket
- Use `Bun.serve()` for servers (not express)

## Shell
- Use `Bun.$\`cmd\`` instead of execa for shell commands

## SQLite
- Use `bun:sqlite` (not better-sqlite3)
- Transactions: `db.transaction(() => { ... })()` — must invoke the returned function

## Testing
- Use `bun:test` (not jest or vitest)
- Import from `bun:test`: describe, test, expect, beforeEach, afterEach

## Environment
- Bun auto-loads `.env` files — do not use dotenv
