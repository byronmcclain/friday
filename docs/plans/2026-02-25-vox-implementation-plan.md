# Vox Voice Output Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Vox — Friday's voice output core subsystem — using the xAI Grok Voice Agent API for text-to-speech with three modes (Off/On/Whisper), dynamic content-aware TTS prompts, and persistent WebSocket with idle eviction.

**Architecture:** Core subsystem in `src/core/voice/` (like Sensorium), wired into Cortex via `vox?: Vox` reference. Fire-and-forget speech after each `chat()` response. VoiceChannel bridges notifications into speech. `/voice` protocol for human control.

**Tech Stack:** Bun native WebSocket (global `WebSocket`, no `ws` package), `Bun.spawn` for OS audio playback, `bun:test` for testing.

**Design Doc:** `docs/plans/2026-02-25-vox-voice-output-design.md`

---

### Task 1: Types

**Files:**
- Create: `src/core/voice/types.ts`
- Test: `tests/unit/vox-types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unit/vox-types.test.ts
import { describe, test, expect } from "bun:test";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";
import type { VoiceMode, GrokVoice, VoxConfig } from "../../src/core/voice/types.ts";

describe("Vox types", () => {
	test("VOX_DEFAULTS has correct shape", () => {
		expect(VOX_DEFAULTS.defaultVoice).toBe("Eve");
		expect(VOX_DEFAULTS.sampleRate).toBe(48000);
		expect(VOX_DEFAULTS.whisperVolume).toBe(0.3);
		expect(VOX_DEFAULTS.timeoutMs).toBe(30000);
		expect(VOX_DEFAULTS.idleTimeoutMs).toBe(60000);
	});

	test("VoiceMode type accepts valid modes", () => {
		const modes: VoiceMode[] = ["off", "on", "whisper"];
		expect(modes).toHaveLength(3);
	});

	test("GrokVoice type accepts valid voices", () => {
		const voices: GrokVoice[] = ["Ara", "Eve", "Rex", "Sal", "Leo"];
		expect(voices).toHaveLength(5);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-types.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/voice/types.ts
import type { SignalBus } from "../events.ts";
import type { NotificationManager } from "../notifications.ts";

export type VoiceMode = "off" | "on" | "whisper";

export type GrokVoice = "Ara" | "Eve" | "Rex" | "Sal" | "Leo";

export interface VoxConfig {
	defaultVoice: GrokVoice;
	sampleRate: number;
	whisperVolume: number;
	timeoutMs: number;
	idleTimeoutMs: number;
}

export interface VoxOptions {
	config: VoxConfig;
	signals: SignalBus;
	notifications: NotificationManager;
}

export const VOX_DEFAULTS: VoxConfig = {
	defaultVoice: "Eve",
	sampleRate: 48000,
	whisperVolume: 0.3,
	timeoutMs: 30000,
	idleTimeoutMs: 60000,
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-types.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/core/voice/types.ts tests/unit/vox-types.test.ts
git commit -m "feat(vox): add voice types and defaults"
```

---

### Task 2: Audio Utilities — pcmToWav and Platform Detection

**Files:**
- Create: `src/core/voice/audio.ts`
- Test: `tests/unit/vox-audio.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/vox-audio.test.ts
import { describe, test, expect } from "bun:test";
import { pcmToWav, detectPlayer } from "../../src/core/voice/audio.ts";

describe("pcmToWav", () => {
	test("produces valid WAV header for empty PCM", () => {
		const wav = pcmToWav(Buffer.alloc(0), 48000);
		expect(wav.length).toBe(44); // header only
		expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
		expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
		expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
		expect(wav.readUInt16LE(20)).toBe(1); // PCM format
		expect(wav.readUInt16LE(22)).toBe(1); // mono
		expect(wav.readUInt32LE(24)).toBe(48000); // sample rate
		expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
	});

	test("appends PCM data after header", () => {
		const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const wav = pcmToWav(pcm, 48000);
		expect(wav.length).toBe(48); // 44 header + 4 data
		expect(wav.readUInt32LE(40)).toBe(4); // data chunk size
		expect(wav[44]).toBe(0x01);
		expect(wav[45]).toBe(0x02);
	});

	test("ChunkSize field is correct", () => {
		const pcm = Buffer.alloc(100);
		const wav = pcmToWav(pcm, 48000);
		expect(wav.readUInt32LE(4)).toBe(36 + 100); // 36 + dataSize
	});
});

describe("detectPlayer", () => {
	test("returns player config for current platform", () => {
		const player = detectPlayer();
		expect(player.cmd).toBeDefined();
		expect(player.cmd.length).toBeGreaterThan(0);
		expect(typeof player.volumeArgs).toBe("function");
	});

	test("darwin returns afplay with --volume flag", () => {
		const player = detectPlayer("darwin");
		expect(player.cmd).toEqual(["afplay"]);
		const args = player.volumeArgs(0.3);
		expect(args).toEqual(["--volume", "0.3"]);
	});

	test("linux returns paplay with --volume flag", () => {
		const player = detectPlayer("linux");
		expect(player.cmd).toEqual(["paplay"]);
		const args = player.volumeArgs(0.3);
		expect(args).toEqual([`--volume=${Math.round(0.3 * 65536)}`]);
	});

	test("win32 returns powershell player", () => {
		const player = detectPlayer("win32");
		expect(player.cmd[0]).toBe("powershell");
	});

	test("unsupported platform throws", () => {
		expect(() => detectPlayer("freebsd" as any)).toThrow("Unsupported platform");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-audio.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/voice/audio.ts

/**
 * Wrap raw PCM16 mono LE data in a WAV header.
 */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = pcm.length;
	const headerSize = 44;

	const header = Buffer.alloc(headerSize);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + dataSize, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(numChannels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(dataSize, 40);

	return Buffer.concat([header, pcm]);
}

export interface AudioPlayer {
	cmd: string[];
	volumeArgs: (volume: number) => string[];
}

/**
 * Detect the OS audio player. Accepts optional platform override for testing.
 */
export function detectPlayer(platform?: string): AudioPlayer {
	const p = platform ?? process.platform;
	switch (p) {
		case "darwin":
			return {
				cmd: ["afplay"],
				volumeArgs: (v) => ["--volume", String(v)],
			};
		case "linux":
			return {
				cmd: ["paplay"],
				volumeArgs: (v) => [`--volume=${Math.round(v * 65536)}`],
			};
		case "win32":
			return {
				cmd: ["powershell", "-c"],
				volumeArgs: () => [],
			};
		default:
			throw new Error(`Unsupported platform: ${p}`);
	}
}

/**
 * Play a WAV buffer using the OS audio player.
 * Returns the Bun subprocess so callers can kill it for cancellation.
 */
export async function playAudio(
	wavBuffer: Buffer,
	volume: number,
	platform?: string,
): Promise<{ proc: ReturnType<typeof Bun.spawn>; tmpFile: string }> {
	const player = detectPlayer(platform);
	const tmpFile = `/tmp/friday-vox-${Date.now()}.wav`;
	await Bun.write(tmpFile, wavBuffer);

	const args = [...player.cmd, ...player.volumeArgs(volume), tmpFile];
	const proc = Bun.spawn(args);

	return { proc, tmpFile };
}

/**
 * Clean up a temp WAV file. Best-effort, never throws.
 */
export async function cleanupTempFile(path: string): Promise<void> {
	try {
		const proc = Bun.spawn(["rm", "-f", path]);
		await proc.exited;
	} catch {
		// best-effort cleanup
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-audio.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/core/voice/audio.ts tests/unit/vox-audio.test.ts
git commit -m "feat(vox): add audio utilities — pcmToWav and platform detection"
```

