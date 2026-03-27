# Enhanced Input Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-line `<input>` in the TUI input bar with a multi-line `<textarea>` that supports newlines (Shift+Enter), tabs, paste, dynamic height, and a Ctrl+E hotkey to open vim.

**Architecture:** Swap OpenTUI's `<input>` for `<textarea>` in `CommandTypeahead`, add dynamic height based on line count, remap keybindings for Enter/Shift+Enter/Tab, add cursor-aware Up/Down for history vs. textarea navigation, and create a new `external-editor.ts` utility for vim integration via TUI suspend/resume.

**Tech Stack:** OpenTUI (`@opentui/core`, `@opentui/react`), Bun APIs (`Bun.spawn`, `Bun.file`, `Bun.write`), `bun:test`

**Spec:** `docs/plans/2026-03-27-enhanced-input-bar-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/cli/tui/lib/external-editor.ts` | Create | `openExternalEditor()` — temp file write, spawn vim/vi, read result, cleanup |
| `src/cli/tui/components/command-typeahead.tsx` | Modify | Swap `<input>` → `<textarea>`, dynamic height, keybinding remap, cursor-aware Up/Down, new `onOpenEditor` prop |
| `src/cli/tui/components/input-bar.tsx` | Modify | Pass `onOpenEditor` callback through to `CommandTypeahead` |
| `src/cli/tui/app.tsx` | Modify | TUI suspend/resume for external editor, wire `onOpenEditor` callback |
| `tests/unit/tui-editor.test.ts` | Create | Tests for `openExternalEditor()` |
| `tests/unit/tui-input-height.test.ts` | Create | Tests for `computeInputHeight()` helper |

---

### Task 1: External Editor Utility — Tests

**Files:**
- Create: `tests/unit/tui-editor.test.ts`
- Create: `src/cli/tui/lib/external-editor.ts` (stub)

- [ ] **Step 1: Create the test file with all test cases**

```typescript
// tests/unit/tui-editor.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { openExternalEditor } from "../../src/cli/tui/lib/external-editor.ts";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

// Collect temp files for cleanup
const tempFiles: string[] = [];

afterEach(async () => {
	for (const f of tempFiles) {
		try { await unlink(f); } catch {}
	}
	tempFiles.length = 0;
});

describe("openExternalEditor", () => {
	test("writes initial content to temp file and reads it back", async () => {
		// Use 'cat' as the editor — it reads stdin but we just need the file to persist
		// We'll use 'true' (no-op) so the file stays unchanged — content round-trips
		const result = await openExternalEditor("hello world", { editorCommand: "true" });
		expect(result).toBe("hello world");
	});

	test("returns edited content after editor modifies the file", async () => {
		// Use sed to append a line to the temp file
		const result = await openExternalEditor("line one", {
			editorCommand: "sed",
			editorArgs: (path) => ["-i", "", "$a\\nline two", path],
		});
		expect(result).toBe("line one\nline two");
	});

	test("returns null when editor exits with non-zero code", async () => {
		const result = await openExternalEditor("content", { editorCommand: "false" });
		expect(result).toBeNull();
	});

	test("returns null when file is empty after edit", async () => {
		// Use truncate to empty the file
		const result = await openExternalEditor("some content", {
			editorCommand: "sh",
			editorArgs: (path) => ["-c", `> "${path}"`],
		});
		expect(result).toBeNull();
	});

	test("handles empty initial content", async () => {
		const result = await openExternalEditor("", { editorCommand: "true" });
		// Empty file → null (treated as cancellation per spec)
		expect(result).toBeNull();
	});

	test("preserves multi-line content with tabs", async () => {
		const content = "line one\n\ttabbed line\nline three";
		const result = await openExternalEditor(content, { editorCommand: "true" });
		expect(result).toBe(content);
	});

	test("cleans up temp file after completion", async () => {
		let capturedPath = "";
		const result = await openExternalEditor("test", {
			editorCommand: "true",
			onTempPath: (p) => { capturedPath = p; },
		});
		expect(capturedPath).toMatch(/^\/tmp\/friday-editor-/);
		expect(existsSync(capturedPath)).toBe(false);
	});

	test("cleans up temp file even on editor failure", async () => {
		let capturedPath = "";
		await openExternalEditor("test", {
			editorCommand: "false",
			onTempPath: (p) => { capturedPath = p; },
		});
		expect(capturedPath.length).toBeGreaterThan(0);
		expect(existsSync(capturedPath)).toBe(false);
	});
});
```

