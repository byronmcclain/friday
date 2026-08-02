# Voice Agent First Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **As-shipped hardening (beyond Task 4/5 sketches):** orphaned-turn unwind on close; drop stale `conversation_id` after failed reconnect (and reset `_greeted` for fresh-session fallback); `onSessionError` → `voice:error` + null session; `_pendingGreeting` so force_message is not auto-cancelled; soft Grok/turn failures stay on `listening` (terminal death only via `voice:error`); `START_FAILED` tears down zombie `VoiceSessionManager`.

**Goal:** Bring Friday’s realtime voice path up to locked first-pass xAI Voice Agent capabilities: track `grok-voice-latest`, session resumption with a visible reconnecting state, tunable VAD silence via env, and `force_message` greetings.

**Architecture:** Keep the existing proxy model (browser ↔ Friday `/ws` ↔ Grok realtime). Extend `openGrokWebSocket` for model + optional `conversation_id`; teach `VoiceSessionManager` to opt into `resumption`, reconnect with backoff while emitting `"reconnecting"`, apply `silence_duration_ms` on `session.update`, and send a `force_message` greeting after session ready. Cascade the new voice state through server protocol and web orb.

**Tech Stack:** TypeScript, Bun, Bun WebSocket, xAI Speech-to-Speech Realtime API, existing VoiceSessionManager / VoiceWorker / web voice UI

**Spec:** [`docs/superpowers/specs/2026-08-02-xai-voice-agent-gap-analysis.md`](../specs/2026-08-02-xai-voice-agent-gap-analysis.md) (Locked adoption set — First implementation pass)

## Global Constraints

- Track `grok-voice-latest` by default; allow override via `FRIDAY_VOICE_MODEL`
- Keep `turn_detection.create_response: false` (Friday owns the agent loop via VoiceWorker)
- Reconnect UX must be **visible** (`"reconnecting"` state), not silent
- Do **not** implement binary audio transport in this plan (fast follow-up)
- Do **not** enable xAI built-in tools / MCP / ephemeral tokens / custom voices
- Work in the existing `feature/deps-upgrade-voice-audit` worktree (or continue that branch)
- TDD: failing test → implement → pass → commit per task
- Runtime: Bun (`bun test`, not jest/vitest)

## File map

| File | Responsibility |
|------|----------------|
| `src/core/voice/types.ts` | URL base, defaults for model + silence ms, env resolvers |
| `src/core/voice/ws.ts` | Build realtime URL (`model`, optional `conversation_id`); open WS |
| `src/core/voice/session-manager.ts` | session.update fields, resumption, reconnect, force_message greeting |
| `src/core/voice/force-message.ts` | Pure helper to build `force_message` payload (new) |
| `src/server/protocol.ts` | Add `"reconnecting"` to `voice:state` union |
| `src/server/handler.ts` | Pass silence/model config into VoiceSessionManager |
| `web/src/components/voice/types.ts` | `VoiceState` includes `"reconnecting"` |
| `web/src/components/voice/constants.ts` | Color for reconnecting |
| `web/src/hooks/useVoiceSession.ts` | Accept `"reconnecting"` from server |
| `tests/unit/voice-ws-url.test.ts` | URL builder tests (new) |
| `tests/unit/voice-session-manager.test.ts` | Session update / reconnect / greeting tests |
| `tests/unit/voice-force-message.test.ts` | force_message payload tests (new) |
| `CLAUDE.md` | Document new env vars |

---

### Task 1: Realtime URL builder (`model` + optional `conversation_id`)

**Files:**
- Modify: `src/core/voice/types.ts`
- Modify: `src/core/voice/ws.ts`
- Create: `tests/unit/voice-ws-url.test.ts`
- Modify: `tests/unit/vox-types.test.ts` (GROK_REALTIME_URL still base-only)

**Interfaces:**
- Produces:
  - `GROK_VOICE_MODEL_DEFAULT = "grok-voice-latest"`
  - `resolveVoiceModel(): string` — `process.env.FRIDAY_VOICE_MODEL?.trim() || GROK_VOICE_MODEL_DEFAULT`
  - `buildGrokRealtimeUrl(opts?: { model?: string; conversationId?: string }): string`
  - `openGrokWebSocket(apiKey, timeoutMs?, opts?: { model?: string; conversationId?: string }): Promise<WebSocket>`