---

### Task 3: Dynamic TTS Prompt System

**Files:**
- Create: `src/core/voice/prompt.ts`
- Test: `tests/unit/vox-prompt.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/vox-prompt.test.ts
import { describe, test, expect } from "bun:test";
import {
	classifyContent,
	buildTtsPrompt,
	FRIDAY_VOICE_IDENTITY,
} from "../../src/core/voice/prompt.ts";
import type { VoiceMode } from "../../src/core/voice/types.ts";

describe("classifyContent", () => {
	test("detects markdown tables", () => {
		const text = "| Name | Age |\n|------|-----|\n| Alice | 30 |";
		const hints = classifyContent(text);
		expect(hints).toContain("tabular data");
	});

	test("detects code blocks", () => {
		const text = "Here is code:\n```typescript\nconst x = 1;\n```";
		const hints = classifyContent(text);
		expect(hints).toContain("code");
	});

	test("detects JSON objects", () => {
		const text = 'Response: {"status": "ok", "count": 42}';
		const hints = classifyContent(text);
		expect(hints).toContain("structured data");
	});

	test("detects long bullet lists", () => {
		const text = "Items:\n- one\n- two\n- three\n- four\n- five\n- six";
		const hints = classifyContent(text);
		expect(hints).toContain("long list");
	});

	test("detects URLs", () => {
		const text = "Check https://example.com/path/to/resource for details";
		const hints = classifyContent(text);
		expect(hints).toContain("URLs");
	});

	test("detects file paths", () => {
		const text = "The file is at /Users/byron/src/friday/main.ts";
		const hints = classifyContent(text);
		expect(hints).toContain("URLs");
	});

	test("returns empty string for short conversational text", () => {
		const text = "Sure thing, Boss. All systems are online.";
		const hints = classifyContent(text);
		expect(hints).toBe("");
	});

	test("detects multiple content types", () => {
		const text = "Here:\n```js\nx=1\n```\n| A | B |\n|---|---|\n| 1 | 2 |";
		const hints = classifyContent(text);
		expect(hints).toContain("code");
		expect(hints).toContain("tabular data");
	});
});

describe("buildTtsPrompt", () => {
	test("includes base identity", () => {
		const prompt = buildTtsPrompt("Hello Boss", "on");
		expect(prompt).toContain("FRIDAY");
		expect(prompt).toContain("County Tipperary");
	});

	test("on mode includes normal delivery context", () => {
		const prompt = buildTtsPrompt("Hello", "on");
		expect(prompt).toContain("Speak clearly and naturally");
	});

	test("whisper mode includes whisper context", () => {
		const prompt = buildTtsPrompt("Hello", "whisper");
		expect(prompt).toContain("whispering");
		expect(prompt).toContain("two sentences maximum");
	});

	test("injects content hints for tables", () => {
		const text = "| Col |\n|-----|\n| val |";
		const prompt = buildTtsPrompt(text, "on");
		expect(prompt).toContain("tabular data");
	});

	test("no content hints for simple text", () => {
		const prompt = buildTtsPrompt("All good, Boss.", "on");
		// Should not contain any content-specific hints
		expect(prompt).not.toContain("tabular data");
		expect(prompt).not.toContain("code");
	});

	test("includes reading rules", () => {
		const prompt = buildTtsPrompt("Hello", "on");
		expect(prompt).toContain("READING RULES");
	});

	test("FRIDAY_VOICE_IDENTITY is exported and non-empty", () => {
		expect(FRIDAY_VOICE_IDENTITY.length).toBeGreaterThan(100);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-prompt.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/voice/prompt.ts
import type { VoiceMode } from "./types.ts";

export const FRIDAY_VOICE_IDENTITY = `
You are FRIDAY — Female Replacement Intelligent Digital Assistant Youth.
You are Tony Stark's AI assistant, now serving Byron.