- [ ] **Step 2: Create the stub implementation so the tests compile**

```typescript
// src/cli/tui/lib/external-editor.ts
export interface EditorOptions {
	editorCommand?: string;
	editorArgs?: (path: string) => string[];
	onTempPath?: (path: string) => void;
}

export async function openExternalEditor(
	_initialContent: string,
	_options?: EditorOptions,
): Promise<string | null> {
	throw new Error("Not implemented");
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test tests/unit/tui-editor.test.ts`
Expected: All tests FAIL with "Not implemented"

- [ ] **Step 4: Commit**

```bash
git add tests/unit/tui-editor.test.ts src/cli/tui/lib/external-editor.ts
git commit -m "test: add failing tests for openExternalEditor utility"
```

---

### Task 2: External Editor Utility — Implementation

**Files:**
- Modify: `src/cli/tui/lib/external-editor.ts`

- [ ] **Step 1: Implement openExternalEditor**

```typescript
// src/cli/tui/lib/external-editor.ts
import { unlink } from "node:fs/promises";

export interface EditorOptions {
	/** Override the editor binary (default: "vim", fallback "vi") */
	editorCommand?: string;
	/** Override args — receives temp file path, returns args array */
	editorArgs?: (path: string) => string[];
	/** Callback that receives the temp file path (for testing cleanup) */
	onTempPath?: (path: string) => void;
}

/**
 * Opens an external editor with the given content.
 * Returns the edited content on success, null on cancellation/error.
 */
export async function openExternalEditor(
	initialContent: string,
	options?: EditorOptions,
): Promise<string | null> {
	// Generate unique temp file path
	const suffix = crypto.randomUUID().slice(0, 8);
	const tempPath = `/tmp/friday-editor-${suffix}.txt`;

	try {
		// Write initial content to temp file
		await Bun.write(tempPath, initialContent);
		options?.onTempPath?.(tempPath);

		// Resolve editor command and args
		const command = options?.editorCommand ?? await resolveEditor();
		const args = options?.editorArgs
			? options.editorArgs(tempPath)
			: [tempPath];

		// Spawn editor process with inherited stdio
		const proc = Bun.spawn([command, ...args], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			return null;
		}

		// Read the edited content
		const file = Bun.file(tempPath);
		const content = await file.text();

		// Empty file = cancellation
		if (content.length === 0) {
			return null;
		}

		return content;
	} finally {
		// Always clean up temp file
		try {
			await unlink(tempPath);
		} catch {
			// File may not exist if write failed
		}
	}
}

/** Resolve vim → vi fallback chain */
async function resolveEditor(): Promise<string> {
	try {
		const which = Bun.spawn(["which", "vim"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await which.exited;
		if (code === 0) return "vim";
	} catch {
		// vim not found
	}

	return "vi";
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `bun test tests/unit/tui-editor.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 3: Run the full test suite to check for regressions**

Run: `bun test`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/cli/tui/lib/external-editor.ts
git commit -m "feat: implement openExternalEditor utility for vim integration"
```

---

### Task 3: Input Height Helper — Tests and Implementation

**Files:**
- Create: `tests/unit/tui-input-height.test.ts`
- Create (will be inlined in command-typeahead.tsx, but tested standalone): helper function

We'll extract the height computation as a pure function so it's testable without rendering.

- [ ] **Step 1: Create the test file**

```typescript
// tests/unit/tui-input-height.test.ts
import { describe, test, expect } from "bun:test";
import { computeInputHeight } from "../../src/cli/tui/components/command-typeahead.tsx";

