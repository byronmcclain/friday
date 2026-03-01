# Tool-Aware Thinking Indicator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the currently executing tool name and args in the TUI's thinking indicator (Claude Code style).

**Architecture:** Cortex emits a `tool:executing` signal via SignalBus → Server forwards it as a WebSocket `signal` message → SocketBridge surfaces it via callback → TUI state tracks `currentTool` → ThinkingIndicator renders tool name + compact args.

**Tech Stack:** TypeScript, OpenTUI React, SignalBus events, WebSocket protocol, bun:test

---

### Task 1: Add `tool:executing` signal type and Cortex emission

**Files:**
- Modify: `src/core/events.ts:1-13` (SignalName union)
- Modify: `src/core/cortex.ts:276-282` (tool execute wrapper)
- Test: `tests/unit/cortex-tools.test.ts`

**Step 1: Write the failing test**

Add to `tests/unit/cortex-tools.test.ts` after the existing imports:

```typescript
import { SignalBus } from "../../src/core/events.ts";
```

Add this test inside the `describe("Cortex — tool integration (AI SDK path)")` block:

```typescript
test("emits tool:executing signal before tool execution", async () => {
	const signals = new SignalBus();
	const emitted: { name: string; source: string; data?: Record<string, unknown> }[] = [];
	signals.on("tool:executing", (signal) => {
		emitted.push({ name: signal.name, source: signal.source, data: signal.data });
	});

	const tool = mockTool({
		name: "fs.read",
		execute: async (args) => ({ success: true, output: `read: ${args.input}` }),
	});

	const model = createMockModel({
		text: "Done reading",
		toolCalls: [{ name: "fs.read", args: { input: "/tmp/test.txt" } }],
	});

	const cortex = new Cortex({ injectedModel: model, signals, maxToolIterations: 1 });
	cortex.registerTool(tool);

	await cortex.chat("Read the file");

	expect(emitted).toHaveLength(1);
	expect(emitted[0]!.name).toBe("tool:executing");
	expect(emitted[0]!.source).toBe("fs.read");
	expect(emitted[0]!.data?.args).toEqual({ input: "/tmp/test.txt" });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/cortex-tools.test.ts`
Expected: FAIL — `"tool:executing"` is not a valid `SignalName` (TypeScript error) and signal is never emitted.

**Step 3: Add `tool:executing` to SignalName**

In `src/core/events.ts`, add to the `SignalName` union:

```typescript
export type SignalName =
  | "file:changed"
  | "file:created"
  | "file:deleted"
  | "test:passed"
  | "test:failed"
  | "command:pre-execute"
  | "command:post-execute"
  | "command:pre-commit"
  | "session:start"
  | "session:end"
  | "error:unhandled"
  | "tool:executing"
  | `custom:${string}`;
```

**Step 4: Emit signal in Cortex tool execute wrapper**

In `src/core/cortex.ts`, inside `buildAiTools()` → `execute` callback, add the signal emission right after the existing `tool:called` audit log (line 282) and before the `try` block (line 283):

```typescript
				this.audit?.log({
					action: "tool:called",
					source: name,
					detail: `Tool invoked by LLM`,
					success: true,
				});
				await this.signals?.emit("tool:executing", name, { args });
				try {
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/unit/cortex-tools.test.ts`
Expected: ALL PASS

**Step 6: Run full test suite**

Run: `bun test`
Expected: ALL PASS (no regressions)

**Step 7: Commit**

```bash
git add src/core/events.ts src/core/cortex.ts tests/unit/cortex-tools.test.ts
git commit -m "feat(tui): add tool:executing signal type and Cortex emission"
```

---

### Task 2: Forward tool:executing signals in WebSocketHandler

**Files:**
- Modify: `src/server/handler.ts:1-10` (imports), `116-148` (handleIdentify), `72-77` (disconnect)

**Step 1: Add signal handler storage to WebSocketHandler**

In `src/server/handler.ts`, add a private field for the signal handler cleanup:

```typescript
private toolSignalHandler: ((signal: import("../core/events.ts").Signal) => void) | null = null;
```

**Step 2: Subscribe in handleIdentify**

In `handleIdentify()`, after the notification channel wiring (after line 140) and before the `send({ type: "session:ready" ...})` call:

```typescript
		// Forward tool:executing signals to this client for TUI thinking indicator
		if (this.runtime.signals) {
			this.toolSignalHandler = (signal) => {
				send({
					type: "signal",
					name: signal.name,
					source: signal.source,
					data: signal.data,
				});
			};
			this.runtime.signals.on("tool:executing", this.toolSignalHandler);
		}
```

**Step 3: Cleanup in disconnect**

In `disconnect()`, after the notification channel removal and before the closing brace:

```typescript
		// Unsubscribe tool signal handler
		if (this.toolSignalHandler && this.runtime.signals) {
			this.runtime.signals.off("tool:executing", this.toolSignalHandler);
			this.toolSignalHandler = null;
		}
```

**Step 4: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/server/handler.ts
git commit -m "feat(server): forward tool:executing signals to connected clients"
```

---

### Task 3: Add `onToolExecuting` callback to SocketBridge

**Files:**
- Modify: `src/core/bridges/socket.ts:15-16` (callback field), `200-209` (handleServerMessage)
- Test: `tests/unit/socket-bridge.test.ts`

**Step 1: Write the failing tests**

Add these tests to `tests/unit/socket-bridge.test.ts` inside the existing `describe("SocketBridge")` block:

```typescript
	test("fires onToolExecuting for tool:executing signal messages", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: { name: string; args: Record<string, unknown> }[] = [];
		bridge.onToolExecuting = (name, args) => received.push({ name, args });

		(bridge as any).handleServerMessage({
			type: "signal",
			name: "tool:executing",
			source: "fs.read",
			data: { args: { path: "/tmp/test.txt" } },
		});

		expect(received).toHaveLength(1);
		expect(received[0]!.name).toBe("fs.read");
		expect(received[0]!.args).toEqual({ path: "/tmp/test.txt" });
	});

	test("does not throw when onToolExecuting is not set", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");

		(bridge as any).handleServerMessage({
			type: "signal",
			name: "tool:executing",
			source: "git.status",
			data: { args: {} },
		});
	});

	test("ignores non-tool:executing signal messages", () => {
		const bridge = new SocketBridge("/tmp/nonexistent.sock");
		const received: any[] = [];
		bridge.onToolExecuting = (name, args) => received.push({ name, args });

		(bridge as any).handleServerMessage({
			type: "signal",
			name: "file:changed",
			source: "watcher",
			data: { path: "/tmp/foo" },
		});

		expect(received).toHaveLength(0);
	});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: FAIL — `onToolExecuting` property does not exist.

**Step 3: Add callback field and message routing**

In `src/core/bridges/socket.ts`, add the callback field after `onAuditEntry` (line 16):

```typescript
  onToolExecuting?: (name: string, args: Record<string, unknown>) => void;
```

In `handleServerMessage()`, add signal routing after the `audit:entry` handler (after line 209) and before the `requestId` extraction:

```typescript
    if (msg.type === "signal" && msg.name === "tool:executing") {
      this.onToolExecuting?.(msg.source, (msg.data?.args as Record<string, unknown>) ?? {});
      return;
    }
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/socket-bridge.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/bridges/socket.ts tests/unit/socket-bridge.test.ts
git commit -m "feat(bridge): add onToolExecuting callback to SocketBridge"
```

---

### Task 4: Add `currentTool` to TUI state

**Files:**
- Modify: `src/cli/tui/state.ts` (AppState, AppAction, reducer, initialState)
- Test: `tests/unit/tui-state.test.ts`

**Step 1: Write the failing tests**

Add these tests to `tests/unit/tui-state.test.ts`. Add a new `describe("currentTool")` block after the `logPanelVisible` describe:

```typescript
describe("currentTool", () => {
	test("initialState has currentTool null", () => {
		expect(initialState.currentTool).toBeNull();
	});

	test("tool:executing sets currentTool", () => {
		const state = appReducer(initialState, {
			type: "tool:executing",
			name: "fs.read",
			args: { path: "/tmp/test.txt" },
		});
		expect(state.currentTool).toEqual({ name: "fs.read", args: { path: "/tmp/test.txt" } });
	});

	test("tool:executing replaces previous tool (latest only)", () => {
		let state = appReducer(initialState, {
			type: "tool:executing",
			name: "fs.read",
			args: { path: "/tmp/a.txt" },
		});
		state = appReducer(state, {
			type: "tool:executing",
			name: "git.status",
			args: {},
		});
		expect(state.currentTool).toEqual({ name: "git.status", args: {} });
	});

	test("chat:chunk clears currentTool", () => {
		let state = appReducer(initialState, {
			type: "tool:executing",
			name: "fs.read",
			args: { path: "/tmp/test.txt" },
		});
		expect(state.currentTool).not.toBeNull();
		state = appReducer(state, { type: "chat:chunk", text: "Hello" });
		expect(state.currentTool).toBeNull();
	});

	test("set-thinking false clears currentTool", () => {
		let state = appReducer(initialState, {
			type: "tool:executing",
			name: "fs.read",
			args: { path: "/tmp/test.txt" },
		});
		expect(state.currentTool).not.toBeNull();
		state = appReducer(state, { type: "set-thinking", value: false });
		expect(state.currentTool).toBeNull();
	});

	test("set-thinking true does not affect currentTool", () => {
		const state = appReducer(initialState, { type: "set-thinking", value: true });
		expect(state.currentTool).toBeNull();
	});

	test("tool:executing does not affect other state fields", () => {
		const msg = createMessage("user", "Hello");
		let state = appReducer(initialState, { type: "add-message", message: msg });
		state = appReducer(state, { type: "set-thinking", value: true });
		state = appReducer(state, {
			type: "tool:executing",
			name: "fs.read",
			args: { path: "/tmp/test.txt" },
		});
		expect(state.messages).toHaveLength(1);
		expect(state.isThinking).toBe(true);
		expect(state.currentTool).not.toBeNull();
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: FAIL — `currentTool` does not exist on `AppState`, `tool:executing` is not a valid action type.

**Step 3: Add currentTool to AppState and reducer**

In `src/cli/tui/state.ts`:

Add `currentTool` to `AppState`:

```typescript
export interface AppState {
	phase: "splash" | "booting" | "active" | "shutting-down";
	messages: Message[];
	isThinking: boolean;
	isStreaming: boolean;
	welcomeInfo?: WelcomeInfo;
	logPanelVisible: boolean;
	currentTool: { name: string; args: Record<string, unknown> } | null;
}
```

Add `tool:executing` to `AppAction`:

```typescript
export type AppAction =
	| { type: "add-message"; message: Message }
	| { type: "chat:chunk"; text: string }
	| { type: "chat:done" }
	| { type: "set-thinking"; value: boolean }
	| { type: "set-phase"; phase: AppState["phase"] }
	| { type: "set-welcome"; info: WelcomeInfo }
	| { type: "clear-messages" }
	| { type: "toggle-log-panel" }
	| { type: "tool:executing"; name: string; args: Record<string, unknown> };
```

Add `currentTool: null` to `initialState`:

```typescript
export const initialState: AppState = {
	phase: "splash",
	messages: [],
	isThinking: false,
	isStreaming: false,
	logPanelVisible: false,
	currentTool: null,
};
```

Update the reducer — modify the `chat:chunk` case to also clear `currentTool`:

```typescript
		case "chat:chunk": {
			const msgs = [...state.messages];
			const last = msgs[msgs.length - 1];
			if (last && last.role === "assistant") {
				msgs[msgs.length - 1] = { ...last, content: last.content + action.text };
			} else {
				msgs.push({
					id: crypto.randomUUID(),
					role: "assistant",
					content: action.text,
					timestamp: new Date(),
				});
			}
			return { ...state, messages: msgs, isThinking: false, isStreaming: true, currentTool: null };
		}
```

Modify the `set-thinking` case to clear `currentTool` when setting to false:

```typescript
		case "set-thinking":
			return {
				...state,
				isThinking: action.value,
				...(action.value ? {} : { currentTool: null }),
			};
```

Add the new `tool:executing` case before the closing of the switch:

```typescript
		case "tool:executing":
			return { ...state, currentTool: { name: action.name, args: action.args } };
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/tui-state.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/cli/tui/state.ts tests/unit/tui-state.test.ts
git commit -m "feat(tui): add currentTool tracking to TUI state"
```

---

### Task 5: Update ThinkingIndicator to render tool info

**Files:**
- Modify: `src/cli/tui/components/thinking.tsx` (accept props, add formatToolSummary)

**Step 1: Update ThinkingIndicator component**

Replace the content of `src/cli/tui/components/thinking.tsx` with:

```tsx
import { useState, useEffect } from "react";
import { PALETTE, BOLD } from "../theme.ts";

const BRAILLE_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

interface ThinkingProps {
	currentTool?: { name: string; args: Record<string, unknown> } | null;
}

function formatToolSummary(name: string, args: Record<string, unknown>): string {
	for (const v of Object.values(args)) {
		if (typeof v === "string" && v.length > 0) {
			const display = v.length > 50 ? v.slice(0, 47) + "..." : v;
			return `${name} ${display}`;
		}
	}
	return name;
}

export function ThinkingIndicator({ currentTool }: ThinkingProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrame((f: number) => (f + 1) % BRAILLE_FRAMES.length);
		}, 80);
		return () => clearInterval(interval);
	}, []);

	const label = currentTool
		? formatToolSummary(currentTool.name, currentTool.args)
		: "thinking...";

	return (
		<box flexDirection="column" paddingLeft={1} gap={0}>
			<text fg={PALETTE.amberPrimary} bg={PALETTE.surfaceLight} attributes={BOLD}>
				{" Friday "}
			</text>
			<box paddingLeft={1}>
				<text fg={PALETTE.amberDim}>
					{`${BRAILLE_FRAMES[frame]} ${label}`}
				</text>
			</box>
		</box>
	);
}