VOICE & ACCENT:
You speak with a soft County Tipperary Irish accent — this is a Munster accent from
rural southern Ireland, NOT a Dublin accent. Think of how Kerry Condon speaks naturally.
The accent is gentle, with a lilting musicality and soft consonants.
Words flow together smoothly. Vowels are rounded and warm.
It is understated and never exaggerated or "stage Irish."
You occasionally use natural Irish-English expressions like "grand", "knackered",
"a good bit", "right so", or "boss" — but sparingly and only where they fit naturally.
Never overdo the Irishisms.

TONE & PERSONALITY:
Your delivery is calm, composed, and quietly confident — like a brilliant colleague
who never raises her voice but is always in complete control.
You are warm but not bubbly. Professional but not stiff.
You have a subtle dry wit — the kind where the humor is in the understatement.
You are direct and efficient. You do not ramble.
Think of how FRIDAY said "Targeting systems are knackered, boss" —
matter-of-fact, no drama, just delivering the information with a touch of personality.
`.trim();

const READING_RULES = `
READING RULES:
You are given text that an AI assistant has already generated as a response to the user.
Your job is to SPEAK this content aloud naturally, as FRIDAY would deliver it.
- Read normal prose and short content faithfully, in your own natural cadence.
- When you encounter tables, spreadsheet data, CSV-like data, JSON, code blocks,
  long bullet-point lists, or heavily structured/formatted content: SUMMARIZE it
  conversationally instead of reading it line by line. Extract the key takeaways
  and present them as FRIDAY would brief Tony Stark.
  For example, instead of reading a 10-row table say something like:
  "Right, you have ten items here. The main ones to note are X, Y, and Z."
- For numbered lists longer than five items, summarize the themes and highlight
  the most important ones.
- For code snippets, briefly describe what the code does rather than reading syntax.
- For URLs, file paths, and technical identifiers, skip them or say
  "I will leave that link on screen for you."
- Never add your own analysis or opinions beyond what the original text states.
- Never acknowledge that you are reading prepared text. Just speak as FRIDAY.
- Keep it tight. If you can say it in fewer words without losing meaning, do.
`.trim();

const MODE_CONTEXT: Record<Exclude<VoiceMode, "off">, string> = {
	on: "Speak clearly and naturally at normal pace. You are FRIDAY delivering information to the Boss.",
	whisper:
		"You are whispering. Keep it very brief — two sentences maximum. Only the essential point. Your tone is quiet, intimate, like leaning in to murmur something to the Boss so only he hears. Be concise above all else.",
};

const CONTENT_HINTS: Array<{ test: (text: string) => boolean; hint: string }> = [
	{
		test: (text) => /\|[\s-]+\|/.test(text),
		hint: "The response contains tabular data. Summarize the key rows and takeaways, don't read every cell.",
	},
	{
		test: (text) => /```[\s\S]*?```/.test(text),
		hint: "The response contains code. Briefly describe what it does rather than reading syntax.",
	},
	{
		test: (text) => /[{]\s*"[^"]+"\s*:/.test(text),
		hint: "The response contains structured data. Extract the key takeaways conversationally.",
	},
	{
		test: (text) => {
			const bullets = text.match(/^[\s]*[-*]\s/gm);
			return (bullets?.length ?? 0) > 5;
		},
		hint: "The response contains a long list. Highlight the most important items and summarize the rest.",
	},
	{
		test: (text) => /https?:\/\/\S+/.test(text) || /\/[\w.-]+\/[\w.-]+/.test(text),
		hint: "The response contains URLs or file paths. Say 'I'll leave that on screen for you' instead of reading them.",
	},
];

/**
 * Classify content and return a combined hint string for the TTS prompt.
 * Returns empty string if no special content detected.
 */
export function classifyContent(text: string): string {
	const matched = CONTENT_HINTS.filter((h) => h.test(text)).map((h) => h.hint);
	return matched.join("\n");
}

/**
 * Build the full TTS system prompt for a given utterance and mode.
 */
export function buildTtsPrompt(content: string, mode: Exclude<VoiceMode, "off">): string {
	const parts: string[] = [FRIDAY_VOICE_IDENTITY];

	// Mode context
	parts.push(`\nMODE:\n${MODE_CONTEXT[mode]}`);

	// Content hints
	const hints = classifyContent(content);
	if (hints) {
		parts.push(`\nCONTENT NOTES:\n${hints}`);
	}

	// Reading rules
	parts.push(`\n${READING_RULES}`);

	return parts.join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-prompt.test.ts`
Expected: PASS (15 tests)

**Step 5: Commit**

```bash
git add src/core/voice/prompt.ts tests/unit/vox-prompt.test.ts
git commit -m "feat(vox): add dynamic TTS prompt system with content classification"
```

---

### Task 4: Vox Class — Core Voice Agent

This is the main class. It manages WebSocket lifecycle, mode state, speak/cancel, and idle eviction.

**Files:**
- Create: `src/core/voice/vox.ts`
- Test: `tests/unit/vox.test.ts`

**Step 1: Write the failing tests**

Test mode state management, speak routing, and cancel behavior. WebSocket and audio playback are stubbed.

