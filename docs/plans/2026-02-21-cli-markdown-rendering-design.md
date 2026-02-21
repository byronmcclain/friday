# CLI Markdown Rendering Design

**Date**: 2026-02-21
**Status**: Approved

## Problem

Friday's LLM responses contain markdown (bold, headers, code blocks, lists, etc.) but the CLI prints raw markdown syntax as literal text. `**bold**` shows as `**bold**` instead of **bold**.

## Solution

Use `marked` + `marked-terminal` to render markdown as ANSI-styled terminal output before printing.

## Approach: marked + marked-terminal

**Why this over alternatives:**
- `marked-terminal` is battle-tested (4.1M downloads/week, used by semantic-release and 900+ packages)
- Full markdown spec: bold, italic, headers, code blocks with syntax highlighting, tables, blockquotes, HR, lists, links, emoji
- Syntax highlighting via `cli-highlight` / highlight.js
- Verified working in Bun 1.3.9
- Zero custom renderer code needed

**Rejected alternatives:**
- Custom renderer (marked + chalk): ~20 methods to implement and maintain, marginal size savings
- ink-markdown: Near-abandoned, requires React/Ink architecture change, internally wraps marked-terminal anyway
- cli-markdown: Heavy (18MB, 115 packages), low adoption
- markdown-it-terminal: Broken in Bun (ReferenceError)

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `marked` | `^15` | Markdown parser (pinned to satisfy marked-terminal peer dep `>=1 <16`) |
| `marked-terminal` | `^7` | ANSI terminal renderer for marked |

Transitive: `cli-highlight`, `cli-table3`, `node-emoji`, `ansi-escapes`, `supports-hyperlinks` (~8MB total in node_modules)

## Files

| File | Change |
|------|--------|
| `src/cli/render.ts` | **New** — `renderMarkdown(text: string): string` utility |
| `src/cli/commands/chat.ts` | Call `renderMarkdown()` on LLM and protocol output before printing |
| `tests/unit/render.test.ts` | **New** — verify ANSI output for bold, code blocks, headers |

## Styling

- **Headers**: cyan + bold (matches Friday's existing cyan CLI theme)
- **Bold/Italic**: terminal defaults
- **Code blocks**: syntax highlighted via cli-highlight, indented
- **Inline code**: yellow
- **Links**: blue + underline
- **Blockquotes**: dim/gray italic
- **Tables**: cli-table3 (built into marked-terminal)
- **Lists**: bullet/number with proper nesting
- **Horizontal rules**: dashes across terminal width

Configuration is a single options object in `render.ts`, easy to adjust.

## Integration Point

In `chat.ts`, the output line changes from:
```typescript
console.log(`\n${prefix} ${result.output}\n`);
```
to:
```typescript
console.log(`\n${prefix} ${renderMarkdown(result.output)}\n`);
```

Both LLM responses and protocol output go through the renderer.