- [ ] **Step 1: Write the failing URL tests**

Create `tests/unit/voice-ws-url.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "bun:test";
import {
	GROK_REALTIME_URL,
	GROK_VOICE_MODEL_DEFAULT,
	buildGrokRealtimeUrl,
	resolveVoiceModel,
} from "../../src/core/voice/types.ts";

describe("buildGrokRealtimeUrl", () => {
	const prev = process.env.FRIDAY_VOICE_MODEL;
	afterEach(() => {
		if (prev === undefined) delete process.env.FRIDAY_VOICE_MODEL;
		else process.env.FRIDAY_VOICE_MODEL = prev;
	});

	test("defaults to grok-voice-latest query param", () => {
		delete process.env.FRIDAY_VOICE_MODEL;
		expect(buildGrokRealtimeUrl()).toBe(
			`${GROK_REALTIME_URL}?model=${GROK_VOICE_MODEL_DEFAULT}`,
		);
	});

	test("FRIDAY_VOICE_MODEL overrides default", () => {
		process.env.FRIDAY_VOICE_MODEL = "grok-voice-think-fast-2.0";
		expect(resolveVoiceModel()).toBe("grok-voice-think-fast-2.0");
		expect(buildGrokRealtimeUrl()).toBe(
			`${GROK_REALTIME_URL}?model=grok-voice-think-fast-2.0`,
		);
	});

	test("explicit model option wins over env", () => {
		process.env.FRIDAY_VOICE_MODEL = "from-env";
		expect(buildGrokRealtimeUrl({ model: "explicit" })).toBe(
			`${GROK_REALTIME_URL}?model=explicit`,
		);
	});

	test("appends conversation_id when provided", () => {
		expect(buildGrokRealtimeUrl({ conversationId: "conv_abc" })).toBe(
			`${GROK_REALTIME_URL}?model=${GROK_VOICE_MODEL_DEFAULT}&conversation_id=conv_abc`,
		);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/unit/voice-ws-url.test.ts`

Expected: FAIL — `buildGrokRealtimeUrl` / `resolveVoiceModel` / `GROK_VOICE_MODEL_DEFAULT` not exported

- [ ] **Step 3: Implement types + wire `openGrokWebSocket`**

In `src/core/voice/types.ts` add:

```typescript
export const GROK_VOICE_MODEL_DEFAULT = "grok-voice-latest";

export function resolveVoiceModel(): string {
	const fromEnv = process.env.FRIDAY_VOICE_MODEL?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : GROK_VOICE_MODEL_DEFAULT;
}

export function buildGrokRealtimeUrl(opts?: {
	model?: string;
	conversationId?: string;
}): string {
	const model = opts?.model?.trim() || resolveVoiceModel();
	const url = new URL(GROK_REALTIME_URL);
	url.searchParams.set("model", model);
	if (opts?.conversationId) {
		url.searchParams.set("conversation_id", opts.conversationId);
	}
	return url.toString();
}
```

In `src/core/voice/ws.ts`, change to:

```typescript
import { buildGrokRealtimeUrl } from "./types.ts";

export function openGrokWebSocket(
	apiKey: string,
	timeoutMs = 10_000,
	opts?: { model?: string; conversationId?: string },
): Promise<WebSocket> {
	return new Promise<WebSocket>((resolve, reject) => {
		const ws = new WebSocket(buildGrokRealtimeUrl(opts), {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		} as any);
		// ... existing timer / open / error handlers unchanged
	});
}
```

Keep `GROK_REALTIME_URL` as the bare base (`wss://api.x.ai/v1/realtime`) so existing `vox-types` tests stay valid.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test ./tests/unit/voice-ws-url.test.ts ./tests/unit/vox-types.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/voice/types.ts src/core/voice/ws.ts tests/unit/voice-ws-url.test.ts
git commit -m "$(cat <<'EOF'
feat(voice): connect realtime WS with grok-voice-latest model query