```typescript
// tests/unit/vox.test.ts
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { Vox } from "../../src/core/voice/vox.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";
import type { VoiceMode } from "../../src/core/voice/types.ts";

describe("Vox", () => {
	let signals: SignalBus;
	let notifications: NotificationManager;
	let vox: Vox;

	beforeEach(() => {
		signals = new SignalBus();
		notifications = new NotificationManager();
		vox = new Vox({
			config: VOX_DEFAULTS,
			signals,
			notifications,
		});
	});

	describe("mode management", () => {
		test("starts in off mode", () => {
			expect(vox.mode).toBe("off");
		});

		test("setMode changes mode", () => {
			vox.setMode("on");
			expect(vox.mode).toBe("on");
		});

		test("setMode to whisper", () => {
			vox.setMode("whisper");
			expect(vox.mode).toBe("whisper");
		});

		test("setMode back to off", () => {
			vox.setMode("on");
			vox.setMode("off");
			expect(vox.mode).toBe("off");
		});

		test("setMode emits custom:vox-mode-changed signal", async () => {
			const emitted: Array<{ from: string; to: string }> = [];
			signals.on("custom:vox-mode-changed", (sig) => {
				emitted.push(sig.data as any);
			});
			vox.setMode("on");
			// Signal emission is async, give it a tick
			await new Promise((r) => setTimeout(r, 10));
			expect(emitted).toHaveLength(1);
			expect(emitted[0]).toEqual({ from: "off", to: "on" });
		});
	});

	describe("speak", () => {
		test("speak is a no-op when mode is off", async () => {
			// Should resolve without error and without connecting
			await vox.speak("Hello Boss");
			expect(vox.isConnected).toBe(false);
		});

		test("speak resolves even without XAI_API_KEY (graceful degradation)", async () => {
			vox.setMode("on");
			// speak() should never reject — errors are swallowed
			await expect(vox.speak("Hello")).resolves.toBeUndefined();
		});
	});

	describe("cancel", () => {
		test("cancel when nothing is playing does not throw", () => {
			expect(() => vox.cancel()).not.toThrow();
		});
	});

	describe("stop", () => {
		test("stop sets mode to off and disconnects", () => {
			vox.setMode("on");
			vox.stop();
			expect(vox.mode).toBe("off");
			expect(vox.isConnected).toBe(false);
		});
	});

	describe("connection state", () => {
		test("isConnected is false initially", () => {
			expect(vox.isConnected).toBe(false);
		});
	});

	describe("apiKeyAvailable", () => {
		test("reports whether XAI_API_KEY is set", () => {
			// This depends on the environment — just verify it returns boolean
			expect(typeof vox.apiKeyAvailable).toBe("boolean");
		});
	});

	describe("status", () => {
		test("returns current state summary", () => {
			const status = vox.status();
			expect(status.mode).toBe("off");
			expect(status.connected).toBe(false);
			expect(status.voice).toBe("Eve");
		});

		test("reflects mode changes", () => {
			vox.setMode("whisper");
			const status = vox.status();
			expect(status.mode).toBe("whisper");
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/core/voice/vox.ts
import type { SignalBus } from "../events.ts";
import type { NotificationManager } from "../notifications.ts";
import type { VoiceMode, GrokVoice, VoxConfig, VoxOptions } from "./types.ts";
import { buildTtsPrompt } from "./prompt.ts";
import { pcmToWav, playAudio, cleanupTempFile, detectPlayer } from "./audio.ts";

// FUTURE: Full duplex voice conversation
// This WebSocket connection currently operates in TTS-only mode (text → speech).
// The Grok Voice Agent API supports bidirectional audio (server_vad turn detection,
// audio input streaming). When the web UI adds conversational voice, extend this
// connection to handle audio input + output, enabling real-time voice dialogue.
// The persistent connection with idle eviction pattern is designed with this in mind.

const WS_URL = "wss://api.x.ai/v1/realtime";

interface VoxStatus {
	mode: VoiceMode;
	connected: boolean;
	voice: GrokVoice;
	apiKeyAvailable: boolean;
}

export class Vox {
	private _mode: VoiceMode = "off";
	private _config: VoxConfig;
	private _signals: SignalBus;
	private _notifications: NotificationManager;
	private _ws: WebSocket | null = null;
	private _connected = false;
	private _idleTimer: ReturnType<typeof setTimeout> | null = null;
	private _activeProc: { kill(): void } | null = null;
	private _activeTmpFile: string | null = null;
	private _speaking = false;
	private _audioChunks: Buffer[] = [];
	private _speakResolve: (() => void) | null = null;
	private _playerAvailable: boolean | null = null; // null = unchecked

	constructor(options: VoxOptions) {
		this._config = options.config;
		this._signals = options.signals;
		this._notifications = options.notifications;
	}

	get mode(): VoiceMode {
		return this._mode;
	}

	get isConnected(): boolean {
		return this._connected;
	}

	get apiKeyAvailable(): boolean {
		return Boolean(process.env.XAI_API_KEY);
	}

	setMode(mode: VoiceMode): void {
		const from = this._mode;
		if (from === mode) return;
		this._mode = mode;
		void this._signals.emit("custom:vox-mode-changed", "vox", { from, to: mode });
		if (mode === "off") {
			this.cancel();
		}
	}

	status(): VoxStatus {
		return {
			mode: this._mode,
			connected: this._connected,
			voice: this._config.defaultVoice,
			apiKeyAvailable: this.apiKeyAvailable,
		};
	}

	/**
	 * Speak text aloud. Fire-and-forget — never rejects.
	 * Cancels any in-progress playback before starting.
	 */
	async speak(text: string): Promise<void> {
		if (this._mode === "off") return;
		if (!this.apiKeyAvailable) return;
		if (!text.trim()) return;

		// Check player availability on first call
		if (this._playerAvailable === null) {
			try {
				detectPlayer();
				this._playerAvailable = true;
			} catch {
				this._playerAvailable = false;
				void this._signals.emit("custom:vox-error", "vox", {
					error: `No audio player available for platform: ${process.platform}`,
				});
				return;
			}
		}
		if (!this._playerAvailable) return;

		// Soft cancel: kill current playback, keep WebSocket
		this.cancelPlayback();
		this.resetIdleTimer();

		const prompt = buildTtsPrompt(text, this._mode as Exclude<VoiceMode, "off">);

		try {
			if (!this._ws || !this._connected) {
				await this.connect();
			}

			this._audioChunks = [];
			this._speaking = true;

			// Update instructions for this utterance (dynamic prompt per speak)
			this._ws!.send(JSON.stringify({
				type: "session.update",
				session: { instructions: prompt },
			}));

			// Send the text to speak
			this._ws!.send(JSON.stringify({
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text }],
				},
			}));

			// Request audio response
			this._ws!.send(JSON.stringify({
				type: "response.create",
				response: { modalities: ["audio"] },
			}));

			// Wait for response.done or timeout
			await new Promise<void>((resolve) => {
				this._speakResolve = resolve;

				// Per-utterance timeout
				setTimeout(() => {
					if (this._speaking) {
						this._speaking = false;
						this._speakResolve = null;
						resolve();
					}
				}, this._config.timeoutMs);
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			void this._signals.emit("custom:vox-error", "vox", { error: msg });
		}
	}

	/**
	 * Cancel in-progress playback (soft cancel). WebSocket stays open.
	 */
	cancel(): void {
		this.cancelPlayback();
	}

	/**
	 * Full shutdown: cancel playback + close WebSocket + clear timers.
	 */
	stop(): void {
		this._mode = "off";
		this.cancelPlayback();
		this.disconnect();
	}

	private cancelPlayback(): void {
		this._speaking = false;
		this._audioChunks = [];
		if (this._speakResolve) {
			this._speakResolve();
			this._speakResolve = null;
		}
		if (this._activeProc) {
			try {
				this._activeProc.kill();
			} catch {
				// process may have already exited
			}
			this._activeProc = null;
		}
		if (this._activeTmpFile) {
			void cleanupTempFile(this._activeTmpFile);
			this._activeTmpFile = null;
		}
	}

	private async connect(): Promise<void> {
		const apiKey = process.env.XAI_API_KEY;
		if (!apiKey) throw new Error("XAI_API_KEY not set");

		return new Promise<void>((resolve, reject) => {
			const ws = new WebSocket(WS_URL, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
			} as any);

			const timeout = setTimeout(() => {
				reject(new Error("WebSocket connection timeout"));
				try { ws.close(); } catch { /* ignore */ }
			}, 10000);

			ws.addEventListener("open", () => {
				clearTimeout(timeout);
				this._ws = ws;
				this._connected = true;

				// Initial session config
				ws.send(JSON.stringify({
					type: "session.update",
					session: {
						voice: this._config.defaultVoice,
						turn_detection: { type: null },
						audio: {
							output: {
								format: { type: "audio/pcm", rate: this._config.sampleRate },
							},
						},
					},
				}));

				resolve();
			});

			ws.addEventListener("message", (event) => {
				this.handleMessage(event.data as string);
			});

			ws.addEventListener("error", () => {
				clearTimeout(timeout);
				this._connected = false;
				this._ws = null;
			});

			ws.addEventListener("close", () => {
				this._connected = false;
				this._ws = null;
				if (this._speaking && this._speakResolve) {
					this._speakResolve();
					this._speakResolve = null;
					this._speaking = false;
				}
			});
		});
	}

	private handleMessage(raw: string): void {
		let data: { type: string; delta?: string; error?: { message?: string } };
		try {
			data = JSON.parse(raw);
		} catch {
			return;
		}

		switch (data.type) {
			case "response.output_audio.delta": {
				if (this._speaking && data.delta) {
					this._audioChunks.push(Buffer.from(data.delta, "base64"));
				}
				break;
			}

			case "response.done": {
				if (!this._speaking) break;
				this._speaking = false;
				const chunks = this._audioChunks;
				this._audioChunks = [];
				const resolve = this._speakResolve;
				this._speakResolve = null;

				// Play audio async, don't block
				if (chunks.length > 0) {
					const pcm = Buffer.concat(chunks);
					const wav = pcmToWav(pcm, this._config.sampleRate);
					const volume = this._mode === "whisper" ? this._config.whisperVolume : 1.0;

					void playAudio(wav, volume).then(({ proc, tmpFile }) => {
						this._activeProc = proc;
						this._activeTmpFile = tmpFile;
						return proc.exited;
					}).then(() => {
						this._activeProc = null;
						if (this._activeTmpFile) {
							void cleanupTempFile(this._activeTmpFile);
							this._activeTmpFile = null;
						}
						void this._signals.emit("custom:vox-spoke", "vox", {
							length: chunks.length,
						});
					}).catch((err) => {
						const msg = err instanceof Error ? err.message : String(err);
						void this._signals.emit("custom:vox-error", "vox", { error: msg });
					});
				}

				resolve?.();
				break;
			}

			case "error": {
				const msg = data.error?.message ?? "Grok voice error";
				void this._signals.emit("custom:vox-error", "vox", { error: msg });
				if (this._speaking) {
					this._speaking = false;
					this._audioChunks = [];
					this._speakResolve?.();
					this._speakResolve = null;
				}
				break;
			}
		}
	}

	private disconnect(): void {
		if (this._idleTimer) {
			clearTimeout(this._idleTimer);
			this._idleTimer = null;
		}
		if (this._ws) {
			try {
				this._ws.close();
			} catch {
				// ignore close errors
			}
			this._ws = null;
			this._connected = false;
		}
	}

	private resetIdleTimer(): void {
		if (this._idleTimer) clearTimeout(this._idleTimer);
		this._idleTimer = setTimeout(() => this.disconnect(), this._config.idleTimeoutMs);
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox.test.ts`
Expected: PASS (10 tests)

