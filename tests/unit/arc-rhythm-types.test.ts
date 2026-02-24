// tests/unit/arc-rhythm-types.test.ts
import { describe, test, expect } from "bun:test";
import type {
	Rhythm,
	RhythmAction,
	RhythmExecution,
} from "../../src/arc-rhythm/types.ts";

describe("Arc Rhythm types", () => {
	test("Rhythm interface accepts prompt action", () => {
		const rhythm: Rhythm = {
			id: "r1",
			name: "Morning Check",
			description: "Check git repos",
			cron: "0 9 * * *",
			enabled: true,
			origin: "user",
			action: { type: "prompt", prompt: "Check stale PRs" },
			nextRun: new Date(),
			runCount: 0,
			consecutiveFailures: 0,
			clearance: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		expect(rhythm.id).toBe("r1");
		expect(rhythm.action.type).toBe("prompt");
	});

	test("Rhythm interface accepts tool action", () => {
		const action: RhythmAction = {
			type: "tool",
			tool: "getEnvironmentStatus",
			args: { section: "cpu" },
		};
		expect(action.type).toBe("tool");
	});

	test("Rhythm interface accepts protocol action", () => {
		const action: RhythmAction = {
			type: "protocol",
			protocol: "git",
			args: { rawArgs: "status" },
		};
		expect(action.type).toBe("protocol");
	});

	test("RhythmExecution tracks running state", () => {
		const exec: RhythmExecution = {
			id: "e1",
			rhythmId: "r1",
			startedAt: new Date(),
			status: "running",
		};
		expect(exec.status).toBe("running");
		expect(exec.completedAt).toBeUndefined();
	});

	test("RhythmExecution tracks failure with error", () => {
		const exec: RhythmExecution = {
			id: "e2",
			rhythmId: "r1",
			startedAt: new Date(),
			completedAt: new Date(),
			status: "failure",
			error: "Timeout exceeded",
		};
		expect(exec.status).toBe("failure");
		expect(exec.error).toBe("Timeout exceeded");
	});
});
