# TUI Log Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toggleable right-side log panel to Friday's TUI that displays a unified stream of audit logs and system lifecycle events in real-time.

**Architecture:** AuditLogger gets an `onLog` callback. A new `LogStore` (simple array + subscriber pattern, max 500 entries) buffers all log entries. A `LogPanel` OpenTUI component renders them in a right-side panel toggled by `Ctrl+L`. State for panel visibility lives in the existing `AppState` reducer.

**Tech Stack:** TypeScript, OpenTUI (`@opentui/react`, `@opentui/core`), `bun:test`

---

### Task 1: Log Types

**Files:**
- Create: `src/cli/tui/log-types.ts`

**Step 1: Create the LogEntry type and constants**

```typescript
// src/cli/tui/log-types.ts
export type LogLevel = "info" | "success" | "warning" | "error";

export interface LogEntry {
	id: string;
	timestamp: Date;
	level: LogLevel;
	source: string;
	message: string;
	detail?: string;
}

export const LOG_ICONS: Record<LogLevel, string> = {
	info: "●",
	success: "✓",
	warning: "⚠",
	error: "✗",
};

export const MAX_LOG_ENTRIES = 500;
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors in new file)

**Step 3: Commit**

```bash
git add src/cli/tui/log-types.ts
git commit -m "feat(tui): add LogEntry type and log level constants"
```

---

### Task 2: LogStore

**Files:**
- Create: `src/cli/tui/log-store.ts`
- Test: `tests/unit/tui-log-store.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/tui-log-store.test.ts
import { describe, test, expect } from "bun:test";
import { LogStore } from "../../src/cli/tui/log-store.ts";
import type { LogEntry } from "../../src/cli/tui/log-types.ts";

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		id: crypto.randomUUID(),
		timestamp: new Date(),
		level: "info",
		source: "test",
		message: "test message",
		...overrides,
	};
}