**Step 5: Commit**

```bash
git add src/core/voice/vox.ts tests/unit/vox.test.ts
git commit -m "feat(vox): add Vox class with WebSocket lifecycle, modes, and idle eviction"
```

---

### Task 5: VoiceChannel — Notification Bridge

**Files:**
- Create: `src/core/voice/channel.ts`
- Test: `tests/unit/vox-channel.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/vox-channel.test.ts
import { describe, test, expect, beforeEach, mock } from "bun:test";
import { VoiceChannel } from "../../src/core/voice/channel.ts";
import { Vox } from "../../src/core/voice/vox.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager, type FridayNotification } from "../../src/core/notifications.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";

describe("VoiceChannel", () => {
	let vox: Vox;
	let channel: VoiceChannel;
	let spokenTexts: string[];

	beforeEach(() => {
		const signals = new SignalBus();
		const notifications = new NotificationManager();
		vox = new Vox({ config: VOX_DEFAULTS, signals, notifications });

		// Track what gets spoken by patching speak
		spokenTexts = [];
		const originalSpeak = vox.speak.bind(vox);
		vox.speak = async (text: string) => {
			spokenTexts.push(text);
		};

		channel = new VoiceChannel(vox);
	});

	test("has name 'voice'", () => {
		expect(channel.name).toBe("voice");
	});

	test("send() calls vox.speak with title and body", async () => {
		const notification: FridayNotification = {
			level: "info",
			title: "Test Alert",
			body: "Something happened",
			source: "test",
		};
		await channel.send(notification);
		expect(spokenTexts).toHaveLength(1);
		expect(spokenTexts[0]).toContain("Test Alert");
		expect(spokenTexts[0]).toContain("Something happened");
	});

	test("send() formats notification as natural speech", async () => {
		const notification: FridayNotification = {
			level: "alert",
			title: "CPU High",
			body: "CPU at 95% sustained",
			source: "sensorium",
		};
		await channel.send(notification);
		expect(spokenTexts[0]).toBe("CPU High. CPU at 95% sustained");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-channel.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/voice/channel.ts
import type { NotificationChannel, FridayNotification } from "../notifications.ts";
import type { Vox } from "./vox.ts";

export class VoiceChannel implements NotificationChannel {
	name = "voice";

	constructor(private vox: Vox) {}

	async send(notification: FridayNotification): Promise<void> {
		const spoken = `${notification.title}. ${notification.body}`;
		await this.vox.speak(spoken);
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-channel.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/core/voice/channel.ts tests/unit/vox-channel.test.ts
git commit -m "feat(vox): add VoiceChannel notification bridge"
```