Track latest via FRIDAY_VOICE_MODEL override and support conversation_id for resumption.
EOF
)"
```

---

### Task 2: `silence_duration_ms` config + env

**Files:**
- Modify: `src/core/voice/types.ts`
- Modify: `src/core/voice/session-manager.ts` (`VoiceSessionConfig` + initial `session.update`)
- Modify: `src/server/handler.ts` (pass resolved silence into config)
- Modify: `tests/unit/voice-session-manager.test.ts`

**Interfaces:**
- Consumes: existing `VoiceSessionConfig`
- Produces:
  - `VOICE_SILENCE_MS_DEFAULT = 800`
  - `resolveVoiceSilenceMs(): number` — parse `FRIDAY_VOICE_SILENCE_MS` (integer 0–10000) or default
  - `VoiceSessionConfig.silenceDurationMs: number`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/voice-ws-url.test.ts` (or new `tests/unit/voice-config.test.ts`):

```typescript
import { resolveVoiceSilenceMs, VOICE_SILENCE_MS_DEFAULT } from "../../src/core/voice/types.ts";

describe("resolveVoiceSilenceMs", () => {
	const prev = process.env.FRIDAY_VOICE_SILENCE_MS;
	afterEach(() => {
		if (prev === undefined) delete process.env.FRIDAY_VOICE_SILENCE_MS;
		else process.env.FRIDAY_VOICE_SILENCE_MS = prev;
	});

	test("defaults to 800", () => {
		delete process.env.FRIDAY_VOICE_SILENCE_MS;
		expect(resolveVoiceSilenceMs()).toBe(VOICE_SILENCE_MS_DEFAULT);
	});

	test("parses valid env", () => {
		process.env.FRIDAY_VOICE_SILENCE_MS = "600";
		expect(resolveVoiceSilenceMs()).toBe(600);
	});

	test("falls back on invalid env", () => {
		process.env.FRIDAY_VOICE_SILENCE_MS = "nope";
		expect(resolveVoiceSilenceMs()).toBe(VOICE_SILENCE_MS_DEFAULT);
	});

	test("clamps above 10000", () => {
		process.env.FRIDAY_VOICE_SILENCE_MS = "99999";
		expect(resolveVoiceSilenceMs()).toBe(10000);
	});
});
```

Add a session-manager test that inspects the first `session.update` after a mocked start path — easiest approach: extract `buildInitialSessionUpdate(config)` pure function from session-manager (or test via attaching mock WS and calling a new package-visible helper). Prefer a pure builder:

```typescript
// In session-manager.ts (exported for tests)
export function buildInitialSessionPayload(config: VoiceSessionConfig) {
	return {
		type: "session.update" as const,
		session: {
			voice: config.voice,
			instructions: config.instructions,
			resumption: { enabled: true },
			turn_detection: {
				type: "server_vad" as const,
				create_response: false,
				silence_duration_ms: config.silenceDurationMs,
			},
			input_audio_transcription: { model: "whisper-1" },
			audio: {
				input: { format: { type: "audio/pcm", rate: config.sampleRate } },
				output: { format: { type: "audio/pcm", rate: config.sampleRate } },
			},
		},
	};
}
```

Test:

```typescript
test("initial session.update includes silence_duration_ms and resumption", () => {
	const payload = buildInitialSessionPayload({
		voice: "Eve",
		sampleRate: 48000,
		instructions: "Test",
		silenceDurationMs: 600,
	});
	expect(payload.session.turn_detection.silence_duration_ms).toBe(600);
	expect(payload.session.resumption).toEqual({ enabled: true });
	expect(payload.session.turn_detection.create_response).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/unit/voice-ws-url.test.ts ./tests/unit/voice-session-manager.test.ts`

Expected: FAIL — missing exports / fields

- [ ] **Step 3: Implement resolve + session payload**

Add to `types.ts`:

```typescript
export const VOICE_SILENCE_MS_DEFAULT = 800;

export function resolveVoiceSilenceMs(): number {
	const raw = process.env.FRIDAY_VOICE_SILENCE_MS?.trim();
	if (!raw) return VOICE_SILENCE_MS_DEFAULT;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return VOICE_SILENCE_MS_DEFAULT;
	return Math.min(n, 10_000);
}
```

Extend `VoiceSessionConfig`:

```typescript
export interface VoiceSessionConfig {
	voice: GrokVoice;
	sampleRate: number;
	instructions: string;
	silenceDurationMs: number;
	debug?: boolean;
}
```

Refactor `session-manager.ts` `start()` to send `JSON.stringify(buildInitialSessionPayload(this.config))`.

In `handler.ts` voice:start:

```typescript
const sessionConfig: VoiceSessionConfig = {
	voice,
	sampleRate: 48000,
	instructions: FRIDAY_VOICE_IDENTITY,
	silenceDurationMs: resolveVoiceSilenceMs(),
};
```

Update every test that constructs `VoiceSessionConfig` to include `silenceDurationMs: 800` (or whatever).

- [ ] **Step 4: Run tests**

Run: `bun test ./tests/unit/voice-session-manager.test.ts ./tests/unit/voice-ws-url.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/voice/types.ts src/core/voice/session-manager.ts src/server/handler.ts tests/unit/voice-session-manager.test.ts tests/unit/voice-ws-url.test.ts
git commit -m "$(cat <<'EOF'
feat(voice): configure VAD silence_duration_ms via FRIDAY_VOICE_SILENCE_MS

Opt into session resumption on initial session.update while keeping create_response false.
EOF
)"
```

---

### Task 3: Add `"reconnecting"` to VoiceState (protocol + web)

**Files:**
- Modify: `src/core/voice/session-manager.ts` (`VoiceState` union)
- Modify: `src/server/protocol.ts`
- Modify: `web/src/components/voice/types.ts`
- Modify: `web/src/components/voice/constants.ts`
- Modify: `web/src/hooks/useVoiceSession.ts` (local `VoiceState` duplicate — align or import)
- Modify: any status copy that maps state → label (search `speaking` / `thinking` strings)

**Interfaces:**
- Produces: `VoiceState = "idle" | "listening" | "thinking" | "speaking" | "reconnecting" | "error"`

- [ ] **Step 1: Write a failing protocol-shape test**

If no existing protocol test covers voice states, add to `tests/unit/voice-session-manager.test.ts`:

```typescript
import type { VoiceState } from "../../src/core/voice/session-manager.ts";

test("VoiceState includes reconnecting", () => {
	const states: VoiceState[] = [
		"idle",
		"listening",
		"thinking",
		"speaking",
		"reconnecting",
		"error",
	];
	expect(states).toContain("reconnecting");
});
```

And assert web constants compile by importing `STATE_COLORS.reconnecting` from a small test or typecheck later.

- [ ] **Step 2: Run typecheck after partial edits will fail — implement state everywhere**

Update unions in:
- `session-manager.ts`
- `protocol.ts` (`voice:state`)
- `web/.../types.ts`
- `web/.../useVoiceSession.ts` (duplicate type)
- `constants.ts`:

```typescript
reconnecting: { r: 196, g: 160, b: 80 }, // dimmer amber pulse
```

If `VoiceStatus` / orb maps states to labels, add `"reconnecting"` → `"Reconnecting…"`.

- [ ] **Step 3: Run typecheck + unit tests**

Run:

```bash
bun run typecheck
bun test ./tests/unit/voice-session-manager.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/voice/session-manager.ts src/server/protocol.ts web/src/components/voice/types.ts web/src/components/voice/constants.ts web/src/hooks/useVoiceSession.ts
git commit -m "$(cat <<'EOF'
feat(voice): add reconnecting state across server protocol and web orb
EOF
)"
```

---

### Task 4: Session resumption + reconnect with visible state

**Files:**
- Modify: `src/core/voice/ws.ts` (already accepts `conversationId`)
- Modify: `src/core/voice/session-manager.ts`
- Modify: `tests/unit/voice-session-manager.test.ts`

**Interfaces:**
- Consumes: `buildGrokRealtimeUrl`, `openGrokWebSocket`, `buildInitialSessionPayload`
- Produces:
  - Private `_conversationId: string | null`
  - On `conversation.created` → store `data.conversation.id`
  - On unexpected close while `active` → emit `"reconnecting"`, backoff reconnect (max 5 attempts: 500ms, 1s, 2s, 4s, 8s), pass `conversationId`, re-send initial session.update with `resumption.enabled: true`
  - Exhausted attempts → `"error"`
  - User `stop()` cancels reconnect loop (generation bump already present)

- [ ] **Step 1: Write failing reconnect tests**