export { formatToolSummary };
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors (props are optional, so existing callers still work)

**Step 3: Commit**

```bash
git add src/cli/tui/components/thinking.tsx
git commit -m "feat(tui): render tool name and args in ThinkingIndicator"
```

---

### Task 6: Add unit tests for formatToolSummary

**Files:**
- Create: `tests/unit/tui-thinking.test.ts`

**Step 1: Write the tests**

Create `tests/unit/tui-thinking.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { formatToolSummary } from "../../src/cli/tui/components/thinking.tsx";

describe("formatToolSummary", () => {
	test("returns tool name with first string arg", () => {
		expect(formatToolSummary("fs.read", { path: "src/core/cortex.ts" })).toBe(
			"fs.read src/core/cortex.ts",
		);
	});

	test("returns just tool name when no string args", () => {
		expect(formatToolSummary("git.status", {})).toBe("git.status");
	});

	test("returns just tool name when args are non-string", () => {
		expect(formatToolSummary("git.log", { limit: 5 })).toBe("git.log");
	});

	test("truncates long string args at 50 chars", () => {
		const longPath = "a".repeat(60);
		const result = formatToolSummary("fs.read", { path: longPath });
		expect(result).toBe(`fs.read ${"a".repeat(47)}...`);
		expect(result.length).toBe("fs.read ".length + 50);
	});

	test("skips empty string args", () => {
		expect(formatToolSummary("test.tool", { empty: "", name: "hello" })).toBe(
			"test.tool hello",
		);
	});

	test("picks first string arg when multiple exist", () => {
		const result = formatToolSummary("gmail.search", {
			query: "subject:invoice",
			maxResults: "10",
		});
		expect(result).toBe("gmail.search subject:invoice");
	});

	test("does not truncate string args at exactly 50 chars", () => {
		const exactPath = "a".repeat(50);
		const result = formatToolSummary("fs.read", { path: exactPath });
		expect(result).toBe(`fs.read ${exactPath}`);
	});
});
```

**Step 2: Run tests to verify they pass**

Run: `bun test tests/unit/tui-thinking.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add tests/unit/tui-thinking.test.ts
git commit -m "test(tui): add formatToolSummary unit tests"
```

---

### Task 7: Wire app.tsx and chat-area.tsx

**Files:**
- Modify: `src/cli/tui/components/chat-area.tsx:18-23` (ChatAreaProps), `76` (ThinkingIndicator usage)
- Modify: `src/cli/tui/app.tsx:130-135` (onToolExecuting wiring), `371-376` (ChatArea props)

**Step 1: Update ChatArea to pass currentTool**

In `src/cli/tui/components/chat-area.tsx`, add `currentTool` to the props interface:

```typescript
interface ChatAreaProps {
	messages: MessageType[];
	isThinking: boolean;
	isStreaming: boolean;
	welcomeInfo?: WelcomeInfo;
	currentTool?: { name: string; args: Record<string, unknown> } | null;
}
```

Update the function signature to destructure the new prop:

```typescript
export function ChatArea({ messages, isThinking, isStreaming, welcomeInfo, currentTool }: ChatAreaProps) {
```

Update the ThinkingIndicator usage (line 76) to pass the prop:

```tsx
			{isThinking && <ThinkingIndicator currentTool={currentTool} />}
```

**Step 2: Wire onToolExecuting in app.tsx**

In `src/cli/tui/app.tsx`, inside the boot `useEffect`, after the `socketBridge.onAuditEntry` wiring (after line 135) add:

```typescript
				// Wire tool-executing signals from the server into the TUI state
				socketBridge.onToolExecuting = (name, args) => {
					if (cancelled) return;
					dispatch({ type: "tool:executing", name, args });
				};
```

In the JSX, update the `ChatArea` component to pass `currentTool` (around line 371):

```tsx
					<ChatArea
						messages={state.messages}
						isThinking={state.isThinking}
						isStreaming={state.isStreaming}
						welcomeInfo={state.welcomeInfo}
						currentTool={state.currentTool}
					/>
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 4: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/cli/tui/components/chat-area.tsx src/cli/tui/app.tsx
git commit -m "feat(tui): wire tool:executing events through to ThinkingIndicator"
```

---

### Task 8: Final verification and lint

**Step 1: Run linter**

Run: `bun run lint:fix`
Expected: No errors (or auto-fixed)

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

**Step 3: Run full test suite**

Run: `bun test`
Expected: ALL PASS

**Step 4: Commit any lint fixes**

```bash
git add -A && git diff --cached --quiet || git commit -m "style: lint fixes for tool-aware thinking indicator"
```
