# Protocol Clearance Enforcement — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce clearance checks on protocol execution so `/commands` and directive-dispatched protocols/tools respect the `clearance` field they already declare.

**Architecture:** Inline clearance gates at the two ungated call sites in `runtime.ts` (process() and onDirectiveAction), matching the existing Cortex pattern. Audit logging for denied executions.

**Tech Stack:** TypeScript, bun:test, ClearanceManager, AuditLogger

---

## Design (Approved)

Protocols declare a `clearance` field on `FridayProtocol`, but it's never checked at execution time. Two call sites bypass clearance:

1. **`runtime.process()`** — user-initiated `/commands` call `protocol.execute()` directly with no clearance gate.
2. **Directive `onDirectiveAction` handler** — `type: "protocol"` and `type: "tool"` dispatch without checking the target's own clearance.

All other execution paths enforce clearance: Cortex tools (cortex.ts:244), DirectiveEngine (engine.ts:95), Arc Rhythm executor (executor.ts:43), and Vox (vox.ts:80).

**Affected Protocols:**

| Protocol | Clearance | Impact |
|----------|-----------|--------|
| `/gmail` | `["network"]` | Now enforced |
| `/smart` | `["read-fs"]` | Now enforced |
| `/history` | `[]` | No change (empty clearance = no check) |
| `/env` | `[]` | No change |
| `/voice` | `[]` | No change |
| `/arc` | `[]` | No change |

---

### Task 1: Test protocol clearance enforcement in `runtime.process()`

**Files:**
- Create: `tests/unit/protocol-clearance.test.ts`

**Step 1: Write failing tests for protocol clearance in process()**

Create `tests/unit/protocol-clearance.test.ts`:

```ts
import { describe, test, expect, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { createMockModel } from "../helpers/stubs.ts";
import type { FridayProtocol } from "../../src/modules/types.ts";

describe("Protocol clearance enforcement", () => {
	let runtime: FridayRuntime;

	afterEach(async () => {
		if (runtime?.isBooted) await runtime.shutdown();
	});

	test("blocks protocol when required clearance is not granted", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		// Revoke the clearance the protocol requires
		runtime.clearance.revoke("network");
		runtime.protocols.register({
			name: "gated",
			description: "needs network",
			aliases: [],
			parameters: [],
			clearance: ["network"],
			execute: async () => ({ success: true, summary: "should not run" }),
		} satisfies FridayProtocol);
		const result = await runtime.process("/gated");
		expect(result.output).toContain("Clearance denied");
		expect(result.output).toContain("network");
		expect(result.source).toBe("protocol");
	});

	test("executes protocol when required clearance is granted", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.protocols.register({
			name: "allowed",
			description: "needs network",
			aliases: [],
			parameters: [],
			clearance: ["network"],
			execute: async () => ({ success: true, summary: "executed ok" }),
		} satisfies FridayProtocol);
		const result = await runtime.process("/allowed");
		expect(result.output).toContain("executed ok");
	});

	test("executes protocol with empty clearance without checking", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.protocols.register({
			name: "open",
			description: "no clearance needed",
			aliases: [],
			parameters: [],
			clearance: [],
			execute: async () => ({ success: true, summary: "open access" }),
		} satisfies FridayProtocol);
		const result = await runtime.process("/open");
		expect(result.output).toContain("open access");
	});

	test("logs protocol:blocked audit entry when clearance denied", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		runtime.clearance.revoke("exec-shell");
		runtime.protocols.register({
			name: "audited",
			description: "needs exec-shell",
			aliases: [],
			parameters: [],
			clearance: ["exec-shell"],
			execute: async () => ({ success: true, summary: "should not run" }),
		} satisfies FridayProtocol);
		await runtime.process("/audited");
		const entries = runtime.audit.entries.filter(
			(e) => e.action === "protocol:blocked",
		);
		expect(entries.length).toBeGreaterThanOrEqual(1);
		expect(entries[0].source).toBe("audited");
		expect(entries[0].success).toBe(false);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/protocol-clearance.test.ts`
Expected: FAIL — `runtime.clearance` does not exist as a public getter yet, and `process()` doesn't check clearance.

**Step 3: Commit failing tests**

```bash
git add tests/unit/protocol-clearance.test.ts
git commit -m "test: add failing tests for protocol clearance enforcement"
```

---

### Task 2: Expose `clearance` getter on FridayRuntime

**Files:**
- Modify: `src/core/runtime.ts` — add public getter near existing getters (~line 115-125)

**Step 1: Add `clearance` getter**

In `src/core/runtime.ts`, after the existing `get audit()` getter (~line 119), add:

```ts
get clearance(): ClearanceManager {
	return this._clearance;
}
```

**Step 2: Run the protocol-clearance tests again**

Run: `bun test tests/unit/protocol-clearance.test.ts`
Expected: Still FAIL — getter compiles but `process()` still doesn't check clearance. The "blocks" and "audit" tests should now fail on the assertion (not compilation), and the "executes" tests should pass.