describe("LogStore", () => {
	test("starts empty", () => {
		const store = new LogStore();
		expect(store.entries).toEqual([]);
	});

	test("push adds an entry", () => {
		const store = new LogStore();
		const entry = makeEntry();
		store.push(entry);
		expect(store.entries).toHaveLength(1);
		expect(store.entries[0]).toBe(entry);
	});

	test("push preserves insertion order", () => {
		const store = new LogStore();
		const a = makeEntry({ message: "a" });
		const b = makeEntry({ message: "b" });
		store.push(a);
		store.push(b);
		expect(store.entries[0]!.message).toBe("a");
		expect(store.entries[1]!.message).toBe("b");
	});

	test("trims oldest entries beyond max capacity", () => {
		const store = new LogStore(3);
		store.push(makeEntry({ message: "1" }));
		store.push(makeEntry({ message: "2" }));
		store.push(makeEntry({ message: "3" }));
		store.push(makeEntry({ message: "4" }));
		expect(store.entries).toHaveLength(3);
		expect(store.entries[0]!.message).toBe("2");
		expect(store.entries[2]!.message).toBe("4");
	});

	test("notifies subscribers on push", () => {
		const store = new LogStore();
		const received: LogEntry[] = [];
		store.subscribe((entry) => received.push(entry));
		const entry = makeEntry();
		store.push(entry);
		expect(received).toHaveLength(1);
		expect(received[0]).toBe(entry);
	});

	test("unsubscribe stops notifications", () => {
		const store = new LogStore();
		const received: LogEntry[] = [];
		const cb = (entry: LogEntry) => received.push(entry);
		store.subscribe(cb);
		store.push(makeEntry());
		store.unsubscribe(cb);
		store.push(makeEntry());
		expect(received).toHaveLength(1);
	});

	test("multiple subscribers all receive entries", () => {
		const store = new LogStore();
		const r1: LogEntry[] = [];
		const r2: LogEntry[] = [];
		store.subscribe((e) => r1.push(e));
		store.subscribe((e) => r2.push(e));
		store.push(makeEntry());
		expect(r1).toHaveLength(1);
		expect(r2).toHaveLength(1);
	});

	test("subscriber errors do not break other subscribers", () => {
		const store = new LogStore();
		const received: LogEntry[] = [];
		store.subscribe(() => { throw new Error("boom"); });
		store.subscribe((e) => received.push(e));
		store.push(makeEntry());
		expect(received).toHaveLength(1);
	});

	test("clear removes all entries", () => {
		const store = new LogStore();
		store.push(makeEntry());
		store.push(makeEntry());
		store.clear();
		expect(store.entries).toEqual([]);
	});

	test("default max capacity is 500", () => {
		const store = new LogStore();
		for (let i = 0; i < 510; i++) {
			store.push(makeEntry({ message: `msg-${i}` }));
		}
		expect(store.entries).toHaveLength(500);
		expect(store.entries[0]!.message).toBe("msg-10");
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-log-store.test.ts`
Expected: FAIL — `LogStore` module not found

**Step 3: Implement LogStore**

```typescript
// src/cli/tui/log-store.ts
import { MAX_LOG_ENTRIES, type LogEntry } from "./log-types.ts";

export type LogSubscriber = (entry: LogEntry) => void;

export class LogStore {
	private _entries: LogEntry[] = [];
	private subscribers: Set<LogSubscriber> = new Set();
	private maxEntries: number;

	constructor(maxEntries = MAX_LOG_ENTRIES) {
		this.maxEntries = maxEntries;
	}

	get entries(): LogEntry[] {
		return this._entries;
	}

	push(entry: LogEntry): void {
		this._entries.push(entry);
		if (this._entries.length > this.maxEntries) {
			this._entries = this._entries.slice(this._entries.length - this.maxEntries);
		}
		for (const cb of this.subscribers) {
			try {
				cb(entry);
			} catch {
				// Isolate subscriber errors
			}
		}
	}

	subscribe(cb: LogSubscriber): void {
		this.subscribers.add(cb);
	}

	unsubscribe(cb: LogSubscriber): void {
		this.subscribers.delete(cb);
	}

	clear(): void {
		this._entries = [];
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-log-store.test.ts`
Expected: All 10 tests PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli/tui/log-store.ts tests/unit/tui-log-store.test.ts
git commit -m "feat(tui): add LogStore with subscriber pattern and capacity cap"
```

---

### Task 3: AuditLogger onLog Callback

**Files:**
- Modify: `src/audit/logger.ts`
- Test: `tests/unit/audit-logger-callback.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/audit-logger-callback.test.ts
import { describe, test, expect } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import type { AuditEntry } from "../../src/audit/types.ts";

describe("AuditLogger onLog callback", () => {
	test("fires callback on each log call", () => {
		const logger = new AuditLogger();
		const received: AuditEntry[] = [];
		logger.onLog = (entry) => received.push(entry);
		logger.log({ action: "test:action", source: "test", detail: "hello", success: true });
		expect(received).toHaveLength(1);
		expect(received[0]!.action).toBe("test:action");
		expect(received[0]!.timestamp).toBeInstanceOf(Date);
	});

	test("callback receives the full entry with timestamp", () => {
		const logger = new AuditLogger();
		let captured: AuditEntry | null = null;
		logger.onLog = (entry) => { captured = entry; };
		logger.log({ action: "a", source: "s", detail: "d", success: false });
		expect(captured).not.toBeNull();
		expect(captured!.success).toBe(false);
		expect(captured!.detail).toBe("d");
	});

	test("works without callback set", () => {
		const logger = new AuditLogger();
		// Should not throw
		logger.log({ action: "a", source: "s", detail: "d", success: true });
		expect(logger.entries()).toHaveLength(1);
	});

	test("callback errors do not prevent logging", () => {
		const logger = new AuditLogger();
		logger.onLog = () => { throw new Error("callback boom"); };
		logger.log({ action: "a", source: "s", detail: "d", success: true });
		expect(logger.entries()).toHaveLength(1);
	});

	test("callback can be reassigned", () => {
		const logger = new AuditLogger();
		const first: string[] = [];
		const second: string[] = [];
		logger.onLog = (e) => first.push(e.action);
		logger.log({ action: "one", source: "s", detail: "d", success: true });
		logger.onLog = (e) => second.push(e.action);
		logger.log({ action: "two", source: "s", detail: "d", success: true });
		expect(first).toEqual(["one"]);
		expect(second).toEqual(["two"]);
	});

	test("callback can be cleared by setting to undefined", () => {
		const logger = new AuditLogger();
		const received: AuditEntry[] = [];
		logger.onLog = (entry) => received.push(entry);
		logger.log({ action: "a", source: "s", detail: "d", success: true });
		logger.onLog = undefined;
		logger.log({ action: "b", source: "s", detail: "d", success: true });
		expect(received).toHaveLength(1);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/audit-logger-callback.test.ts`
Expected: FAIL — `onLog` property does not exist

**Step 3: Add onLog callback to AuditLogger**

Modify `src/audit/logger.ts`. The full file should become:

```typescript
import type { AuditEntry, AuditFilter } from "./types.ts";

// Circular buffer replaces Array.shift() (O(n)) with O(1) insertion.
export class AuditLogger {
	private static readonly MAX_ENTRIES = 10_000;
	private buffer: (AuditEntry | undefined)[];
	private head = 0;
	private count = 0;

	onLog?: (entry: AuditEntry) => void;

	constructor() {
		this.buffer = new Array(AuditLogger.MAX_ENTRIES);
	}

	log(entry: Omit<AuditEntry, "timestamp">): void {
		const full: AuditEntry = { ...entry, timestamp: new Date() };
		this.buffer[this.head] = full;
		this.head = (this.head + 1) % AuditLogger.MAX_ENTRIES;
		if (this.count < AuditLogger.MAX_ENTRIES) this.count++;
		if (this.onLog) {
			try {
				this.onLog(full);
			} catch {
				// Isolate callback errors from logging
			}
		}
	}

	entries(filter?: AuditFilter): AuditEntry[] {
		const result: AuditEntry[] = [];
		const start =
			this.count < AuditLogger.MAX_ENTRIES
				? 0
				: this.head;
		for (let i = 0; i < this.count; i++) {
			const idx = (start + i) % AuditLogger.MAX_ENTRIES;
			const e = this.buffer[idx]!;
			if (filter?.source && e.source !== filter.source) continue;
			if (filter?.action && e.action !== filter.action) continue;
			if (filter?.since && e.timestamp < filter.since) continue;
			result.push(e);
		}
		return result;
	}

	clear(): void {
		this.buffer = new Array(AuditLogger.MAX_ENTRIES);
		this.head = 0;
		this.count = 0;
	}
}
```

**Step 4: Run new tests to verify they pass**

Run: `bun test tests/unit/audit-logger-callback.test.ts`
Expected: All 6 tests PASS

**Step 5: Run existing audit tests to verify no regression**

Run: `bun test tests/unit/audit.test.ts`
Expected: All 5 tests PASS

**Step 6: Commit**

```bash
git add src/audit/logger.ts tests/unit/audit-logger-callback.test.ts
git commit -m "feat(audit): add onLog callback to AuditLogger for real-time log streaming"
```

---

### Task 4: AppState Toggle

**Files:**
- Modify: `src/cli/tui/state.ts`
- Existing test: `tests/unit/tui-state.test.ts`

**Step 1: Write the failing tests**

Append to `tests/unit/tui-state.test.ts` — add a new `describe` block at the end:

```typescript
describe("logPanelVisible", () => {
	test("initialState has logPanelVisible false", () => {
		expect(initialState.logPanelVisible).toBe(false);
	});

	test("toggle-log-panel flips false to true", () => {
		const state = appReducer(initialState, { type: "toggle-log-panel" });
		expect(state.logPanelVisible).toBe(true);
	});

	test("toggle-log-panel flips true back to false", () => {
		let state = appReducer(initialState, { type: "toggle-log-panel" });
		state = appReducer(state, { type: "toggle-log-panel" });
		expect(state.logPanelVisible).toBe(false);
	});

	test("toggle-log-panel does not affect other state", () => {
		const msg = createMessage("user", "Hello");
		let state = appReducer(initialState, { type: "add-message", message: msg });
		state = appReducer(state, { type: "set-thinking", value: true });
		state = appReducer(state, { type: "toggle-log-panel" });
		expect(state.messages).toHaveLength(1);
		expect(state.isThinking).toBe(true);
		expect(state.logPanelVisible).toBe(true);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: FAIL — `logPanelVisible` undefined, `toggle-log-panel` type error

**Step 3: Update AppState and reducer**

Modify `src/cli/tui/state.ts`. Add `logPanelVisible` to `AppState`, the action type, initial state, and reducer case:

In the `AppState` interface, add:
```typescript
logPanelVisible: boolean;
```

In the `AppAction` union, add:
```typescript
| { type: "toggle-log-panel" }
```

In `initialState`, add:
```typescript
logPanelVisible: false,
```

In `appReducer`, add case:
```typescript
case "toggle-log-panel":
    return { ...state, logPanelVisible: !state.logPanelVisible };
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: All tests PASS (existing + 4 new)

**Step 5: Commit**

```bash
git add src/cli/tui/state.ts tests/unit/tui-state.test.ts
git commit -m "feat(tui): add logPanelVisible toggle to AppState reducer"
```

---

### Task 5: Log Formatting Helpers

**Files:**
- Test: `tests/unit/tui-log-panel.test.ts`
- Create: `src/cli/tui/components/log-panel.tsx` (helpers first, component later)

**Step 1: Write the failing tests for formatting helpers**

```typescript
// tests/unit/tui-log-panel.test.ts
import { describe, test, expect } from "bun:test";
import { formatTimestamp, levelIcon, levelColor } from "../../src/cli/tui/components/log-panel.tsx";
import { PALETTE } from "../../src/cli/tui/theme.ts";

describe("formatTimestamp", () => {
	test("formats as HH:MM:SS", () => {
		const date = new Date("2026-02-24T14:03:05.000Z");
		const result = formatTimestamp(date);
		// Exact output depends on timezone, so just check format pattern
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});

	test("pads single digits", () => {
		// Create date at 1:02:03 local time
		const date = new Date();
		date.setHours(1, 2, 3, 0);
		const result = formatTimestamp(date);
		expect(result).toBe("01:02:03");
	});
});

describe("levelIcon", () => {
	test("returns ● for info", () => {
		expect(levelIcon("info")).toBe("●");
	});

	test("returns ✓ for success", () => {
		expect(levelIcon("success")).toBe("✓");
	});

	test("returns ⚠ for warning", () => {
		expect(levelIcon("warning")).toBe("⚠");
	});

	test("returns ✗ for error", () => {
		expect(levelIcon("error")).toBe("✗");
	});
});

describe("levelColor", () => {
	test("info returns amberPrimary", () => {
		expect(levelColor("info")).toBe(PALETTE.amberPrimary);
	});

	test("success returns success color", () => {
		expect(levelColor("success")).toBe(PALETTE.success);
	});

	test("warning returns warning color", () => {
		expect(levelColor("warning")).toBe(PALETTE.warning);
	});

	test("error returns error color", () => {
		expect(levelColor("error")).toBe(PALETTE.error);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-log-panel.test.ts`
Expected: FAIL — module not found

**Step 3: Create log-panel.tsx with exported helpers**

```typescript
// src/cli/tui/components/log-panel.tsx
import { PALETTE } from "../theme.ts";
import type { LogLevel, LogEntry } from "../log-types.ts";
import { LOG_ICONS } from "../log-types.ts";

export function formatTimestamp(date: Date): string {
	const h = String(date.getHours()).padStart(2, "0");
	const m = String(date.getMinutes()).padStart(2, "0");
	const s = String(date.getSeconds()).padStart(2, "0");
	return `${h}:${m}:${s}`;
}

export function levelIcon(level: LogLevel): string {
	return LOG_ICONS[level];
}

const LEVEL_COLORS: Record<LogLevel, string> = {
	info: PALETTE.amberPrimary,
	success: PALETTE.success,
	warning: PALETTE.warning,
	error: PALETTE.error,
};

export function levelColor(level: LogLevel): string {
	return LEVEL_COLORS[level];
}

// LogPanel component placeholder — implemented in Task 6
interface LogPanelProps {
	entries: LogEntry[];
	width: number;
}

export function LogPanel({ entries, width }: LogPanelProps) {
	return (
		<box
			width={width}
			height="100%"
			flexDirection="column"
			backgroundColor={PALETTE.surface}
			borderLeft={1}
			borderColor={PALETTE.borderDim}
		>
			<text color={PALETTE.amberDim}>{" LOGS " + "─".repeat(Math.max(0, width - 8))}</text>
			<box flexDirection="column" flexGrow={1} overflow="scroll">
				{entries.map((entry) => (
					<text key={entry.id}>
						<text color={PALETTE.textMuted}>{formatTimestamp(entry.timestamp)}</text>
						{" "}
						<text color={PALETTE.amberDim}>[{entry.source}]</text>
						{" "}
						<text color={levelColor(entry.level)}>{levelIcon(entry.level)}</text>
						{" "}
						<text color={PALETTE.textPrimary}>{entry.message}</text>
						{entry.detail ? <text color={PALETTE.textMuted}> — {entry.detail}</text> : null}
					</text>
				))}
			</box>
		</box>
	);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-log-panel.test.ts`
Expected: All 8 tests PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli/tui/components/log-panel.tsx tests/unit/tui-log-panel.test.ts
git commit -m "feat(tui): add LogPanel component with formatting helpers"
```

---

### Task 6: Wire LogPanel Into FridayApp

**Files:**
- Modify: `src/cli/tui/app.tsx`

This is the integration task — wiring all pieces together. No new test file because this is UI integration code that would require a running OpenTUI renderer. The individual units (LogStore, AuditLogger callback, state toggle, formatting) are already tested.

**Step 1: Add imports to app.tsx**

At the top of `src/cli/tui/app.tsx`, add these imports alongside the existing ones:

```typescript
import { LogStore } from "./log-store.ts";
import { LogPanel } from "./components/log-panel.tsx";
import type { LogEntry } from "./log-types.ts";
import type { AuditEntry } from "../../audit/types.ts";
```

**Step 2: Add LogStore ref and audit-to-log mapping in FridayApp**

Inside `FridayApp`, after the existing refs (around line 58, after `const [bootComplete, setBootComplete] = useState(false);`), add:

```typescript
const logStoreRef = useRef(new LogStore());
const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
```

Add a helper function inside the component for mapping audit entries to log entries:

```typescript
const pushLog = useCallback((level: LogEntry["level"], source: string, message: string, detail?: string) => {
    const entry: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        level,
        source,
        message,
        detail,
    };
    logStoreRef.current.push(entry);
}, []);
```

Add a useEffect to subscribe to LogStore changes and update React state:

```typescript
useEffect(() => {
    const store = logStoreRef.current;
    const cb = () => setLogEntries([...store.entries]);
    store.subscribe(cb);
    return () => store.unsubscribe(cb);
}, []);
```

**Step 3: Wire AuditLogger.onLog after runtime boot**

Inside the boot `useEffect`, right after `runtimeRef.current = runtime;` (around line 83), add:

```typescript
// Wire audit log callback to LogStore
runtime.audit.onLog = (entry: AuditEntry) => {
    pushLog(
        entry.success ? "success" : "error",
        "audit",
        entry.action,
        entry.detail,
    );
};
```

**Important:** This must be set *before* `runtime.boot()` so it captures boot-time audit entries.

Also, pipe the "Booting Friday..." system message to the log store. After the existing `dispatch({ type: "add-message", message: createMessage("system", "Booting Friday...") })`, add:

```typescript
pushLog("info", "runtime", "Booting Friday...");
```

After `setBootComplete(true)`, add:

```typescript
pushLog("success", "runtime", `Friday online. (${providerLabel}: ${modelLabel}, ${toolCount} tools)`);
```

In the boot catch block, after the error dispatch, add:

```typescript
pushLog("error", "runtime", `Boot failed: ${msg}`);
```

**Step 4: Wire Ctrl+L keybinding**

Add a `useEffect` for the keyboard listener. Place it after the existing `useEffect` blocks:

```typescript
useEffect(() => {
    const handler = (data: Buffer) => {
        // Ctrl+L is 0x0c
        if (data.length === 1 && data[0] === 0x0c) {
            dispatch({ type: "toggle-log-panel" });
        }
    };
    process.stdin.on("data", handler);
    return () => { process.stdin.off("data", handler); };
}, []);
```

**Note:** If OpenTUI already intercepts stdin, this may need to use the renderer's key event system instead. Check if `renderer.onKeyPress` or similar exists. If stdin interception doesn't work, use a `onKeyDown` prop on the root `<box>` element:

```typescript
<box
    ...existing props...
    onKeyDown={(event) => {
        if (event.ctrl && event.key === "l") {
            dispatch({ type: "toggle-log-panel" });
        }
    }}
>
```

**Step 5: Update the JSX layout**

Replace the current return JSX (the main active-phase layout, around line 387-410) with:

```typescript
const panelWidth = Math.min(60, Math.floor(renderer.width * 0.3));

return (
    <box
        flexDirection="column"
        width="100%"
        height="100%"
        backgroundColor={PALETTE.background}
        shouldFill
        onMouseUp={handleMouseUp}
    >
        <Header provider={provider} model={model} />
        <box flexDirection="row" flexGrow={1}>
            <box flexDirection="column" flexGrow={1}>
                <ChatArea
                    messages={state.messages}
                    isThinking={state.isThinking}
                    welcomeInfo={state.welcomeInfo}
                />
                <InputBar
                    commands={commandsRef.current}
                    disabled={inputDisabled}
                    placeholder={placeholder}
                    onSubmit={handleSubmit}
                    onExit={handleShutdown}
                />
            </box>
            {state.logPanelVisible && (
                <LogPanel entries={logEntries} width={panelWidth} />
            )}
        </box>
    </box>
);
```

**Step 6: Also pipe shutdown lifecycle events to logs**

In the `handleShutdown` callback, after each shutdown dispatch, also call `pushLog`. For example, in the shutdown progress callback:

```typescript
await runtime.shutdown((_, label) => {
    dispatch({
        type: "add-message",
        message: createMessage("system", label),
    });
    pushLog("info", "runtime", label);
});
```

And after "Shutdown complete.":
```typescript
pushLog("success", "runtime", "Shutdown complete.");
```

**Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 8: Run all existing tests to verify no regression**

Run: `bun test`
Expected: All tests PASS

**Step 9: Run lint**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed

**Step 10: Commit**

```bash
git add src/cli/tui/app.tsx
git commit -m "feat(tui): wire LogPanel into FridayApp with Ctrl+L toggle and audit/lifecycle streaming"
```

---

### Task 7: Full Test Suite Verification

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests PASS (existing 735 + ~24 new = ~759)

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `bun run lint:fix`
Expected: Clean

**Step 4: Manual smoke test (optional)**

Run: `bun run dev`
- Verify Friday boots normally
- Press `Ctrl+L` — log panel should appear on the right
- Press `Ctrl+L` again — panel should disappear
- With panel open, send a message — audit entries should appear as tools execute
- Verify chat area resizes correctly when panel toggles

**Step 5: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: lint fixes for log panel integration"
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| 1. Log Types | `src/cli/tui/log-types.ts` | (type-only, no test) |
| 2. LogStore | `src/cli/tui/log-store.ts` | 10 tests |
| 3. AuditLogger onLog | `src/audit/logger.ts` | 6 tests |
| 4. AppState Toggle | `src/cli/tui/state.ts` | 4 tests |
| 5. Log Formatting Helpers | `src/cli/tui/components/log-panel.tsx` | 8 tests |
| 6. Wire Into FridayApp | `src/cli/tui/app.tsx` | (integration, existing units tested) |
| 7. Full Verification | (none) | Run all ~759 tests |

**Total new tests:** ~28
**Total new files:** 3
**Total modified files:** 3