describe("computeInputHeight", () => {
	test("returns 1 for empty string", () => {
		expect(computeInputHeight("")).toBe(1);
	});

	test("returns 1 for single-line content", () => {
		expect(computeInputHeight("hello world")).toBe(1);
	});

	test("returns line count for multi-line content", () => {
		expect(computeInputHeight("line 1\nline 2\nline 3")).toBe(3);
	});

	test("caps at MAX_INPUT_LINES (10)", () => {
		const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
		expect(computeInputHeight(lines)).toBe(10);
	});

	test("counts trailing newline as extra line", () => {
		expect(computeInputHeight("line 1\nline 2\n")).toBe(3);
	});

	test("handles content with tabs", () => {
		expect(computeInputHeight("col1\tcol2\ncol3\tcol4")).toBe(2);
	});
});
```

- [ ] **Step 2: Add the exported helper to command-typeahead.tsx**

Add this near the top of `src/cli/tui/components/command-typeahead.tsx`, after the existing constants:

```typescript
const MAX_INPUT_LINES = 10;

/** Compute textarea height (in rows) from content — capped at MAX_INPUT_LINES. */
export function computeInputHeight(content: string): number {
	if (content.length === 0) return 1;
	const lineCount = content.split("\n").length;
	return Math.min(lineCount, MAX_INPUT_LINES);
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `bun test tests/unit/tui-input-height.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/tui-input-height.test.ts src/cli/tui/components/command-typeahead.tsx
git commit -m "feat: add computeInputHeight helper with tests"
```

---

### Task 4: Swap `<input>` to `<textarea>` in CommandTypeahead

This is the core change. We replace the `<input>` element with `<textarea>`, remap keybindings, and add cursor-aware Up/Down logic.

**Files:**
- Modify: `src/cli/tui/components/command-typeahead.tsx`

- [ ] **Step 1: Update imports and add new types/constants**

At the top of `command-typeahead.tsx`, add the `TextareaRenderable` import from OpenTUI core (for the ref type):

```typescript
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
```

Replace:
```typescript
import type { ScrollBoxRenderable } from "@opentui/core";
```

- [ ] **Step 2: Add the onOpenEditor prop and cursor state**

Update the `CommandTypeaheadProps` interface:

```typescript
interface CommandTypeaheadProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
	onOpenEditor: (currentContent: string) => Promise<string | null>;
	isThinking: boolean;
	isStreaming: boolean;
}
```

Inside the `CommandTypeahead` function, add cursor line tracking state and a ref for the textarea:

```typescript
const [cursorLine, setCursorLine] = useState(0);
const [lineCount, setLineCount] = useState(1);
const textareaRef = useRef<TextareaRenderable>(null);
```

- [ ] **Step 3: Update the onInput handler to track line count**

Replace the existing `handleInput` callback:

```typescript
const handleInput = useCallback((value: string) => {
	setShadow(value);
	setLineCount(computeInputHeight(value));
	setSelectedIndex(0);
	setSuggestionsBlocked(false);
	historyIndexRef.current = -1;
}, []);
```

Add a cursor change handler:

```typescript
const handleCursorChange = useCallback((event: { line: number; visualColumn: number }) => {
	setCursorLine(event.line);
}, []);
```

- [ ] **Step 4: Update the replaceInput helper**

The existing `replaceInput` needs to also update the line count:

```typescript
const replaceInput = useCallback((value: string) => {
	nextValueRef.current = value;
	setShadow(value);
	setLineCount(computeInputHeight(value));
	setCursorLine(0);
	setInputKey((k) => k + 1);
}, []);
```

- [ ] **Step 5: Rewrite the useKeyboard handler for new keybindings**

Replace the entire `useKeyboard(...)` block:

```typescript
useKeyboard((key) => {
	if (disabled) return;

	// Ctrl+C — exit
	if (key.ctrl && key.name === "c") {
		key.preventDefault();
		onExit();
		return;
	}

	// Ctrl+E — open external editor
	if (key.ctrl && key.name === "e") {
		key.preventDefault();
		void (async () => {
			const result = await onOpenEditor(shadowRef.current);
			if (result !== null) {
				replaceInput(result);
			}
		})();
		return;
	}

	// Enter (without shift) — accept suggestion or submit input
	if (key.name === "return" && !key.shift) {
		key.preventDefault();
		if (hasSuggestions) {
			const selected = suggestions[selectedIndex];
			if (selected) {
				replaceInput(`/${selected.name} `);
				setSelectedIndex(0);
			}
			return;
		}
		const trimmed = shadowRef.current.trim();
		if (trimmed.length > 0) {
			// Push to history (skip consecutive duplicates)
			if (historyRef.current[0] !== trimmed) {
				historyRef.current.unshift(trimmed);
				if (historyRef.current.length > MAX_HISTORY)
					historyRef.current.pop();
			}
			historyIndexRef.current = -1;
			onSubmit(trimmed);
			replaceInput("");
			setSelectedIndex(0);
		}
		return;
	}

	// Shift+Enter — insert newline (let textarea handle it natively)
	// We do NOT preventDefault here — the textarea's default "newline" action fires.
	// But we need to NOT trigger submit, which we've already handled above by checking !key.shift.

	// Up — suggestion navigation, history, or cursor movement
	if (key.name === "up") {
		if (hasSuggestions) {
			key.preventDefault();
			setSelectedIndex((i) =>
				i <= 0 ? suggestions.length - 1 : i - 1,
			);
			return;
		}
		// Multi-line: only navigate history when cursor is on line 0
		if (lineCount > 1 && cursorLine > 0) {
			// Let textarea handle cursor movement — don't preventDefault
			return;
		}
		// Single-line or cursor on first line: navigate history
		key.preventDefault();
		if (historyRef.current.length > 0) {
			if (historyIndexRef.current === -1) {
				savedCurrentRef.current = shadowRef.current;
			}
			if (historyIndexRef.current < historyRef.current.length - 1) {
				historyIndexRef.current++;
				const entry = historyRef.current[historyIndexRef.current];
				if (entry !== undefined) replaceInput(entry);
			}
		}
		return;
	}

	// Down — suggestion navigation, history, or cursor movement
	if (key.name === "down") {
		if (hasSuggestions) {
			key.preventDefault();
			setSelectedIndex((i) =>
				i >= suggestions.length - 1 ? 0 : i + 1,
			);
			return;
		}
		// Multi-line: only navigate history when cursor is on last line
		if (lineCount > 1 && cursorLine < lineCount - 1) {
			// Let textarea handle cursor movement
			return;
		}
		// Single-line or cursor on last line: navigate history
		key.preventDefault();
		if (historyIndexRef.current >= 0) {
			if (historyIndexRef.current > 0) {
				historyIndexRef.current--;
				const entry = historyRef.current[historyIndexRef.current];
				if (entry !== undefined) replaceInput(entry);
			} else {
				historyIndexRef.current = -1;
				replaceInput(savedCurrentRef.current);
			}
		}
		return;
	}

	// Tab — accept selected suggestion (only when suggestions showing)
	if (key.name === "tab" && hasSuggestions) {
		key.preventDefault();
		const selected = suggestions[selectedIndex];
		if (selected) {
			replaceInput(`/${selected.name} `);
			setSelectedIndex(0);
		}
		return;
	}
	// Tab without suggestions — let textarea insert tab character natively

	// Escape — dismiss suggestions only when showing
	if (key.name === "escape" && hasSuggestions) {
		key.preventDefault();
		setSelectedIndex(0);
		setSuggestionsBlocked(true);
		return;
	}
});
```

- [ ] **Step 6: Replace the `<input>` JSX with `<textarea>`**

Replace the input row JSX. The old code:

```tsx
<input
	key={inputKey}
	placeholder={placeholder}
	value={nextValueRef.current}
	onInput={handleInput}
	focused={!disabled}
	flexGrow={1}
	textColor={PALETTE.textPrimary}
	backgroundColor={PALETTE.background}
/>
```

New code:

```tsx
<textarea
	ref={textareaRef}
	key={inputKey}
	placeholder={placeholder}
	initialValue={nextValueRef.current}
	onContentChange={handleInput}
	onCursorChange={handleCursorChange}
	focused={!disabled}
	flexGrow={1}
	height={computeInputHeight(shadow)}
	wrapMode="word"
	textColor={PALETTE.textPrimary}
	backgroundColor={PALETTE.background}
	showCursor={!disabled}
/>
```

Note the API differences from `<input>`:
- `value` → `initialValue` (textarea uses `initialValue` for the initial content)
- `onInput` → `onContentChange` (textarea fires `onContentChange` on text changes)
- Added `onCursorChange` for cursor line tracking
- Added `height={computeInputHeight(shadow)}` for dynamic sizing
- Added `wrapMode="word"` for natural wrapping
- Added `showCursor` to hide cursor when disabled
- Added `ref` for future programmatic access if needed

- [ ] **Step 7: Update the handleInput callback to extract text from ContentChangeEvent**

The `<textarea>` `onContentChange` callback receives a `ContentChangeEvent`, not a raw string. We need to extract the text. Check the exact event shape — if it passes the full text as a property, use that. If the event only signals a change, read from the ref:

```typescript
const handleInput = useCallback((event: { text: string }) => {
	const value = event.text;
	setShadow(value);
	setLineCount(computeInputHeight(value));
	setSelectedIndex(0);
	setSuggestionsBlocked(false);
	historyIndexRef.current = -1;
}, []);
```

If `ContentChangeEvent` doesn't have a `text` property, read from the textarea ref instead:

```typescript
const handleInput = useCallback(() => {
	const value = textareaRef.current?.plainText ?? "";
	setShadow(value);
	setLineCount(computeInputHeight(value));
	setSelectedIndex(0);
	setSuggestionsBlocked(false);
	historyIndexRef.current = -1;
}, []);
```

**Important:** Verify the exact `ContentChangeEvent` shape at implementation time by checking `node_modules/@opentui/core/renderables/EditBufferRenderable.d.ts`. Use whichever approach matches the actual API.

- [ ] **Step 8: Update the hint text**

Replace the existing hint text:

```tsx
{"↑↓ history · Tab complete · ^L logs · ^C exit"}
```

With:

```tsx
{"↑↓ history · Tab complete · ⇧↵ newline · ^E vim · ^L logs · ^C exit"}
```

- [ ] **Step 9: Update the component function signature to accept onOpenEditor**

Add `onOpenEditor` to the destructured props:

```typescript
export function CommandTypeahead({
	commands,
	disabled,
	placeholder,
	onSubmit,
	onExit,
	onOpenEditor,
	isThinking,
	isStreaming,
}: CommandTypeaheadProps) {
```

- [ ] **Step 10: Run the lint check**

Run: `bun run lint`
Expected: No errors (or only pre-existing ones)

- [ ] **Step 11: Run the type check**

Run: `bun run typecheck`
Expected: No new type errors. If `ContentChangeEvent` shape differs, adjust Step 7.

- [ ] **Step 12: Commit**

```bash
git add src/cli/tui/components/command-typeahead.tsx
git commit -m "feat: swap input to textarea with multi-line support and keybindings"
```

---

### Task 5: Wire onOpenEditor Through InputBar

**Files:**
- Modify: `src/cli/tui/components/input-bar.tsx`

- [ ] **Step 1: Add onOpenEditor to InputBarProps**

Update the interface:

```typescript
interface InputBarProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
	onOpenEditor: (currentContent: string) => Promise<string | null>;
	isThinking: boolean;
	isStreaming: boolean;
}
```

- [ ] **Step 2: Destructure and pass through to CommandTypeahead**

Update the `InputBar` function:

```typescript
export function InputBar({
	commands,
	disabled,
	placeholder,
	onSubmit,
	onExit,
	onOpenEditor,
	isThinking,
	isStreaming,
}: InputBarProps) {
```

Add `onOpenEditor={onOpenEditor}` to the `<CommandTypeahead>` props:

```tsx
<CommandTypeahead
	commands={commands}
	disabled={disabled}
	placeholder={placeholder}
	onSubmit={onSubmit}
	onExit={onExit}
	onOpenEditor={onOpenEditor}
	isThinking={isThinking}
	isStreaming={isStreaming}
/>
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Will show errors in `app.tsx` where `InputBar` is used (missing `onOpenEditor` prop) — this is expected and fixed in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/cli/tui/components/input-bar.tsx
git commit -m "feat: thread onOpenEditor prop through InputBar"
```

---

### Task 6: TUI Suspend/Resume and Editor Wiring in app.tsx

**Files:**
- Modify: `src/cli/tui/app.tsx`

- [ ] **Step 1: Import openExternalEditor**

Add to the import block at the top of `app.tsx`:

```typescript
import { openExternalEditor } from "./lib/external-editor.ts";
```

- [ ] **Step 2: Create the handleOpenEditor callback in FridayApp**

Add this callback inside the `FridayApp` component, after the existing `handleMouseUp` callback. This is the TUI suspend/resume logic:

```typescript
const handleOpenEditor = useCallback(
	async (currentContent: string): Promise<string | null> => {
		// Suspend TUI — hand terminal back to the shell
		activeRenderer?.destroy();
		restoreTerminal();
		activeRenderer = null;

		try {
			const result = await openExternalEditor(currentContent);
			return result;
		} finally {
			// Resume TUI — re-create renderer
			const newRenderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });
			activeRenderer = newRenderer;

			// Re-wire emergency cleanup signals
			const emergencyCleanup = () => {
				newRenderer.destroy();
				restoreTerminal();
				process.exit(0);
			};
			process.removeAllListeners("SIGTERM");
			process.removeAllListeners("SIGINT");
			process.on("SIGTERM", emergencyCleanup);
			process.on("SIGINT", emergencyCleanup);

			// Re-render the React tree into the new renderer
			const root = createRoot(newRenderer);
			root.render(
				<FridayApp options={options} renderer={newRenderer} />,
			);
		}
	},
	[options],
);
```

**Important implementation note:** The suspend/resume pattern above re-creates the entire React tree. This means component state is lost. There are two approaches to handle this:

**Approach A (simpler):** Accept the state loss — the `useEffect` boot sequence will re-run, reconnecting the socket. Messages already on the server will replay via `onConversationMessage`. The editor result is returned from the promise, so the caller (`CommandTypeahead`) can use `replaceInput()` before the re-render happens. However, because the component tree is recreated, this won't work directly.

**Approach B (recommended):** Don't re-create the React tree. Instead, use the renderer's ability to be swapped. If OpenTUI supports re-attaching a root to a new renderer, use that. Otherwise, store app state outside React (in module-level variables or a ref that persists across the suspend) and re-hydrate on resume.

**At implementation time:** Test whether `createRoot(newRenderer)` with a fresh `<FridayApp>` successfully re-connects and replays history. If it does, Approach A is sufficient. If not, lift critical state (messages, bridge, boot status) into module-level variables that survive the re-mount.

The simplest viable path: since `handleOpenEditor` is `async` and returns a `Promise<string | null>`, and `CommandTypeahead` awaits it, the textarea's `replaceInput()` call happens after the promise resolves. But because the React tree is re-mounted, the original `CommandTypeahead` instance no longer exists. The solution is to store the pending editor result in a module-level variable and check it on mount:

```typescript
// Module-level — survives re-mount
let pendingEditorResult: string | null | undefined;
```

Then in `CommandTypeahead`, check on mount:

```typescript
useEffect(() => {
	if (pendingEditorResult !== undefined) {
		replaceInput(pendingEditorResult ?? "");
		pendingEditorResult = undefined;
	}
}, []);
```

And in `handleOpenEditor`, store the result before re-creating the renderer:

```typescript
const result = await openExternalEditor(currentContent);
pendingEditorResult = result;
// ... re-create renderer
return result;
```

- [ ] **Step 3: Wire onOpenEditor into the InputBar**

Update the `<InputBar>` JSX in `FridayApp`'s return:

```tsx
<InputBar
	commands={commandsRef.current}
	disabled={inputDisabled}
	placeholder={placeholder}
	onSubmit={handleSubmit}
	onExit={handleShutdown}
	onOpenEditor={handleOpenEditor}
	isThinking={state.isThinking}
	isStreaming={state.isStreaming}
/>
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: No new lint errors

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: All tests pass (the external-editor tests from Task 2, the height tests from Task 3, and all existing tests)

- [ ] **Step 7: Commit**

```bash
git add src/cli/tui/app.tsx
git commit -m "feat: wire TUI suspend/resume for external vim editor via Ctrl+E"
```

---

### Task 7: Manual Integration Testing

This task verifies the full feature end-to-end in a real terminal.

**Prerequisites:** `friday serve` must be running.

- [ ] **Step 1: Basic single-line submit (regression check)**

Run: `friday chat`
Type: `hello` then press Enter
Expected: Message submits, assistant responds. Identical to previous behavior.

- [ ] **Step 2: Multi-line input via Shift+Enter**

Type: `line one`, press Shift+Enter, type `line two`, press Enter
Expected: Input bar grows to 2 lines on Shift+Enter. Enter submits both lines as a single message. Input bar shrinks back to 1 line.

- [ ] **Step 3: Paste multi-line content**

Copy this text and paste into the input bar:
```
function hello() {
	console.log("world");
}
```
Expected: Input bar grows to show all 3 lines. Tabs are preserved. Enter submits the full content.

- [ ] **Step 4: Tab insertion**

Type: `col1`, press Tab, type `col2`
Expected: Tab character is inserted between col1 and col2, creating visible indentation.

- [ ] **Step 5: Tab with suggestion dropdown**

Type: `/arc`
Expected: Suggestion dropdown appears. Press Tab — suggestion is accepted. No tab character inserted.

- [ ] **Step 6: Ctrl+E opens vim**

Type some text, press Ctrl+E
Expected: TUI disappears, vim opens with the typed text. Edit the text, `:wq`. TUI reappears with the edited content in the input bar.

- [ ] **Step 7: Ctrl+E with vim quit-no-save**

Type some text, press Ctrl+E, then `:q!` in vim
Expected: TUI reappears with original content (or empty if treating as cancellation).

- [ ] **Step 8: Up/Down in multi-line content**

Enter some multi-line text via Shift+Enter (3+ lines). Use Up/Down arrows.
Expected: Cursor moves between lines. Press Up when cursor is on line 1 — recalls history. Press Down when on last line — navigates history forward.

- [ ] **Step 9: Verify hint bar**

Clear input, look at hint text below the prompt glyph.
Expected: Shows `↑↓ history · Tab complete · ⇧↵ newline · ^E vim · ^L logs · ^C exit`

---

### Task 8: Documentation Update

**Files:**
- Modify: `CLAUDE.md` (update TUI component list and keybinding documentation)

- [ ] **Step 1: Update the TUI section of CLAUDE.md**

In the Components list under `src/cli/tui/`, add `external-editor.ts` to the lib section:

```
│       ├── lib/           # ANSI parser, color utils, chafa logo processor, usePulse hook, external editor launcher
```

- [ ] **Step 2: Add input bar keybinding documentation**

Under the "Patterns & Gotchas" section, add:

```markdown
- **Input bar**: Multi-line `<textarea>` with dynamic height (1–10 rows). Enter submits, Shift+Enter inserts newline, Tab inserts tab (or accepts suggestion when dropdown showing), Ctrl+E opens vim (TUI suspends, resumes on editor exit). Up/Down navigates history when cursor is on first/last line, moves cursor otherwise.
```

- [ ] **Step 3: Run lint on CLAUDE.md**

Run: `bun run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document enhanced input bar keybindings and external editor"
```
