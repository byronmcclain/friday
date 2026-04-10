# Enhanced Input Bar Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** TUI input bar — multi-line editing, external vim integration

## Overview

Enhance the Friday TUI input bar from a single-line `<input>` to a multi-line `<textarea>` with dynamic height, tab/newline support, formatted paste handling, and a hotkey to open vim for complex composition.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approach | Swap `<input>` → `<textarea>` (Approach A) | OpenTUI's `<textarea>` is the parent class of `<input>` — we stop constraining it to one line |
| Submit key | Enter | Preserves current single-line fast-path |
| Newline key | Shift+Enter | Enter stays as submit; Shift+Enter is the modifier for line breaks |
| Editor hotkey | Ctrl+E | Mnemonic ("E" for editor), not claimed by existing TUI bindings |
| Editor binary | `vim` → `vi` fallback | Always vim-family, no `$EDITOR`/`$VISUAL` indirection |
| Editor pattern | TUI suspend/resume | Terminal is shared resource — vim needs exclusive access |

## Architecture

### 1. Textarea Core

Replace the `<input>` element in `CommandTypeahead` with OpenTUI's native `<textarea>`:

- `wrapMode="word"` for natural line wrapping
- **Dynamic height**: starts at 1 line (identical to current appearance), grows as content adds lines, caps at `MAX_INPUT_LINES` (10 rows), then scrolls internally
- Height derived from content line count, recalculated on every `onInput` event
- The `onInput` → `setShadow()` pattern for suggestion filtering carries over unchanged
- The `replaceInput()` remount pattern (bump `inputKey`) carries over to `<textarea>`

### 2. Keybinding Map

| Key | Context | Action |
|-----|---------|--------|
| Enter | No suggestions showing | Submit input |
| Enter | Suggestions showing | Accept selected suggestion |
| Shift+Enter | Always | Insert newline |
| Tab | Suggestions showing | Accept selected suggestion |
| Tab | No suggestions | Insert tab character |
| Up/Down | Suggestions showing | Navigate suggestions |
| Up/Down | No suggestions, single-line content | Navigate input history |
| Up/Down | No suggestions, multi-line, cursor in middle | Move cursor within textarea |
| Up/Down | No suggestions, multi-line, cursor on first/last line | Navigate input history |
| Ctrl+E | Always (when not disabled) | Open vim editor |
| Ctrl+C | Always | Exit |
| Ctrl+L | Always | Toggle log panel |
| Escape | Suggestions showing | Dismiss suggestions |

**Hint bar:** `↑↓ history · Tab complete · ⇧↵ newline · ^E vim · ^L logs · ^C exit`

### 3. External Editor Integration (Ctrl+E)

**Flow:**
1. User presses Ctrl+E
2. Write current textarea content to temp file (`/tmp/friday-editor-XXXXX.txt`)
3. Suspend TUI — `renderer.destroy()` + `restoreTerminal()`
4. Spawn `vim` (fallback `vi`) with temp file via `Bun.spawn` with inherited stdio
5. Wait for editor process to exit
6. Read temp file, delete temp file
7. Re-create TUI renderer, re-render React tree — app state (messages, connection, log entries) is preserved in the React component tree via refs and state; only the renderer is destroyed/recreated
8. Return editor content to `CommandTypeahead` which calls `replaceInput()`

**Edge cases:**
- Empty file on save → treat as cancellation, restore previous content
- `vim` not found → try `vi`; `vi` not found → toast error, restore content
- Editor exits non-zero → restore previous content, show error toast
- Empty textarea → opens editor with empty file (compose from scratch)

**Utility:** `openExternalEditor(initialContent: string): Promise<string | null>` in `src/cli/tui/lib/external-editor.ts`. Returns file content on success, `null` on cancellation/error.

### 4. Paste Handling

OpenTUI's `<textarea>` with `wrapMode="word"` natively handles multi-line paste — newlines are inserted as-is. The textarea auto-grows to show full pasted content (up to `MAX_INPUT_LINES`, then scrolls). No special code needed.

Tabs in pasted content are preserved as-is.

### 5. Up/Down in Multi-line Content

When textarea has multiple lines and no suggestions are showing:
- Cursor on line 1, press Up → navigate input history
- Cursor on last line, press Down → navigate input history
- Cursor anywhere else → move cursor within textarea (normal editor behavior)

This preserves history navigation at the edges while giving natural cursor movement inside multi-line content.

## File Changes

### Modified

| File | Change |
|------|--------|
| `src/cli/tui/components/command-typeahead.tsx` | Swap `<input>` → `<textarea>`, dynamic height, remap keybindings, update Up/Down for multi-line cursor awareness, update hint text |
| `src/cli/tui/components/input-bar.tsx` | Pass `onOpenEditor` callback to `CommandTypeahead` |
| `src/cli/tui/app.tsx` | TUI suspend/resume logic, wire `onOpenEditor` callback |

### New

| File | Purpose |
|------|---------|
| `src/cli/tui/lib/external-editor.ts` | `openExternalEditor()` — temp file, spawn vim/vi, read result, cleanup |

### Unchanged

`state.ts`, `theme.ts`, `filter-commands.ts` — no modifications needed.

## Prop Chain

```
FridayApp (owns renderer, suspend/resume)
  → InputBar (passes through onOpenEditor)
    → CommandTypeahead (Ctrl+E calls onOpenEditor with current content)
```

`CommandTypeahead` gets new prop: `onOpenEditor: (currentContent: string) => Promise<string | null>`.

## Testing

### Unit Tests

**New file `tests/unit/tui-editor.test.ts`:**
- `openExternalEditor()` — temp file creation, content write, read-back, cleanup
- Fallback chain: `vim` not found → `vi`
- Non-zero exit code → returns `null`
- Empty file on save → returns `null`

**New file or extend existing `tests/unit/tui-input.test.ts`:**
- Keybinding logic: Enter submits, Shift+Enter inserts newline, Tab inserts tab (no suggestions), Tab accepts suggestion (with suggestions)
- Dynamic height calculation: 1 line → height 1, 5 lines → height 5, 15 lines → capped at 10
- Up/Down history: only triggers on first/last line of multi-line content
- `replaceInput()` with multi-line content preserves newlines and tabs

### Not Tested (Manual Only)
- Actual vim spawning (requires real terminal)
- OpenTUI textarea rendering (framework responsibility)
- TUI suspend/resume (requires real terminal)

### Manual Test Checklist
1. Type single-line message, Enter → submits (unchanged)
2. Shift+Enter mid-sentence → newline inserted, input grows
3. Paste multi-line text → input grows to show full content
4. Tab → tab character with visible indentation
5. `/arc` + Tab → suggestion accepted
6. Ctrl+E → vim opens with current content
7. Edit in vim, `:wq` → back in TUI with edited content
8. Ctrl+E, `:q!` → previous content preserved
9. Up/Down in multi-line moves cursor; Up on first line recalls history
