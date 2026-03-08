import { describe, test, expect } from "bun:test";
import {
	appReducer,
	initialState,
	isExitWord,
	createMessage,
} from "../../src/cli/tui/state.ts";

describe("TUI state reducer", () => {
	test("initialState has correct defaults", () => {
		expect(initialState.phase).toBe("splash");
		expect(initialState.messages).toEqual([]);
		expect(initialState.isThinking).toBe(false);
	});

	test("add-message appends to messages", () => {
		const msg = createMessage("user", "Hello");
		const state = appReducer(initialState, {
			type: "add-message",
			message: msg,
		});
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]!.content).toBe("Hello");
		expect(state.messages[0]!.role).toBe("user");
	});

	test("add-message preserves existing messages", () => {
		const msg1 = createMessage("user", "First");
		const msg2 = createMessage("assistant", "Second");
		let state = appReducer(initialState, {
			type: "add-message",
			message: msg1,
		});
		state = appReducer(state, { type: "add-message", message: msg2 });
		expect(state.messages).toHaveLength(2);
	});

	test("set-thinking toggles isThinking", () => {
		const state = appReducer(initialState, {
			type: "set-thinking",
			value: true,
		});
		expect(state.isThinking).toBe(true);
		const state2 = appReducer(state, {
			type: "set-thinking",
			value: false,
		});
		expect(state2.isThinking).toBe(false);
	});

	test("set-phase transitions phase", () => {
		const state = appReducer(initialState, {
			type: "set-phase",
			phase: "active",
		});
		expect(state.phase).toBe("active");
	});

	test("set-phase to shutting-down works from active", () => {
		let state = appReducer(initialState, {
			type: "set-phase",
			phase: "active",
		});
		state = appReducer(state, {
			type: "set-phase",
			phase: "shutting-down",
		});
		expect(state.phase).toBe("shutting-down");
	});

	test("clear-messages resets messages array", () => {
		const msg = createMessage("user", "Hello");
		let state = appReducer(initialState, {
			type: "add-message",
			message: msg,
		});
		state = appReducer(state, { type: "clear-messages" });
		expect(state.messages).toEqual([]);
	});

	test("set-phase accepts splash phase", () => {
		const state = appReducer(initialState, {
			type: "set-phase",
			phase: "splash",
		});
		expect(state.phase).toBe("splash");
	});

	test("set-phase accepts booting phase", () => {
		const state = appReducer(initialState, {
			type: "set-phase",
			phase: "booting",
		});
		expect(state.phase).toBe("booting");
	});

	test("initialState phase is splash", () => {
		expect(initialState.phase).toBe("splash");
	});

	test("chat:chunk creates new assistant message when none exists", () => {
		const state = appReducer(initialState, { type: "chat:chunk", text: "Hello" });
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]!.role).toBe("assistant");
		expect(state.messages[0]!.content).toBe("Hello");
	});

	test("chat:chunk appends to existing assistant message", () => {
		let state = appReducer(initialState, { type: "chat:chunk", text: "Hel" });
		state = appReducer(state, { type: "chat:chunk", text: "lo" });
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]!.content).toBe("Hello");
	});

	test("chat:chunk clears isThinking and sets isStreaming", () => {
		let state = appReducer(initialState, { type: "set-thinking", value: true });
		expect(state.isThinking).toBe(true);
		expect(state.isStreaming).toBe(false);
		state = appReducer(state, { type: "chat:chunk", text: "Hi" });
		expect(state.isThinking).toBe(false);
		expect(state.isStreaming).toBe(true);
	});

	test("chat:done clears isStreaming", () => {
		let state = appReducer(initialState, { type: "chat:chunk", text: "Hi" });
		expect(state.isStreaming).toBe(true);
		state = appReducer(state, { type: "chat:done" });
		expect(state.isStreaming).toBe(false);
	});

	test("chat:chunk creates new message after user message", () => {
		let state = appReducer(initialState, {
			type: "add-message",
			message: createMessage("user", "Question"),
		});
		state = appReducer(state, { type: "chat:chunk", text: "Answer" });
		expect(state.messages).toHaveLength(2);
		expect(state.messages[1]!.role).toBe("assistant");
		expect(state.messages[1]!.content).toBe("Answer");
	});
});

describe("isExitWord", () => {
	test("detects exit", () => expect(isExitWord("exit")).toBe(true));
	test("detects quit", () => expect(isExitWord("quit")).toBe(true));
	test("detects bye", () => expect(isExitWord("bye")).toBe(true));
	test("case insensitive", () => expect(isExitWord("EXIT")).toBe(true));
	test("trims whitespace", () => expect(isExitWord("  quit  ")).toBe(true));
	test("rejects normal input", () =>
		expect(isExitWord("hello")).toBe(false));
	test("rejects empty string", () => expect(isExitWord("")).toBe(false));
	test("rejects partial match", () =>
		expect(isExitWord("exiting")).toBe(false));
});

describe("createMessage", () => {
	test("creates message with id and timestamp", () => {
		const msg = createMessage("user", "Hello");
		expect(msg.id).toBeDefined();
		expect(msg.id.length).toBeGreaterThan(0);
		expect(msg.role).toBe("user");
		expect(msg.content).toBe("Hello");
		expect(msg.timestamp).toBeInstanceOf(Date);
	});

	test("generates unique ids", () => {
		const msg1 = createMessage("user", "A");
		const msg2 = createMessage("user", "B");
		expect(msg1.id).not.toBe(msg2.id);
	});
});

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

	test("tool:completed clears currentTool", () => {
		let state = appReducer(initialState, {
			type: "tool:executing",
			name: "forge_validate",
			args: { moduleName: "weather" },
		});
		expect(state.currentTool).not.toBeNull();
		state = appReducer(state, { type: "tool:completed" });
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
