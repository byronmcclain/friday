# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Friday** (F.R.I.D.A.Y. — Female Replacement Intelligent Digital Assistant Youth) is a personal AI assistant inspired by Tony Stark's assistant from the MCU. It is built as a CLI-first application with plans to add a UI/UX layer once the core is solid.

- **Runtime**: Bun (not Node.js)
- **Language**: TypeScript (strict mode)
- **AI Provider**: Anthropic Claude via `@anthropic-ai/sdk`
- **CLI Framework**: Commander.js
- **Linter/Formatter**: Biome (not ESLint/Prettier)

## Commands

```bash
bun run start          # Run Friday
bun run dev            # Run with --watch (auto-restart on changes)
bun test               # Run all tests
bun test --watch       # Run tests in watch mode
bun test tests/unit/friday.test.ts  # Run a single test file
bun run lint           # Lint check (no changes)
bun run lint:fix       # Lint and auto-fix
bun run format         # Format all source files
bun run typecheck      # TypeScript type checking (tsc --noEmit)
```

## Architecture

```
src/
├── main.ts              # Entrypoint — CLI bootstrap
├── cli/
│   ├── index.ts          # Commander program definition, command registration
│   └── commands/         # One file per CLI command (e.g., chat.ts)
├── core/
│   ├── friday.ts         # FridayCore — central orchestrator, conversation state, provider routing
│   ├── types.ts          # Shared TypeScript interfaces (FridayConfig, FridayTool, FridayAgent)
│   └── prompts.ts        # System prompts defining Friday's personality and behavior
├── agents/               # Specialized sub-agents (coding, research, etc.) — future
├── providers/            # LLM provider adapters (Anthropic is primary) — future
├── tools/                # Tool implementations Friday can invoke (file ops, web, etc.) — future
├── config/               # Runtime configuration loading — future
└── utils/                # Shared utilities — future
tests/
├── unit/                 # Unit tests (bun:test)
└── integration/          # Integration tests — future
```

### Key Design Patterns

- **FridayCore** (`src/core/friday.ts`) is the single orchestrator. All AI interactions flow through it. It owns conversation history and delegates to providers/tools.
- **Commands** are registered via Commander.js in `src/cli/index.ts`. Each command lives in its own file under `src/cli/commands/` and exports a function that takes the Commander `program` instance.
- **Types** are centralized in `src/core/types.ts`. The `FridayTool` and `FridayAgent` interfaces define the contracts for extensibility.
- **Prompts** live in `src/core/prompts.ts` as exported constants. Friday's personality is defined here — keep it consistent when modifying.

## Bun-Specific Rules

Default to Bun APIs instead of Node.js equivalents or third-party packages:

- `bun <file>` instead of `node <file>` or `ts-node <file>`
- `bun test` (with `bun:test`) instead of jest or vitest
- `bun install` instead of npm/yarn/pnpm install
- `Bun.serve()` for HTTP/WebSocket servers (not express)
- `Bun.file()` over `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` instead of execa for shell commands
- `bun:sqlite` for SQLite (not better-sqlite3)
- Bun auto-loads `.env` files — do not use dotenv

## Environment

Requires `ANTHROPIC_API_KEY` in `.env` (see `.env.example`). Bun loads this automatically.

## Docker

```bash
docker build -t friday .
docker run -e ANTHROPIC_API_KEY=sk-ant-... friday chat
```

## Conventions

- Friday's personality is defined in `src/core/prompts.ts` — changes there affect all interactions
- The user is a 30+ year programming veteran — Friday should match that expertise level in generated code
- CLI output uses chalk (colors), ora (spinners), and boxen (bordered boxes) for polish
- Biome handles both linting and formatting — run `bun run lint:fix` before committing