**Step 3: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat: expose clearance getter on FridayRuntime"
```

---

### Task 3: Add clearance gate to `runtime.process()`

**Files:**
- Modify: `src/core/runtime.ts:504-508` — insert clearance check before `protocol.execute()`

**Step 1: Add the clearance check**

In `runtime.process()`, after line 506 (`if (!protocol)` check) and before line 508 (`const result = await protocol.execute(...)`), insert:

```ts
if (protocol.clearance.length > 0) {
	const check = this._clearance.checkAll(protocol.clearance);
	if (!check.granted) {
		this._audit.log({
			action: "protocol:blocked",
			source: protocol.name,
			detail: check.reason ?? `Clearance denied for protocol: ${protocol.name}`,
			success: false,
		});
		return { output: check.reason ?? `Clearance denied for protocol: ${protocol.name}`, source: "protocol" };
	}
}
```

**Step 2: Run protocol-clearance tests**

Run: `bun test tests/unit/protocol-clearance.test.ts`
Expected: All 4 tests PASS.

**Step 3: Run full test suite to check for regressions**

Run: `bun test`
Expected: All existing tests still pass — because all 12 clearances are granted at boot, no protocol that was previously working will be blocked.

**Step 4: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat: enforce clearance check on protocol execution in process()"
```

---

### Task 4: Test directive action dispatch clearance enforcement

**Files:**
- Modify: `tests/unit/protocol-clearance.test.ts` — add directive dispatch tests

**Step 1: Write failing tests for directive action dispatch**

Append to `tests/unit/protocol-clearance.test.ts`, inside the top-level `describe`:

```ts
describe("Directive action dispatch clearance", () => {
	let runtime: FridayRuntime;

	afterEach(async () => {
		if (runtime?.isBooted) await runtime.shutdown();
	});

	test("blocks directive-dispatched protocol when target clearance denied", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		let executed = false;
		runtime.protocols.register({
			name: "secret",
			description: "needs network",
			aliases: [],
			parameters: [],
			clearance: ["network"],
			execute: async () => {
				executed = true;
				return { success: true, summary: "ran" };
			},
		} satisfies FridayProtocol);
		runtime.clearance.revoke("network");

		// Fire a directive that targets the gated protocol
		runtime.directives.add({
			name: "test-directive",
			description: "test",
			enabled: true,
			trigger: { signal: "custom:test-fire", filter: {} },
			action: { type: "protocol", protocol: "secret", args: { rawArgs: "" } },
			clearance: [], // directive itself has no clearance requirements
		});
		await runtime.signals.emit("custom:test-fire", "test");
		// Give async dispatch a tick to complete
		await new Promise((r) => setTimeout(r, 50));
		expect(executed).toBe(false);
	});

	test("blocks directive-dispatched tool when target clearance denied", async () => {
		runtime = new FridayRuntime();
		await runtime.boot({ injectedModel: createMockModel() });
		let executed = false;
		runtime.cortex.registerTool({
			name: "gated_tool",
			description: "needs exec-shell",
			parameters: [],
			clearance: ["exec-shell"],
			execute: async () => {
				executed = true;
				return { success: true, output: "ran" };
			},
		});
		runtime.clearance.revoke("exec-shell");

		runtime.directives.add({
			name: "test-tool-directive",
			description: "test",
			enabled: true,
			trigger: { signal: "custom:test-tool-fire", filter: {} },
			action: { type: "tool", tool: "gated_tool", args: {} },
			clearance: [],
		});
		await runtime.signals.emit("custom:test-tool-fire", "test");
		await new Promise((r) => setTimeout(r, 50));
		expect(executed).toBe(false);
	});
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/protocol-clearance.test.ts`
Expected: The 2 new directive tests FAIL — the `executed` flag will be `true` because the dispatch doesn't check target clearance yet.

**Step 3: Commit failing tests**

```bash
git add tests/unit/protocol-clearance.test.ts
git commit -m "test: add failing tests for directive dispatch clearance enforcement"
```

---

### Task 5: Add clearance gates to directive `onDirectiveAction` handler

**Files:**
- Modify: `src/core/runtime.ts:195-236` — add clearance checks in `case "protocol"` and `case "tool"`

**Step 1: Add clearance check to `case "protocol":`**

In the `onDirectiveAction` handler, after `if (!protocol) break;` (~line 197), insert:

```ts
if (protocol.clearance.length > 0) {
	const pCheck = this._clearance.checkAll(protocol.clearance);
	if (!pCheck.granted) {
		this._audit.log({
			action: "protocol:blocked",
			source: protocol.name,
			detail: pCheck.reason ?? `Clearance denied for protocol: ${protocol.name}`,
			success: false,
		});
		break;
	}
}
```

**Step 2: Add clearance check to `case "tool":`**

After `if (!tool) break;` (~line 223), insert:

```ts
if (tool.clearance.length > 0) {
	const tCheck = this._clearance.checkAll(tool.clearance);
	if (!tCheck.granted) {
		this._audit.log({
			action: "tool:blocked",
			source: tool.name,
			detail: tCheck.reason ?? `Clearance denied for tool: ${tool.name}`,
			success: false,
		});
		break;
	}
}
```

**Step 3: Run protocol-clearance tests**

Run: `bun test tests/unit/protocol-clearance.test.ts`
Expected: All 6 tests PASS.

**Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass — no regressions.

**Step 5: Commit**

```bash
git add src/core/runtime.ts
git commit -m "feat: enforce clearance on directive-dispatched protocols and tools"
```

---

### Task 6: Final verification and lint

**Step 1: Run lint**

Run: `bun run lint`
Expected: Clean.

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: Clean.

**Step 3: Run full test suite one final time**

Run: `bun test`
Expected: All tests pass.