```typescript
test("stores conversation id from conversation.created", async () => {
	const callbacks = makeMockCallbacks();
	const manager = new VoiceSessionManager(cortex, config, callbacks);
	attachMockWs(manager);
	await (manager as any).handleGrokMessage(
		JSON.stringify({
			type: "conversation.created",
			conversation: { id: "conv_123" },
		}),
	);
	expect((manager as any)._conversationId).toBe("conv_123");
});

test("unexpected close while active emits reconnecting then reopens", async () => {
	const states: string[] = [];
	const callbacks = makeMockCallbacks();
	callbacks.onStateChange = mock((s: string) => {
		states.push(s);
	});
	const manager = new VoiceSessionManager(cortex, config, callbacks);
	(manager as any).active = true;
	(manager as any)._generation = 1;
	(manager as any)._conversationId = "conv_123";

	// Inject a fake reconnect opener that resolves immediately
	const opens: Array<{ conversationId?: string }> = [];
	(manager as any)._openSocket = async (opts: { conversationId?: string }) => {
		opens.push(opts);
		const ws = {
			send: mock(() => {}),
			readyState: 1,
			close: mock(() => {}),
			addEventListener: mock(() => {}),
		};
		(manager as any).grokWs = ws;
		return ws;
	};
	(manager as any)._reconnectDelaysMs = [0]; // no wait in tests

	await (manager as any).handleSocketClose(1);
	expect(states).toContain("reconnecting");
	expect(opens[0]?.conversationId).toBe("conv_123");
});
```

Refactor session-manager so reconnect uses injectable `_openSocket` (defaults to `openGrokWebSocket`) and `_reconnectDelaysMs` (defaults to `[500,1000,2000,4000,8000]`) — keeps tests deterministic.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/unit/voice-session-manager.test.ts -t "conversation|reconnect"`

Expected: FAIL

- [ ] **Step 3: Implement reconnect loop**

Sketch (place in `session-manager.ts`):

```typescript
private _conversationId: string | null = null;
private _reconnectDelaysMs = [500, 1000, 2000, 4000, 8000];
private _openSocket = (opts?: { conversationId?: string }) =>
	openGrokWebSocket(process.env.XAI_API_KEY!, 10_000, {
		conversationId: opts?.conversationId,
	});

// In handleGrokMessage:
case "conversation.created": {
	const id = data.conversation?.id;
	if (typeof id === "string" && id.length > 0) this._conversationId = id;
	break;
}

// Replace close handler body with:
private async handleSocketClose(gen: number): Promise<void> {
	if (this._generation !== gen) return;
	this.grokWs = null;
	if (!this.active) return;

	this.emitStateChange("reconnecting");
	for (const delay of this._reconnectDelaysMs) {
		if (this._generation !== gen || !this.active) return;
		if (delay > 0) await Bun.sleep(delay);
		if (this._generation !== gen || !this.active) return;
		try {
			const ws = await this._openSocket({
				conversationId: this._conversationId ?? undefined,
			});
			if (this._generation !== gen || !this.active) {
				try { ws.close(); } catch {}
				return;
			}
			this.grokWs = ws;
			this.bindSocketHandlers(ws, gen); // extract from start()
			ws.send(JSON.stringify(buildInitialSessionPayload(this.config)));
			this.voiceWorker = new VoiceWorker({ send: (d) => this.sendToGrok(d) });
			this.emitStateChange("listening");
			return;
		} catch {
			// try next delay
		}
	}
	this.active = false;
	this.emitStateChange("error");
}
```

Extract `bindSocketHandlers(ws, gen)` from current `start()` so reconnect reuses the same message/error/close wiring. On intentional `stop()`, bump generation / set `active=false` **before** closing so close handler does not reconnect.

- [ ] **Step 4: Run tests**

Run: `bun test ./tests/unit/voice-session-manager.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/voice/session-manager.ts tests/unit/voice-session-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(voice): resume Grok sessions with visible reconnecting state

Capture conversation_id, reconnect with backoff, and re-opt into resumption.
EOF
)"
```

---

### Task 5: `force_message` greeting on session start

**Files:**
- Create: `src/core/voice/force-message.ts`
- Create: `tests/unit/voice-force-message.test.ts`
- Modify: `src/core/voice/session-manager.ts` (send greeting after session ready)
- Optional: `src/core/voice/narration.ts` or a constant greeting string in `force-message.ts`

**Interfaces:**
- Produces:

```typescript
export function buildForceMessagePayload(
	text: string,
	opts?: { interruptible?: boolean },
): {
	type: "conversation.item.create";
	item: {
		type: "force_message";
		role: "assistant";
		interruptible: boolean;
		content: Array<{ type: "output_text"; text: string }>;
	};
}

