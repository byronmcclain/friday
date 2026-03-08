import { describe, test, expect, beforeEach } from "bun:test";
import { createVoiceProtocol } from "../../src/core/voice/protocol.ts";
import { Vox } from "../../src/core/voice/vox.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";
import type { FridayProtocol } from "../../src/modules/types.ts";

const stubContext = {
	workingDirectory: "/tmp",
	audit: { log: () => {} } as any,
	signal: { emit: async () => {} } as any,
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
	tools: new Map(),
};

describe("/voice protocol", () => {
	let vox: Vox;
	let protocol: FridayProtocol;

	beforeEach(() => {
		const signals = new SignalBus();
		const notifications = new NotificationManager();
		// Short timeout so fetch() aborts quickly if XAI_API_KEY is set in the env
		vox = new Vox({ config: { ...VOX_DEFAULTS, timeoutMs: 100 }, signals, notifications });
		protocol = createVoiceProtocol(vox);
	});

	test("protocol has correct name and aliases", () => {
		expect(protocol.name).toBe("voice");
		expect(protocol.aliases).toContain("vox");
		expect(protocol.aliases).toContain("speak");
	});

	test("default (no subcommand) shows status", async () => {
		const result = await protocol.execute({ rawArgs: "" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("off");
		expect(result.summary).toContain("Eve");
	});

	test("/voice on switches mode", async () => {
		const result = await protocol.execute({ rawArgs: "on" }, stubContext);
		expect(result.success).toBe(true);
		expect(vox.mode).toBe("on");
		expect(result.summary).toContain("on");
	});

	test("/voice off switches mode", async () => {
		vox.setMode("on");
		const result = await protocol.execute({ rawArgs: "off" }, stubContext);
		expect(result.success).toBe(true);
		expect(vox.mode).toBe("off");
	});

	test("/voice whisper switches mode", async () => {
		const result = await protocol.execute({ rawArgs: "whisper" }, stubContext);
		expect(result.success).toBe(true);
		expect(vox.mode).toBe("whisper");
		expect(result.summary).toContain("Whisper");
	});

	test("/voice test attempts to speak", async () => {
		// Won't actually produce audio (no API key in tests), but should not throw
		const result = await protocol.execute({ rawArgs: "test" }, stubContext);
		expect(result.success).toBe(true);
	});

	test("unknown subcommand returns error", async () => {
		const result = await protocol.execute({ rawArgs: "invalid" }, stubContext);
		expect(result.success).toBe(false);
		expect(result.summary).toContain("Unknown subcommand");
	});

	test("/voice flat switches to flat mode", async () => {
		const result = await protocol.execute({ rawArgs: "flat" }, stubContext);
		expect(result.success).toBe(true);
		expect(vox.mode).toBe("flat");
		expect(result.summary).toContain("Flat");
	});

	test("/voice status includes emotion engine status", async () => {
		const result = await protocol.execute({ rawArgs: "status" }, stubContext);
		expect(result.success).toBe(true);
		expect(result.summary).toContain("Emotion engine");
	});
});