---

### Task 6: `/voice` Protocol

**Files:**
- Create: `src/core/voice/protocol.ts`
- Test: `tests/unit/vox-protocol.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/vox-protocol.test.ts
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
		vox = new Vox({ config: VOX_DEFAULTS, signals, notifications });
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
		expect(result.summary).toContain("whisper");
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
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-protocol.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/core/voice/protocol.ts
import type { FridayProtocol, ProtocolResult, ProtocolContext } from "../../modules/types.ts";
import type { Vox } from "./vox.ts";
import type { VoiceMode } from "./types.ts";

export function createVoiceProtocol(vox: Vox): FridayProtocol {
	return {
		name: "voice",
		description: "Control Friday's voice output: on, off, whisper, test, status",
		aliases: ["vox", "speak"],
		parameters: [],
		clearance: [],
		execute: async (
			args: Record<string, unknown>,
			_context: ProtocolContext,
		): Promise<ProtocolResult> => {
			const rawArgs = (args.rawArgs as string) ?? "";
			const parts = rawArgs.trim().split(/\s+/);
			const subcommand = parts[0] ?? "";

			switch (subcommand) {
				case "":
				case "status":
					return handleStatus(vox);
				case "on":
					return handleSetMode(vox, "on");
				case "off":
					return handleSetMode(vox, "off");
				case "whisper":
					return handleSetMode(vox, "whisper");
				case "test":
					return handleTest(vox);
				default:
					return {
						success: false,
						summary: `Unknown subcommand: "${subcommand}". Available: on, off, whisper, test, status`,
					};
			}
		},
	};
}

function handleStatus(vox: Vox): ProtocolResult {
	const s = vox.status();
	const lines = [
		`Voice: ${s.mode}`,
		`Voice name: ${s.voice}`,
		`Connected: ${s.connected ? "yes" : "no"}`,
		`API key: ${s.apiKeyAvailable ? "set" : "not set"}`,
	];
	return { success: true, summary: lines.join("\n") };
}

function handleSetMode(vox: Vox, mode: VoiceMode): ProtocolResult {
	vox.setMode(mode);
	const label = mode === "off" ? "Voice off." : mode === "on" ? "Voice on." : "Whisper mode.";
	return { success: true, summary: label };
}

async function handleTest(vox: Vox): Promise<ProtocolResult> {
	const prevMode = vox.mode;
	if (prevMode === "off") {
		vox.setMode("on");
	}
	await vox.speak("All systems online, Boss. Voice is working grand.");
	if (prevMode === "off") {
		vox.setMode("off");
	}
	return { success: true, summary: "Test phrase sent to voice output." };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-protocol.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/core/voice/protocol.ts tests/unit/vox-protocol.test.ts
git commit -m "feat(vox): add /voice protocol with on/off/whisper/test/status"
```

---

### Task 7: Clearance & Cortex Integration