export const VOICE_SESSION_GREETING = "Systems online. I'm listening.";
```

- Do **not** send `response.create` after force_message.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import {
	VOICE_SESSION_GREETING,
	buildForceMessagePayload,
} from "../../src/core/voice/force-message.ts";

describe("buildForceMessagePayload", () => {
	test("builds xAI force_message item", () => {
		const msg = buildForceMessagePayload(VOICE_SESSION_GREETING, {
			interruptible: false,
		});
		expect(msg.type).toBe("conversation.item.create");
		expect(msg.item.type).toBe("force_message");
		expect(msg.item.role).toBe("assistant");
		expect(msg.item.interruptible).toBe(false);
		expect(msg.item.content[0]).toEqual({
			type: "output_text",
			text: VOICE_SESSION_GREETING,
		});
	});
});
```

Session-manager test: after mock start / `session.updated`, expect a sent payload with `force_message` (and no trailing `response.create` for that greeting).

```typescript
test("sends force_message greeting after session.updated", async () => {
	const manager = new VoiceSessionManager(cortex, config, makeMockCallbacks());
	const sent = attachMockWs(manager);
	await (manager as any).onSessionReady(); // extract hook called from session.updated
	const force = sent
		.map((s) => JSON.parse(s))
		.find((m) => m.item?.type === "force_message");
	expect(force).toBeDefined();
	expect(force.item.content[0].text).toBe(VOICE_SESSION_GREETING);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/unit/voice-force-message.test.ts ./tests/unit/voice-session-manager.test.ts -t "force_message|greeting"`

Expected: FAIL

- [ ] **Step 3: Implement helper + call from session.updated**

```typescript
// force-message.ts — as above

// session-manager.ts
case "session.updated": {
	if (!this._greeted) {
		this._greeted = true;
		this.sendToGrok(JSON.stringify(buildForceMessagePayload(VOICE_SESSION_GREETING, { interruptible: true })));
	}
	break;
}
```

Reset `_greeted` on intentional `stop()` only (not on mid-session reconnect — avoid re-greeting every blip). On reconnect after `stop()`+`start()`, greeting runs again.

- [ ] **Step 4: Run tests**

Run: `bun test ./tests/unit/voice-force-message.test.ts ./tests/unit/voice-session-manager.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/voice/force-message.ts src/core/voice/session-manager.ts tests/unit/voice-force-message.test.ts tests/unit/voice-session-manager.test.ts
git commit -m "$(cat <<'EOF'
feat(voice): greet with xAI force_message on session ready

Speak a scripted line without involving the voice agent turn loop.
EOF
)"
```

---

### Task 6: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` (Environment section)
- Optionally one-line pointer in gap spec that first pass is planned

- [ ] **Step 1: Document env vars in CLAUDE.md**

Under Environment, add:

```markdown
Optional: `FRIDAY_VOICE_MODEL` to override realtime voice model (default `grok-voice-latest`).
Optional: `FRIDAY_VOICE_SILENCE_MS` to set server VAD silence duration in ms (default `800`, max `10000`).
```

- [ ] **Step 2: Run full verification**

```bash
bun run typecheck
bun run lint
bun test
bun run web:build
```

Expected: typecheck/lint clean (warnings OK), all tests pass, web build succeeds

- [ ] **Step 3: Commit docs**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: document FRIDAY_VOICE_MODEL and FRIDAY_VOICE_SILENCE_MS
EOF
)"
```

---

## Out of scope (next plan)

- **Binary audio transport** (locked as fast follow-up) — new plan after this one lands
- Built-in xAI tools / Clearance policy
- Pronunciation `replace`, custom voices, reasoning.effort, Vox/STT unification

---

## Spec coverage self-check

| Locked first-pass item | Task |
|------------------------|------|
| (1) `?model=grok-voice-latest` + env | Task 1 |
| (2) Resumption + visible reconnect | Tasks 2 (opt-in flag), 3 (state), 4 (loop) |
| (4) `silence_duration_ms` + env | Task 2 |
| (6) `force_message` greetings | Task 5 |
| Docs | Task 6 |

Placeholder scan: none intentional. Binary explicitly deferred.