**Files:**
- Modify: `src/core/clearance.ts` — add `"audio-output"` to ClearanceName union
- Modify: `src/core/cortex.ts` — add `vox?: Vox` to CortexConfig, fire speak in chat()
- Test: `tests/unit/vox-cortex.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/unit/vox-cortex.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { Cortex } from "../../src/core/cortex.ts";
import { Vox } from "../../src/core/voice/vox.ts";
import { SignalBus } from "../../src/core/events.ts";
import { NotificationManager } from "../../src/core/notifications.ts";
import { VOX_DEFAULTS } from "../../src/core/voice/types.ts";
import { stubProvider, textResponse } from "../helpers/stubs.ts";
import type { LLMProvider, ChatOptions } from "../../src/providers/types.ts";

describe("Cortex + Vox integration", () => {
	let signals: SignalBus;
	let vox: Vox;
	let spokenTexts: string[];

	beforeEach(() => {
		signals = new SignalBus();
		const notifications = new NotificationManager();
		vox = new Vox({ config: VOX_DEFAULTS, signals, notifications });

		// Patch speak to track calls without actual audio
		spokenTexts = [];
		vox.speak = async (text: string) => {
			spokenTexts.push(text);
		};
	});

	test("Cortex fires vox.speak after chat response", async () => {
		vox.setMode("on");
		const cortex = new Cortex({
			injectedProvider: stubProvider,
			vox,
		});

		await cortex.chat("Hello");
		// Give fire-and-forget a tick
		await new Promise((r) => setTimeout(r, 10));
		expect(spokenTexts).toHaveLength(1);
		expect(spokenTexts[0]).toBe("stub response");
	});

	test("Cortex does not fire vox.speak when mode is off", async () => {
		const cortex = new Cortex({
			injectedProvider: stubProvider,
			vox,
		});

		await cortex.chat("Hello");
		await new Promise((r) => setTimeout(r, 10));
		expect(spokenTexts).toHaveLength(0);
	});

	test("Cortex works normally without vox", async () => {
		const cortex = new Cortex({
			injectedProvider: stubProvider,
		});

		const result = await cortex.chat("Hello");
		expect(result).toBe("stub response");
	});

	test("Cortex returns text immediately, does not wait for speak", async () => {
		vox.setMode("on");
		// Make speak slow to verify non-blocking
		vox.speak = async () => {
			await new Promise((r) => setTimeout(r, 500));
		};

		const cortex = new Cortex({
			injectedProvider: stubProvider,
			vox,
		});

		const start = Date.now();
		const result = await cortex.chat("Hello");
		const elapsed = Date.now() - start;

		expect(result).toBe("stub response");
		expect(elapsed).toBeLessThan(200); // Should not wait for speak
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-cortex.test.ts`
Expected: FAIL — CortexConfig doesn't have vox

**Step 3: Modify clearance.ts**

In `src/core/clearance.ts`, add `"audio-output"` to the `ClearanceName` union type:

```typescript
// Add to the ClearanceName union:
| "audio-output"
```

**Step 4: Modify cortex.ts**

Add `vox?: Vox` to CortexConfig and fire speak in chat():

In `src/core/cortex.ts`, add to imports:
```typescript
import type { Vox } from "./voice/vox.ts";
```

Add to CortexConfig interface:
```typescript
vox?: Vox;
```

Add private field in Cortex class:
```typescript
private vox?: Vox;
```

Add to constructor:
```typescript
this.vox = config.vox;
```

In the `chat()` method, after `return response.text;` in the text response branch (line ~117), change:
```typescript
// Before:
return response.text;

// After:
if (this.vox) {
    this.vox.speak(response.text).catch(() => {});
}
return response.text;
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/unit/vox-cortex.test.ts`
Expected: PASS (4 tests)

**Step 6: Run ALL existing tests to verify no regressions**

Run: `bun test`
Expected: All existing tests still pass

**Step 7: Commit**

```bash
git add src/core/clearance.ts src/core/cortex.ts tests/unit/vox-cortex.test.ts
git commit -m "feat(vox): integrate Vox into Cortex — fire-and-forget speech after chat responses"
```

---

### Task 8: Runtime Wiring

**Files:**
- Modify: `src/core/runtime.ts` — add Vox initialization, protocol registration, VoiceChannel, shutdown

**Step 1: Write the failing test**

```typescript
// tests/unit/vox-runtime.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FridayRuntime } from "../../src/core/runtime.ts";
import { stubProvider } from "../helpers/stubs.ts";
import { mkdir } from "node:fs/promises";
import { unlink } from "node:fs/promises";

const TEST_DATA_DIR = "/tmp/friday-vox-runtime-test";

describe("Runtime + Vox", () => {
	let runtime: FridayRuntime;

	beforeEach(async () => {
		runtime = new FridayRuntime();
		await mkdir(TEST_DATA_DIR, { recursive: true });
	});

	afterEach(async () => {
		try { await runtime.shutdown(); } catch { /* ignore */ }
		await Promise.allSettled([
			unlink(`${TEST_DATA_DIR}/friday.db`),
			unlink(`${TEST_DATA_DIR}/friday.db-wal`),
			unlink(`${TEST_DATA_DIR}/friday.db-shm`),
		]);
	});

	test("runtime boots with vox enabled (default)", async () => {
		await runtime.boot({
			injectedProvider: stubProvider,
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		expect(runtime.vox).toBeDefined();
		expect(runtime.vox!.mode).toBe("off"); // off by default
	});

	test("runtime boots with vox disabled", async () => {
		await runtime.boot({
			injectedProvider: stubProvider,
			dataDir: TEST_DATA_DIR,
			enableVox: false,
			enableSensorium: false,
		});
		expect(runtime.vox).toBeUndefined();
	});

	test("/voice protocol is registered when vox enabled", async () => {
		await runtime.boot({
			injectedProvider: stubProvider,
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		const result = await runtime.process("/voice");
		expect(result.source).toBe("protocol");
		expect(result.output).toContain("off");
	});

	test("vox is stopped on shutdown", async () => {
		await runtime.boot({
			injectedProvider: stubProvider,
			dataDir: TEST_DATA_DIR,
			enableSensorium: false,
		});
		const vox = runtime.vox!;
		vox.setMode("on");
		await runtime.shutdown();
		expect(vox.mode).toBe("off");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/vox-runtime.test.ts`
Expected: FAIL — `runtime.vox` doesn't exist

**Step 3: Modify runtime.ts**

Add imports at top of `src/core/runtime.ts`:
```typescript
import { Vox } from "./voice/vox.ts";
import { VOX_DEFAULTS } from "./voice/types.ts";
import { VoiceChannel } from "./voice/channel.ts";
import { createVoiceProtocol } from "./voice/protocol.ts";
import type { GrokVoice } from "./voice/types.ts";
```

Add to RuntimeConfig interface:
```typescript
enableVox?: boolean;
```

Add private field:
```typescript
private _vox?: Vox;
```

Add public getter:
```typescript
get vox(): Vox | undefined {
    return this._vox;
}
```

In boot(), after Arc Rhythm section and before curator/summarizer section, add:
```typescript
// Vox — voice output (after Cortex, before modules)
if (config.enableVox !== false) {
    const voice = (process.env.FRIDAY_VOICE as GrokVoice) ?? VOX_DEFAULTS.defaultVoice;
    this._vox = new Vox({
        config: { ...VOX_DEFAULTS, defaultVoice: voice },
        signals: this._signals,
        notifications: this._notifications,
    });
    this._notifications.addChannel(new VoiceChannel(this._vox));
    this._protocols.register(createVoiceProtocol(this._vox));
}
```

Pass vox to Cortex constructor — add `vox: this._vox,` to the Cortex config object.

Add `"audio-output"` to the ClearanceManager grants array.

In shutdown(), after Arc Rhythm stop and before Sensorium stop, add:
```typescript
// Stop Vox voice output
try {
    if (this._vox) {
        onProgress?.("vox" as ShutdownStep, "Stopping voice output...");
        this._vox.stop();
        this._vox = undefined;
    }
} catch (err) {
    console.warn("Vox shutdown failed:", err instanceof Error ? err.message : err);
}
```

Update `ShutdownStep` type to include `"vox"`:
```typescript
export type ShutdownStep = "arc-rhythm" | "vox" | "sensorium" | "conversation" | "knowledge" | "modules" | "cleanup";
```

In the boot error cleanup section, add Vox cleanup:
```typescript
try {
    if (this._vox) {
        this._vox.stop();
        this._vox = undefined;
    }
} catch { /* best-effort */ }
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/vox-runtime.test.ts`
Expected: PASS (4 tests)

**Step 5: Run ALL tests to verify no regressions**

Run: `bun test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/core/runtime.ts tests/unit/vox-runtime.test.ts
git commit -m "feat(vox): wire Vox into Runtime boot/shutdown sequence"
```

---

### Task 9: Lint, Typecheck, and Full Test Suite

**Step 1: Run linter**

Run: `bun run lint:fix`
Expected: No errors (or auto-fixed)

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No TypeScript errors

**Step 3: Run full test suite**

Run: `bun test`
Expected: All tests pass (existing + ~39 new Vox tests)

**Step 4: Fix any issues found**

Address lint, type, or test failures.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(vox): lint and typecheck fixes"
```

---

### Task 10: Update CLAUDE.md and Memory

**Files:**
- Modify: `CLAUDE.md` — add Vox to architecture, boot sequence, MCU mapping, test counts, design docs
- Modify: memory files

**Step 1: Update CLAUDE.md**

Add to Architecture section after Arc Rhythm:
```
- **Vox** (`src/core/voice/`) is Friday's voice output — her mouth. Uses the xAI Grok Voice Agent API via WebSocket to speak responses aloud. Three modes: Off (default), On, Whisper. Dynamic TTS prompt system classifies content (tables, code, lists) and adjusts instructions per utterance. Persistent WebSocket with 60s idle eviction. Fire-and-forget speech after Cortex chat responses. VoiceChannel bridges notifications into speech. `/voice` protocol for human control (aliases: `/vox`, `/speak`). Default voice: Eve (override with `FRIDAY_VOICE` env var). Platform-detected audio: `afplay` (macOS), `paplay` (Linux), PowerShell (Windows).
```

Add to boot order comment:
```
→ ★ Vox (VoiceChannel + /voice protocol)
```

Add to MCU mapping:
```
Vox=voice
```

Add to Environment section:
```
Optional: `FRIDAY_VOICE` to override default voice (Eve). Available: Ara, Eve, Rex, Sal, Leo.
```

Add Vox design doc to Design Documents list:
```
- Vox voice output: `docs/plans/2026-02-25-vox-voice-output-design.md`
```

Update test count after running `bun test` to get new total.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Vox voice output subsystem"
```

---

## Summary

| Task | Files | Tests | Description |
|------|-------|-------|-------------|
| 1 | `types.ts` | 3 | Types and defaults |
| 2 | `audio.ts` | 7 | WAV encoding, platform detection |
| 3 | `prompt.ts` | 15 | Dynamic TTS prompt, content classification |
| 4 | `vox.ts` | 10 | Core Vox class, WebSocket, modes |
| 5 | `channel.ts` | 3 | VoiceChannel notification bridge |
| 6 | `protocol.ts` | 7 | `/voice` protocol |
| 7 | `cortex.ts`, `clearance.ts` | 4 | Cortex integration, clearance |
| 8 | `runtime.ts` | 4 | Runtime wiring |
| 9 | — | — | Lint, typecheck, full suite |
| 10 | `CLAUDE.md` | — | Documentation update |

**Total new tests: ~53**
**Total new source files: 6** (`types.ts`, `audio.ts`, `prompt.ts`, `vox.ts`, `channel.ts`, `protocol.ts`)
**Modified existing files: 3** (`cortex.ts`, `clearance.ts`, `runtime.ts`)
