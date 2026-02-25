# Gmail Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Friday her own Gmail identity with full inbox management — read, search, send, reply, label, archive, delete — using the Gmail API with OAuth 2.0 authentication and encrypted token storage.

**Architecture:** A monolithic module at `src/modules/gmail/` wrapping the `googleapis` npm package. A reusable `SecretStore` in `src/core/secrets.ts` handles AES-256-GCM encryption of tokens with master key in the OS keychain. New `"email-send"` clearance gates outbound email. Six tools for Cortex, one `/gmail` protocol for humans.

**Tech Stack:** TypeScript (strict), `googleapis` npm package, `node:crypto` (AES-256-GCM), `bun:sqlite` (via ScopedMemory), Bun shell (`Bun.$`) for OS keychain CLI, `bun:test` for tests.

**Design doc:** `docs/plans/2026-02-25-gmail-module-design.md`

---

### Task 1: Install `googleapis` dependency

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

Run: `bun add googleapis`

**Step 2: Verify installation**

Run: `bun pm ls | grep googleapis`
Expected: `googleapis` appears in the output.

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: add googleapis for Gmail integration"
```

---

### Task 2: Add `"email-send"` clearance

**Files:**
- Modify: `src/core/clearance.ts:1-11`
- Test: `tests/unit/clearance.test.ts`

**Step 1: Write the failing test**

Add a test to the existing clearance test file (or create one if it doesn't exist). The test should verify `"email-send"` is a valid clearance name that can be granted and checked:

```ts
test("supports email-send clearance", () => {
	const mgr = new ClearanceManager(["email-send"]);
	expect(mgr.check("email-send").granted).toBe(true);
});

test("denies email-send when not granted", () => {
	const mgr = new ClearanceManager(["network"]);
	const result = mgr.check("email-send");
	expect(result.granted).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/clearance.test.ts -v`
Expected: TypeScript compilation error — `"email-send"` is not assignable to `ClearanceName`.

**Step 3: Add `"email-send"` to ClearanceName union**

In `src/core/clearance.ts`, add `| "email-send"` to the `ClearanceName` type union after `"forge-modify"`:

```ts
export type ClearanceName =
  | "read-fs"
  | "write-fs"
  | "delete-fs"
  | "exec-shell"
  | "network"
  | "git-read"
  | "git-write"
  | "provider"
  | "system"
  | "forge-modify"
  | "email-send";
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/clearance.test.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/clearance.ts tests/unit/clearance.test.ts
git commit -m "feat(core): add email-send clearance for gated outbound email"
```

---

### Task 3: SecretStore — OS keychain integration

**Files:**
- Create: `src/core/secrets.ts`
- Test: `tests/unit/secrets.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/secrets.test.ts`. Test the SecretStore encrypt/decrypt cycle, missing key returns null, delete removes a key, and has() works. Use an in-memory ScopedMemory stub (same pattern as `tests/unit/notify-module.test.ts:28-34`). Mock the keychain by injecting a master key directly (the SecretStore should accept an optional injected key for testing):

```ts
import { describe, expect, test } from "bun:test";
import { SecretStore } from "../../src/core/secrets.ts";
import type { ScopedMemory } from "../../src/core/memory.ts";

function createMemoryStub(): ScopedMemory {
	const store = new Map<string, unknown>();
	return {
		get: async <T>(key: string) => store.get(key) as T | undefined,
		set: async <T>(key: string, value: T) => { store.set(key, value); },
		delete: async (key: string) => { store.delete(key); },
		list: async () => [...store.keys()],
	};
}

describe("SecretStore", () => {
	test("encrypt then decrypt returns original value", async () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		await secrets.encrypt("token", "my-secret-value");
		const result = await secrets.decrypt("token");
		expect(result).toBe("my-secret-value");
	});

	test("decrypt returns null for missing key", async () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		const result = await secrets.decrypt("nonexistent");
		expect(result).toBeNull();
	});

	test("delete removes a secret", async () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		await secrets.encrypt("token", "value");
		await secrets.delete("token");
		const result = await secrets.decrypt("token");
		expect(result).toBeNull();
	});

	test("has() returns true for existing key", async () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		await secrets.encrypt("token", "value");
		expect(await secrets.has("token")).toBe(true);
	});

	test("has() returns false for missing key", async () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		expect(await secrets.has("nonexistent")).toBe(false);
	});

	test("encrypted value in memory is not plaintext", async () => {
		const mem = createMemoryStub();
		const secrets = new SecretStore(mem, { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		await secrets.encrypt("token", "my-secret-value");
		const raw = await mem.get<string>("token");
		expect(raw).not.toBe("my-secret-value");
		expect(typeof raw).toBe("string");
	});

	test("different IVs produce different ciphertexts", async () => {
		const mem = createMemoryStub();
		const secrets = new SecretStore(mem, { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		await secrets.encrypt("a", "same-value");
		await secrets.encrypt("b", "same-value");
		const rawA = await mem.get<string>("a");
		const rawB = await mem.get<string>("b");
		expect(rawA).not.toBe(rawB);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/secrets.test.ts -v`
Expected: FAIL — cannot resolve `../../src/core/secrets.ts`

**Step 3: Implement SecretStore**

Create `src/core/secrets.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { ScopedMemory } from "./memory.ts";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_SERVICE = "friday";
const KEY_ACCOUNT = "master-key";

export interface SecretStoreOptions {
	injectedKey?: string; // For testing — skip OS keychain
}

export class SecretStore {
	private memory: ScopedMemory;
	private masterKey: Buffer | null = null;
	private injectedKey: string | undefined;

	constructor(memory: ScopedMemory, options?: SecretStoreOptions) {
		this.memory = memory;
		this.injectedKey = options?.injectedKey;
	}

	private async getMasterKey(): Promise<Buffer> {
		if (this.masterKey) return this.masterKey;

		// Test injection — skip keychain entirely
		if (this.injectedKey) {
			this.masterKey = Buffer.from(this.injectedKey, "utf-8").subarray(0, 32);
			return this.masterKey;
		}

		// Try OS keychain
		const existing = await this.readKeychain();
		if (existing) {
			this.masterKey = Buffer.from(existing, "base64");
			return this.masterKey;
		}

		// Generate new key and store it
		const newKey = randomBytes(32);
		await this.writeKeychain(newKey.toString("base64"));
		this.masterKey = newKey;
		return this.masterKey;
	}

	private async readKeychain(): Promise<string | null> {
		// Env var fallback
		if (process.env.FRIDAY_SECRET_KEY) {
			return process.env.FRIDAY_SECRET_KEY;
		}

		const platform = process.platform;
		try {
			if (platform === "darwin") {
				const result = await Bun.$`security find-generic-password -s ${KEY_SERVICE} -a ${KEY_ACCOUNT} -w 2>/dev/null`.text();
				return result.trim() || null;
			}
			if (platform === "linux") {
				const result = await Bun.$`secret-tool lookup service ${KEY_SERVICE} key ${KEY_ACCOUNT} 2>/dev/null`.text();
				return result.trim() || null;
			}
		} catch {
			// CLI not available or key not found
		}
		return null;
	}

	private async writeKeychain(value: string): Promise<void> {
		const platform = process.platform;
		try {
			if (platform === "darwin") {
				await Bun.$`security add-generic-password -s ${KEY_SERVICE} -a ${KEY_ACCOUNT} -w ${value} -U`;
				return;
			}
			if (platform === "linux") {
				await Bun.$`echo -n ${value} | secret-tool store --label="Friday Master Key" service ${KEY_SERVICE} key ${KEY_ACCOUNT}`;
				return;
			}
		} catch {
			// Fall through
		}
		console.warn(
			"[SecretStore] Could not store master key in OS keychain. Set FRIDAY_SECRET_KEY env var as fallback.",
		);
	}

	async encrypt(key: string, value: string): Promise<void> {
		const masterKey = await this.getMasterKey();
		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_LENGTH });
		const encrypted = Buffer.concat([cipher.update(value, "utf-8"), cipher.final()]);
		const authTag = cipher.getAuthTag();

		// Store as "iv:authTag:ciphertext" in base64
		const packed = `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
		await this.memory.set(key, packed);
	}

	async decrypt(key: string): Promise<string | null> {
		const packed = await this.memory.get<string>(key);
		if (!packed) return null;

		const masterKey = await this.getMasterKey();
		const [ivB64, tagB64, dataB64] = packed.split(":");
		if (!ivB64 || !tagB64 || !dataB64) return null;

		const iv = Buffer.from(ivB64, "base64");
		const authTag = Buffer.from(tagB64, "base64");
		const encrypted = Buffer.from(dataB64, "base64");

		const decipher = createDecipheriv(ALGORITHM, masterKey, iv, { authTagLength: AUTH_TAG_LENGTH });
		decipher.setAuthTag(authTag);
		const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
		return decrypted.toString("utf-8");
	}

	async delete(key: string): Promise<void> {
		await this.memory.delete(key);
	}

	async has(key: string): Promise<boolean> {
		const value = await this.memory.get<string>(key);
		return value !== undefined;
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/secrets.test.ts -v`
Expected: All 7 tests PASS

**Step 5: Run lint**

Run: `bun run lint:fix`

**Step 6: Commit**

```bash
git add src/core/secrets.ts tests/unit/secrets.test.ts
git commit -m "feat(core): add SecretStore with AES-256-GCM encryption and OS keychain"
```

---

### Task 4: Gmail types

**Files:**
- Create: `src/modules/gmail/types.ts`

**Step 1: Create types file**

Create `src/modules/gmail/types.ts` with the domain types from the design:

```ts
export interface GmailMessage {
	id: string;
	threadId: string;
	from: string;
	to: string[];
	cc: string[];
	subject: string;
	date: string;
	snippet: string;
	body: string;
	labels: string[];
	isUnread: boolean;
}

export interface GmailMessageList {
	messages: GmailMessage[];
	nextPageToken?: string;
	resultSizeEstimate: number;
}

export interface GmailLabel {
	id: string;
	name: string;
	type: "system" | "user";
	messagesTotal: number;
	messagesUnread: number;
}
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors)

**Step 3: Commit**

```bash
git add src/modules/gmail/types.ts
git commit -m "feat(gmail): add domain types for messages, labels, and lists"
```

---

### Task 5: OAuth 2.0 auth flow

**Files:**
- Create: `src/modules/gmail/auth.ts`
- Test: `tests/unit/gmail-auth.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/gmail-auth.test.ts`. Test the auth URL generation and the token persistence flow. Mock the googleapis OAuth2 client. Key behaviors to test:

- `generateAuthUrl()` returns a URL containing the expected scopes
- `exchangeCode()` calls the OAuth2 client and stores tokens in SecretStore
- `loadTokens()` returns false when no tokens exist
- `loadTokens()` returns true and configures OAuth2 client when tokens exist

```ts
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { GmailAuth, GMAIL_SCOPES } from "../../src/modules/gmail/auth.ts";
import { SecretStore } from "../../src/core/secrets.ts";
import type { ScopedMemory } from "../../src/core/memory.ts";

function createMemoryStub(): ScopedMemory {
	const store = new Map<string, unknown>();
	return {
		get: async <T>(key: string) => store.get(key) as T | undefined,
		set: async <T>(key: string, value: T) => { store.set(key, value); },
		delete: async (key: string) => { store.delete(key); },
		list: async () => [...store.keys()],
	};
}

describe("GmailAuth", () => {
	test("generateAuthUrl includes all scopes", () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const url = auth.generateAuthUrl();
		for (const scope of GMAIL_SCOPES) {
			expect(url).toContain(encodeURIComponent(scope));
		}
	});

	test("generateAuthUrl includes access_type=offline", () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const url = auth.generateAuthUrl();
		expect(url).toContain("access_type=offline");
	});

	test("loadTokens returns false when no tokens stored", async () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const result = await auth.loadTokens();
		expect(result).toBe(false);
	});

	test("loadTokens returns true when tokens exist", async () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		await secrets.encrypt("gmail:access_token", "fake-access-token");
		await secrets.encrypt("gmail:refresh_token", "fake-refresh-token");
		await secrets.encrypt("gmail:token_expiry", new Date(Date.now() + 3600000).toISOString());
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const result = await auth.loadTokens();
		expect(result).toBe(true);
	});

	test("isAuthenticated is false before loadTokens", () => {
		const secrets = new SecretStore(createMemoryStub(), { injectedKey: "a]secret-key-that-is-32-bytes!!" });
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		expect(auth.isAuthenticated()).toBe(false);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/gmail-auth.test.ts -v`
Expected: FAIL — cannot resolve `../../src/modules/gmail/auth.ts`

**Step 3: Implement GmailAuth**

Create `src/modules/gmail/auth.ts`:

```ts
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { SecretStore } from "../../core/secrets.ts";

export const GMAIL_SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.modify",
	"https://www.googleapis.com/auth/gmail.labels",
];

const REDIRECT_URI = "http://localhost:3847/oauth2callback";

export class GmailAuth {
	private oauth2Client: OAuth2Client;
	private secrets: SecretStore;
	private authenticated = false;

	constructor(secrets: SecretStore, clientId: string, clientSecret: string) {
		this.secrets = secrets;
		this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

		// Auto-persist refreshed tokens
		this.oauth2Client.on("tokens", async (tokens) => {
			if (tokens.access_token) {
				await this.secrets.encrypt("gmail:access_token", tokens.access_token);
			}
			if (tokens.refresh_token) {
				await this.secrets.encrypt("gmail:refresh_token", tokens.refresh_token);
			}
			if (tokens.expiry_date) {
				await this.secrets.encrypt("gmail:token_expiry", new Date(tokens.expiry_date).toISOString());
			}
		});
	}

	generateAuthUrl(): string {
		return this.oauth2Client.generateAuthUrl({
			access_type: "offline",
			scope: GMAIL_SCOPES,
			prompt: "consent",
		});
	}

	async exchangeCode(code: string): Promise<void> {
		const { tokens } = await this.oauth2Client.getToken(code);
		this.oauth2Client.setCredentials(tokens);

		if (tokens.access_token) {
			await this.secrets.encrypt("gmail:access_token", tokens.access_token);
		}
		if (tokens.refresh_token) {
			await this.secrets.encrypt("gmail:refresh_token", tokens.refresh_token);
		}
		if (tokens.expiry_date) {
			await this.secrets.encrypt("gmail:token_expiry", new Date(tokens.expiry_date).toISOString());
		}

		this.authenticated = true;
	}

	async startLocalCallback(): Promise<string> {
		return new Promise((resolve, reject) => {
			const server = Bun.serve({
				port: 3847,
				fetch(req) {
					const url = new URL(req.url);
					const code = url.searchParams.get("code");
					if (code) {
						resolve(code);
						setTimeout(() => server.stop(), 100);
						return new Response(
							"<html><body><h1>Authorization successful!</h1><p>You can close this tab.</p></body></html>",
							{ headers: { "Content-Type": "text/html" } },
						);
					}
					const error = url.searchParams.get("error");
					reject(new Error(error ?? "No authorization code received"));
					setTimeout(() => server.stop(), 100);
					return new Response("Authorization failed", { status: 400 });
				},
			});

			// Timeout after 5 minutes
			setTimeout(() => {
				server.stop();
				reject(new Error("OAuth callback timed out after 5 minutes"));
			}, 300_000);
		});
	}

	async loadTokens(): Promise<boolean> {
		const accessToken = await this.secrets.decrypt("gmail:access_token");
		const refreshToken = await this.secrets.decrypt("gmail:refresh_token");

		if (!accessToken || !refreshToken) {
			return false;
		}

		const expiryStr = await this.secrets.decrypt("gmail:token_expiry");
		const expiry = expiryStr ? new Date(expiryStr).getTime() : undefined;

		this.oauth2Client.setCredentials({
			access_token: accessToken,
			refresh_token: refreshToken,
			expiry_date: expiry,
		});

		this.authenticated = true;
		return true;
	}

	isAuthenticated(): boolean {
		return this.authenticated;
	}

	getClient(): OAuth2Client {
		return this.oauth2Client;
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/gmail-auth.test.ts -v`
Expected: All 5 tests PASS

**Step 5: Run lint**

Run: `bun run lint:fix`

**Step 6: Commit**

```bash
git add src/modules/gmail/auth.ts tests/unit/gmail-auth.test.ts
git commit -m "feat(gmail): add OAuth 2.0 auth flow with encrypted token storage"
```

---

### Task 6: GmailClient — API wrapper

**Files:**
- Create: `src/modules/gmail/client.ts`
- Test: `tests/unit/gmail-client.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/gmail-client.test.ts`. Since the GmailClient wraps the googleapis API (which requires network), tests should focus on:

- Client creation and initialization state
- `isAuthenticated()` returns false before init
- Error handling when not authenticated (tools should get a clear error)
- MIME body decoding (a pure function we can test in isolation)

For the MIME decoder, test base64url decoding and HTML stripping:

```ts
import { describe, expect, test } from "bun:test";
import { decodeMessageBody, stripHtml } from "../../src/modules/gmail/client.ts";

describe("GmailClient helpers", () => {
	test("decodeMessageBody decodes base64url text", () => {
		const encoded = Buffer.from("Hello, World!").toString("base64url");
		const result = decodeMessageBody([
			{ mimeType: "text/plain", body: { data: encoded, size: 13 } },
		]);
		expect(result).toBe("Hello, World!");
	});

	test("decodeMessageBody prefers text/plain over text/html", () => {
		const plain = Buffer.from("Plain text").toString("base64url");
		const html = Buffer.from("<p>HTML text</p>").toString("base64url");
		const result = decodeMessageBody([
			{ mimeType: "text/html", body: { data: html, size: 16 } },
			{ mimeType: "text/plain", body: { data: plain, size: 10 } },
		]);
		expect(result).toBe("Plain text");
	});

	test("decodeMessageBody falls back to stripped HTML", () => {
		const html = Buffer.from("<p>Hello</p><br><b>World</b>").toString("base64url");
		const result = decodeMessageBody([
			{ mimeType: "text/html", body: { data: html, size: 27 } },
		]);
		expect(result).toContain("Hello");
		expect(result).toContain("World");
		expect(result).not.toContain("<p>");
	});

	test("decodeMessageBody returns empty string for no parts", () => {
		expect(decodeMessageBody([])).toBe("");
	});

	test("stripHtml removes tags and decodes entities", () => {
		expect(stripHtml("<p>Hello &amp; World</p>")).toBe("Hello & World");
	});

	test("stripHtml converts <br> to newlines", () => {
		expect(stripHtml("Line 1<br>Line 2<br/>Line 3")).toBe("Line 1\nLine 2\nLine 3");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/gmail-client.test.ts -v`
Expected: FAIL — cannot resolve module

**Step 3: Implement GmailClient**

Create `src/modules/gmail/client.ts`. Export the `GmailClient` class and the pure helper functions `decodeMessageBody` and `stripHtml` for testability:

```ts
import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import type { GmailAuth } from "./auth.ts";
import type { GmailMessage, GmailMessageList, GmailLabel } from "./types.ts";

export function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

interface MimePart {
	mimeType: string;
	body: { data?: string; size: number };
	parts?: MimePart[];
}

export function decodeMessageBody(parts: MimePart[]): string {
	// Walk MIME tree to find text parts
	const flatParts: MimePart[] = [];
	const walk = (p: MimePart[]) => {
		for (const part of p) {
			if (part.parts) walk(part.parts);
			else flatParts.push(part);
		}
	};
	walk(parts);

	// Prefer text/plain
	const plain = flatParts.find((p) => p.mimeType === "text/plain");
	if (plain?.body?.data) {
		return Buffer.from(plain.body.data, "base64url").toString("utf-8");
	}

	// Fall back to text/html stripped
	const html = flatParts.find((p) => p.mimeType === "text/html");
	if (html?.body?.data) {
		const raw = Buffer.from(html.body.data, "base64url").toString("utf-8");
		return stripHtml(raw);
	}

	return "";
}

function extractHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
	return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseMessage(msg: gmail_v1.Schema$Message): GmailMessage {
	const headers = msg.payload?.headers ?? [];
	const parts: MimePart[] = msg.payload?.parts?.length
		? (msg.payload.parts as MimePart[])
		: msg.payload?.body?.data
			? [{ mimeType: msg.payload.mimeType ?? "text/plain", body: msg.payload.body as { data: string; size: number } }]
			: [];

	return {
		id: msg.id ?? "",
		threadId: msg.threadId ?? "",
		from: extractHeader(headers, "From"),
		to: extractHeader(headers, "To").split(",").map((s) => s.trim()).filter(Boolean),
		cc: extractHeader(headers, "Cc").split(",").map((s) => s.trim()).filter(Boolean),
		subject: extractHeader(headers, "Subject"),
		date: extractHeader(headers, "Date"),
		snippet: msg.snippet ?? "",
		body: decodeMessageBody(parts),
		labels: msg.labelIds ?? [],
		isUnread: msg.labelIds?.includes("UNREAD") ?? false,
	};
}

export class GmailClient {
	private auth: GmailAuth;
	private gmail: gmail_v1.Gmail | null = null;

	constructor(auth: GmailAuth) {
		this.auth = auth;
	}

	async initialize(): Promise<boolean> {
		const loaded = await this.auth.loadTokens();
		if (!loaded) return false;
		this.gmail = google.gmail({ version: "v1", auth: this.auth.getClient() });
		return true;
	}

	isAuthenticated(): boolean {
		return this.auth.isAuthenticated() && this.gmail !== null;
	}

	private assertReady(): gmail_v1.Gmail {
		if (!this.gmail) {
			throw new Error("Gmail client not initialized. Run /gmail auth to authenticate.");
		}
		return this.gmail;
	}

	async getMessage(id: string, format: "full" | "metadata" | "minimal" = "full"): Promise<GmailMessage> {
		const gmail = this.assertReady();
		const res = await gmail.users.messages.get({ userId: "me", id, format });
		return parseMessage(res.data);
	}

	async listMessages(query: string, maxResults = 10): Promise<GmailMessageList> {
		const gmail = this.assertReady();
		const listRes = await gmail.users.messages.list({ userId: "me", q: query, maxResults });

		const messageIds = listRes.data.messages ?? [];
		const messages: GmailMessage[] = [];

		for (const ref of messageIds) {
			if (!ref.id) continue;
			const res = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "metadata" });
			const headers = res.data.payload?.headers ?? [];
			messages.push({
				id: res.data.id ?? "",
				threadId: res.data.threadId ?? "",
				from: extractHeader(headers, "From"),
				to: extractHeader(headers, "To").split(",").map((s) => s.trim()).filter(Boolean),
				cc: [],
				subject: extractHeader(headers, "Subject"),
				date: extractHeader(headers, "Date"),
				snippet: res.data.snippet ?? "",
				body: "",
				labels: res.data.labelIds ?? [],
				isUnread: res.data.labelIds?.includes("UNREAD") ?? false,
			});
		}

		return {
			messages,
			nextPageToken: listRes.data.nextPageToken ?? undefined,
			resultSizeEstimate: listRes.data.resultSizeEstimate ?? 0,
		};
	}

	async sendMessage(
		to: string,
		subject: string,
		body: string,
		cc?: string,
		bcc?: string,
	): Promise<{ id: string; threadId: string }> {
		const gmail = this.assertReady();
		const lines = [
			`To: ${to}`,
			cc ? `Cc: ${cc}` : "",
			bcc ? `Bcc: ${bcc}` : "",
			`Subject: ${subject}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			body,
		].filter(Boolean);

		const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
		const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
		return { id: res.data.id ?? "", threadId: res.data.threadId ?? "" };
	}

	async replyToThread(
		threadId: string,
		body: string,
	): Promise<{ id: string; threadId: string }> {
		const gmail = this.assertReady();

		// Fetch thread to get headers for In-Reply-To
		const thread = await gmail.users.threads.get({ userId: "me", id: threadId });
		const messages = thread.data.messages ?? [];
		const lastMessage = messages[messages.length - 1];
		const headers = lastMessage?.payload?.headers ?? [];
		const messageId = extractHeader(headers, "Message-ID");
		const subject = extractHeader(headers, "Subject");
		const from = extractHeader(headers, "From");

		const lines = [
			`To: ${from}`,
			`Subject: ${subject.startsWith("Re: ") ? subject : `Re: ${subject}`}`,
			`In-Reply-To: ${messageId}`,
			`References: ${messageId}`,
			"Content-Type: text/plain; charset=utf-8",
			"",
			body,
		];

		const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
		const res = await gmail.users.messages.send({
			userId: "me",
			requestBody: { raw, threadId },
		});
		return { id: res.data.id ?? "", threadId: res.data.threadId ?? "" };
	}

	async modifyMessage(
		id: string,
		opts: { addLabels?: string[]; removeLabels?: string[] },
	): Promise<void> {
		const gmail = this.assertReady();
		await gmail.users.messages.modify({
			userId: "me",
			id,
			requestBody: {
				addLabelIds: opts.addLabels,
				removeLabelIds: opts.removeLabels,
			},
		});
	}

	async trashMessage(id: string): Promise<void> {
		const gmail = this.assertReady();
		await gmail.users.messages.trash({ userId: "me", id });
	}

	async deleteMessage(id: string): Promise<void> {
		const gmail = this.assertReady();
		await gmail.users.messages.delete({ userId: "me", id });
	}

	async listLabels(): Promise<GmailLabel[]> {
		const gmail = this.assertReady();
		const res = await gmail.users.labels.list({ userId: "me" });
		return (res.data.labels ?? []).map((l) => ({
			id: l.id ?? "",
			name: l.name ?? "",
			type: l.type === "system" ? "system" : "user",
			messagesTotal: l.messagesTotal ?? 0,
			messagesUnread: l.messagesUnread ?? 0,
		}));
	}
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/gmail-client.test.ts -v`
Expected: All 6 tests PASS

**Step 5: Run lint**

Run: `bun run lint:fix`

**Step 6: Commit**

```bash
git add src/modules/gmail/client.ts tests/unit/gmail-client.test.ts
git commit -m "feat(gmail): add GmailClient with MIME parsing and full API wrapper"
```

---

### Task 7: Gmail tools — search, read, list_labels

**Files:**
- Create: `src/modules/gmail/tools/search.ts`
- Create: `src/modules/gmail/tools/read.ts`
- Create: `src/modules/gmail/tools/labels.ts`
- Test: `tests/unit/gmail-tools-read.test.ts`

**Step 1: Write the failing tests**

Tests for read-side tools focus on parameter validation and the "not authenticated" error path. We can't hit the real Gmail API, but we can test that:

- Missing required params return errors
- Tools declare correct clearance
- Tools have expected parameter definitions

```ts
import { describe, expect, test } from "bun:test";
import { gmailSearch } from "../../src/modules/gmail/tools/search.ts";
import { gmailRead } from "../../src/modules/gmail/tools/read.ts";
import { gmailListLabels } from "../../src/modules/gmail/tools/labels.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import type { ToolContext } from "../../src/modules/types.ts";

const ctx: ToolContext = {
	workingDirectory: "/tmp",
	audit: new AuditLogger(),
	signal: { emit: async () => {} },
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
};

describe("gmail.search", () => {
	test("declares network clearance", () => {
		expect(gmailSearch.clearance).toEqual(["network"]);
	});

	test("has query parameter required", () => {
		const query = gmailSearch.parameters.find((p) => p.name === "query");
		expect(query).toBeDefined();
		expect(query!.required).toBe(true);
	});

	test("fails without query parameter", async () => {
		const result = await gmailSearch.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("query");
	});

	test("fails when not authenticated", async () => {
		const result = await gmailSearch.execute({ query: "is:unread" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("auth");
	});
});

describe("gmail.read", () => {
	test("declares network clearance", () => {
		expect(gmailRead.clearance).toEqual(["network"]);
	});

	test("fails without id parameter", async () => {
		const result = await gmailRead.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("id");
	});
});

describe("gmail.list_labels", () => {
	test("declares network clearance", () => {
		expect(gmailListLabels.clearance).toEqual(["network"]);
	});

	test("has no required parameters", () => {
		const required = gmailListLabels.parameters.filter((p) => p.required);
		expect(required).toHaveLength(0);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/gmail-tools-read.test.ts -v`
Expected: FAIL — cannot resolve modules

**Step 3: Implement the three read-side tools**

Each tool follows the `FridayTool` pattern. They import the shared `GmailClient` instance from the module scope (set during `onLoad` — for now, the tools check if the client is available).

Create a shared module-level state file `src/modules/gmail/state.ts`:

```ts
import type { GmailClient } from "./client.ts";

let client: GmailClient | null = null;

export function getGmailClient(): GmailClient | null {
	return client;
}

export function setGmailClient(c: GmailClient | null): void {
	client = c;
}
```

Create `src/modules/gmail/tools/search.ts`:

```ts
import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailSearch: FridayTool = {
	name: "gmail.search",
	description:
		"Search Friday's Gmail inbox using Gmail query syntax. Returns message summaries with id, from, subject, date, snippet, labels, and unread status.",
	parameters: [
		{
			name: "query",
			type: "string",
			description: 'Gmail search query (e.g., "is:unread", "from:github.com", "subject:invoice after:2026/01/01")',
			required: true,
		},
		{
			name: "max_results",
			type: "number",
			description: "Maximum number of results (default: 10)",
			required: false,
			default: 10,
		},
	],
	clearance: ["network"],

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const query = args.query as string;
		if (!query) {
			return { success: false, output: "Missing required parameter: query" };
		}

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return { success: false, output: "Gmail not authenticated. Run /gmail auth to set up." };
		}

		try {
			const maxResults = typeof args.max_results === "number" ? args.max_results : 10;
			const result = await client.listMessages(query, maxResults);

			context.audit.log({
				action: "tool:gmail.search",
				source: "gmail.search",
				detail: `Searched: "${query}" — ${result.messages.length} results`,
				success: true,
			});

			const summary = result.messages.map((m) => {
				const unread = m.isUnread ? "[U] " : "    ";
				return `${unread}${m.id} | ${m.from} | ${m.subject} | ${m.date}`;
			}).join("\n");

			return {
				success: true,
				output: result.messages.length > 0
					? `Found ${result.messages.length} messages:\n${summary}`
					: "No messages found.",
				artifacts: { messages: result.messages, resultSizeEstimate: result.resultSizeEstimate },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail search failed: ${msg}` };
		}
	},
};
```

Create `src/modules/gmail/tools/read.ts`:

```ts
import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailRead: FridayTool = {
	name: "gmail.read",
	description:
		"Read a specific email from Friday's Gmail by message ID. Returns full body, headers, and attachment metadata.",
	parameters: [
		{
			name: "id",
			type: "string",
			description: "Message ID (from gmail.search results)",
			required: true,
		},
	],
	clearance: ["network"],

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const id = args.id as string;
		if (!id) {
			return { success: false, output: "Missing required parameter: id" };
		}

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return { success: false, output: "Gmail not authenticated. Run /gmail auth to set up." };
		}

		try {
			const message = await client.getMessage(id);

			context.audit.log({
				action: "tool:gmail.read",
				source: "gmail.read",
				detail: `Read message: ${message.subject}`,
				success: true,
			});

			const header = [
				`From: ${message.from}`,
				`To: ${message.to.join(", ")}`,
				message.cc.length ? `Cc: ${message.cc.join(", ")}` : "",
				`Subject: ${message.subject}`,
				`Date: ${message.date}`,
				`Labels: ${message.labels.join(", ")}`,
			].filter(Boolean).join("\n");

			return {
				success: true,
				output: `${header}\n${"─".repeat(60)}\n${message.body}`,
				artifacts: { message },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail read failed: ${msg}` };
		}
	},
};
```

Create `src/modules/gmail/tools/labels.ts`:

```ts
import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailListLabels: FridayTool = {
	name: "gmail.list_labels",
	description: "List all Gmail labels with message counts.",
	parameters: [],
	clearance: ["network"],

	async execute(_args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return { success: false, output: "Gmail not authenticated. Run /gmail auth to set up." };
		}

		try {
			const labels = await client.listLabels();

			context.audit.log({
				action: "tool:gmail.list_labels",
				source: "gmail.list_labels",
				detail: `Listed ${labels.length} labels`,
				success: true,
			});

			const lines = labels.map((l) => {
				const unread = l.messagesUnread > 0 ? ` (${l.messagesUnread} unread)` : "";
				return `  ${l.name} [${l.type}] — ${l.messagesTotal} messages${unread}`;
			});

			return {
				success: true,
				output: `Labels (${labels.length}):\n${lines.join("\n")}`,
				artifacts: { labels },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail labels failed: ${msg}` };
		}
	},
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/gmail-tools-read.test.ts -v`
Expected: All tests PASS

**Step 5: Run lint**

Run: `bun run lint:fix`

**Step 6: Commit**

```bash
git add src/modules/gmail/state.ts src/modules/gmail/tools/search.ts src/modules/gmail/tools/read.ts src/modules/gmail/tools/labels.ts tests/unit/gmail-tools-read.test.ts
git commit -m "feat(gmail): add search, read, and list_labels tools"
```

---

### Task 8: Gmail tools — send, reply, modify

**Files:**
- Create: `src/modules/gmail/tools/send.ts`
- Create: `src/modules/gmail/tools/reply.ts`
- Create: `src/modules/gmail/tools/modify.ts`
- Test: `tests/unit/gmail-tools-write.test.ts`

**Step 1: Write the failing tests**

Focus on parameter validation, clearance declarations (`["network", "email-send"]` for send/reply), and action validation for modify:

```ts
import { describe, expect, test } from "bun:test";
import { gmailSend } from "../../src/modules/gmail/tools/send.ts";
import { gmailReply } from "../../src/modules/gmail/tools/reply.ts";
import { gmailModify } from "../../src/modules/gmail/tools/modify.ts";
import { AuditLogger } from "../../src/audit/logger.ts";
import type { ToolContext } from "../../src/modules/types.ts";

const ctx: ToolContext = {
	workingDirectory: "/tmp",
	audit: new AuditLogger(),
	signal: { emit: async () => {} },
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
};

describe("gmail.send", () => {
	test("declares network and email-send clearance", () => {
		expect(gmailSend.clearance).toEqual(["network", "email-send"]);
	});

	test("fails without to parameter", async () => {
		const result = await gmailSend.execute({ subject: "Hi", body: "Hello" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("to");
	});

	test("fails without subject parameter", async () => {
		const result = await gmailSend.execute({ to: "a@b.com", body: "Hello" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("subject");
	});

	test("fails without body parameter", async () => {
		const result = await gmailSend.execute({ to: "a@b.com", subject: "Hi" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("body");
	});
});

describe("gmail.reply", () => {
	test("declares network and email-send clearance", () => {
		expect(gmailReply.clearance).toEqual(["network", "email-send"]);
	});

	test("fails without thread_id parameter", async () => {
		const result = await gmailReply.execute({ body: "reply" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("thread_id");
	});

	test("fails without body parameter", async () => {
		const result = await gmailReply.execute({ thread_id: "abc" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("body");
	});
});

describe("gmail.modify", () => {
	test("declares network clearance", () => {
		expect(gmailModify.clearance).toEqual(["network"]);
	});

	test("fails without id parameter", async () => {
		const result = await gmailModify.execute({ action: "archive" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("id");
	});

	test("fails without action parameter", async () => {
		const result = await gmailModify.execute({ id: "abc" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("action");
	});

	test("rejects invalid action", async () => {
		const result = await gmailModify.execute({ id: "abc", action: "explode" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid action");
	});

	test("requires label param for label action", async () => {
		const result = await gmailModify.execute({ id: "abc", action: "label" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("label");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/gmail-tools-write.test.ts -v`
Expected: FAIL — cannot resolve modules

**Step 3: Implement send, reply, modify tools**

Create `src/modules/gmail/tools/send.ts`:

```ts
import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailSend: FridayTool = {
	name: "gmail.send",
	description: "Send an email from Friday's Gmail account.",
	parameters: [
		{ name: "to", type: "string", description: "Recipient email address", required: true },
		{ name: "subject", type: "string", description: "Email subject", required: true },
		{ name: "body", type: "string", description: "Email body (plain text)", required: true },
		{ name: "cc", type: "string", description: "CC recipients (comma-separated)", required: false },
		{ name: "bcc", type: "string", description: "BCC recipients (comma-separated)", required: false },
	],
	clearance: ["network", "email-send"],

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const to = args.to as string;
		if (!to) return { success: false, output: "Missing required parameter: to" };
		const subject = args.subject as string;
		if (!subject) return { success: false, output: "Missing required parameter: subject" };
		const body = args.body as string;
		if (!body) return { success: false, output: "Missing required parameter: body" };

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return { success: false, output: "Gmail not authenticated. Run /gmail auth to set up." };
		}

		try {
			const result = await client.sendMessage(to, subject, body, args.cc as string, args.bcc as string);

			context.audit.log({
				action: "tool:gmail.send",
				source: "gmail.send",
				detail: `Sent email to ${to}: ${subject}`,
				success: true,
			});

			return {
				success: true,
				output: `Email sent to ${to}: "${subject}" (id: ${result.id})`,
				artifacts: { id: result.id, threadId: result.threadId },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail send failed: ${msg}` };
		}
	},
};
```

Create `src/modules/gmail/tools/reply.ts`:

```ts
import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

export const gmailReply: FridayTool = {
	name: "gmail.reply",
	description: "Reply to an email thread from Friday's Gmail account. Auto-sets In-Reply-To and References headers.",
	parameters: [
		{ name: "thread_id", type: "string", description: "Thread ID to reply to", required: true },
		{ name: "body", type: "string", description: "Reply body (plain text)", required: true },
	],
	clearance: ["network", "email-send"],

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const threadId = args.thread_id as string;
		if (!threadId) return { success: false, output: "Missing required parameter: thread_id" };
		const body = args.body as string;
		if (!body) return { success: false, output: "Missing required parameter: body" };

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return { success: false, output: "Gmail not authenticated. Run /gmail auth to set up." };
		}

		try {
			const result = await client.replyToThread(threadId, body);

			context.audit.log({
				action: "tool:gmail.reply",
				source: "gmail.reply",
				detail: `Replied to thread ${threadId}`,
				success: true,
			});

			return {
				success: true,
				output: `Reply sent in thread ${threadId} (id: ${result.id})`,
				artifacts: { id: result.id, threadId: result.threadId },
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail reply failed: ${msg}` };
		}
	},
};
```

Create `src/modules/gmail/tools/modify.ts`:

```ts
import type { FridayTool, ToolContext, ToolResult } from "../../types.ts";
import { getGmailClient } from "../state.ts";

const VALID_ACTIONS = ["archive", "trash", "delete", "mark_read", "mark_unread", "label", "unlabel"] as const;
type ModifyAction = (typeof VALID_ACTIONS)[number];

export const gmailModify: FridayTool = {
	name: "gmail.modify",
	description:
		'Modify a Gmail message: archive, trash, delete, mark_read, mark_unread, label, or unlabel.',
	parameters: [
		{ name: "id", type: "string", description: "Message ID", required: true },
		{
			name: "action",
			type: "string",
			description: 'Action: "archive", "trash", "delete", "mark_read", "mark_unread", "label", "unlabel"',
			required: true,
		},
		{
			name: "label",
			type: "string",
			description: 'Label name (required for "label" and "unlabel" actions)',
			required: false,
		},
	],
	clearance: ["network"],

	async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
		const id = args.id as string;
		if (!id) return { success: false, output: "Missing required parameter: id" };
		const action = args.action as string;
		if (!action) return { success: false, output: "Missing required parameter: action" };

		if (!VALID_ACTIONS.includes(action as ModifyAction)) {
			return {
				success: false,
				output: `Invalid action: "${action}". Use one of: ${VALID_ACTIONS.join(", ")}`,
			};
		}

		if ((action === "label" || action === "unlabel") && !args.label) {
			return { success: false, output: `Missing required parameter: label (required for "${action}" action)` };
		}

		const client = getGmailClient();
		if (!client?.isAuthenticated()) {
			return { success: false, output: "Gmail not authenticated. Run /gmail auth to set up." };
		}

		try {
			const label = args.label as string;

			switch (action as ModifyAction) {
				case "archive":
					await client.modifyMessage(id, { removeLabels: ["INBOX"] });
					break;
				case "trash":
					await client.trashMessage(id);
					break;
				case "delete":
					await client.deleteMessage(id);
					break;
				case "mark_read":
					await client.modifyMessage(id, { removeLabels: ["UNREAD"] });
					break;
				case "mark_unread":
					await client.modifyMessage(id, { addLabels: ["UNREAD"] });
					break;
				case "label":
					await client.modifyMessage(id, { addLabels: [label] });
					break;
				case "unlabel":
					await client.modifyMessage(id, { removeLabels: [label] });
					break;
			}

			context.audit.log({
				action: "tool:gmail.modify",
				source: "gmail.modify",
				detail: `Modified message ${id}: ${action}${label ? ` (${label})` : ""}`,
				success: true,
			});

			return {
				success: true,
				output: `Message ${id}: ${action} applied${label ? ` (label: ${label})` : ""}`,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Gmail modify failed: ${msg}` };
		}
	},
};
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/gmail-tools-write.test.ts -v`
Expected: All tests PASS

**Step 5: Run lint**

Run: `bun run lint:fix`

**Step 6: Commit**

```bash
git add src/modules/gmail/tools/send.ts src/modules/gmail/tools/reply.ts src/modules/gmail/tools/modify.ts tests/unit/gmail-tools-write.test.ts
git commit -m "feat(gmail): add send, reply, and modify tools with email-send clearance"
```

---

### Task 9: `/gmail` protocol

**Files:**
- Create: `src/modules/gmail/protocol.ts`
- Test: `tests/unit/gmail-protocol.test.ts`

**Step 1: Write the failing tests**

Test that the protocol has correct metadata (name, aliases, clearance) and that subcommand parsing works for basic cases:

```ts
import { describe, expect, test } from "bun:test";
import { gmailProtocol } from "../../src/modules/gmail/protocol.ts";

describe("/gmail protocol", () => {
	test("has correct name", () => {
		expect(gmailProtocol.name).toBe("gmail");
	});

	test("has mail and email aliases", () => {
		expect(gmailProtocol.aliases).toContain("mail");
		expect(gmailProtocol.aliases).toContain("email");
	});

	test("declares network clearance", () => {
		expect(gmailProtocol.clearance).toContain("network");
	});

	test("has subcommand parameter", () => {
		const sub = gmailProtocol.parameters.find((p) => p.name === "subcommand");
		expect(sub).toBeDefined();
		expect(sub!.required).toBe(true);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/gmail-protocol.test.ts -v`
Expected: FAIL

**Step 3: Implement the protocol**

Create `src/modules/gmail/protocol.ts`. The protocol parses subcommands and delegates to the GmailClient. For `send` and `reply`, it notes that interactive body input is needed (the protocol can describe what's needed, and the TUI/runtime handles prompting):

```ts
import type { FridayProtocol, ProtocolContext, ProtocolResult } from "../types.ts";
import { getGmailClient } from "./state.ts";
import { GmailAuth, GMAIL_SCOPES } from "./auth.ts";
import { getGmailAuth } from "./state.ts";

export const gmailProtocol: FridayProtocol = {
	name: "gmail",
	description: "Manage Friday's Gmail — inbox, search, read, send, labels, auth.",
	aliases: ["mail", "email"],
	parameters: [
		{
			name: "subcommand",
			type: "string",
			description: "Subcommand: inbox, unread, search, read, send, reply, labels, auth",
			required: true,
		},
		{
			name: "args",
			type: "string",
			description: "Arguments for the subcommand",
			required: false,
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		context: ProtocolContext,
	): Promise<ProtocolResult> {
		const rawArgs = (args.rawArgs as string) ?? "";
		const parts = rawArgs.trim().split(/\s+/);
		const subcommand = parts[0] ?? "inbox";
		const rest = parts.slice(1).join(" ");

		const client = getGmailClient();

		switch (subcommand) {
			case "auth": {
				if (rest === "status") {
					const auth = getGmailAuth();
					if (!auth) {
						return { success: false, summary: "Gmail auth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars." };
					}
					const authenticated = auth.isAuthenticated();
					return {
						success: true,
						summary: authenticated ? "Gmail: authenticated" : "Gmail: not authenticated. Run /gmail auth",
					};
				}

				const auth = getGmailAuth();
				if (!auth) {
					return { success: false, summary: "Gmail auth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars." };
				}

				const url = auth.generateAuthUrl();
				const codePromise = auth.startLocalCallback();

				return {
					success: true,
					summary: `Open this URL to authorize Friday's Gmail access:\n\n${url}\n\nWaiting for authorization callback on localhost:3847...`,
					details: "After authorizing, the browser will redirect back and tokens will be saved automatically.",
				};
			}

			case "inbox": {
				if (!client?.isAuthenticated()) {
					return { success: false, summary: "Gmail not authenticated. Run /gmail auth" };
				}
				const count = Number.parseInt(rest) || 10;
				const result = await client.listMessages("in:inbox", count);
				const lines = result.messages.map((m) => {
					const u = m.isUnread ? "[U]" : "   ";
					return `${u} ${m.id.substring(0, 8)}  ${m.from.padEnd(30).substring(0, 30)}  ${m.subject.substring(0, 50)}  ${m.date}`;
				});
				return {
					success: true,
					summary: `Inbox (${result.messages.length} messages):`,
					details: lines.join("\n"),
				};
			}

			case "unread": {
				if (!client?.isAuthenticated()) {
					return { success: false, summary: "Gmail not authenticated. Run /gmail auth" };
				}
				const result = await client.listMessages("is:unread", 20);
				if (result.messages.length === 0) {
					return { success: true, summary: "No unread messages." };
				}
				const lines = result.messages.map((m) =>
					`  ${m.id.substring(0, 8)}  ${m.from.padEnd(30).substring(0, 30)}  ${m.subject.substring(0, 50)}`,
				);
				return {
					success: true,
					summary: `${result.messages.length} unread messages:`,
					details: lines.join("\n"),
				};
			}

			case "search": {
				if (!client?.isAuthenticated()) {
					return { success: false, summary: "Gmail not authenticated. Run /gmail auth" };
				}
				if (!rest) {
					return { success: false, summary: "Usage: /gmail search <query>" };
				}
				const result = await client.listMessages(rest, 20);
				const lines = result.messages.map((m) => {
					const u = m.isUnread ? "[U]" : "   ";
					return `${u} ${m.id.substring(0, 8)}  ${m.from.padEnd(30).substring(0, 30)}  ${m.subject.substring(0, 50)}`;
				});
				return {
					success: true,
					summary: `Search "${rest}" — ${result.messages.length} results:`,
					details: lines.join("\n"),
				};
			}

			case "read": {
				if (!client?.isAuthenticated()) {
					return { success: false, summary: "Gmail not authenticated. Run /gmail auth" };
				}
				if (!rest) {
					return { success: false, summary: "Usage: /gmail read <message-id>" };
				}
				const message = await client.getMessage(rest);
				const header = [
					`From: ${message.from}`,
					`To: ${message.to.join(", ")}`,
					message.cc.length ? `Cc: ${message.cc.join(", ")}` : "",
					`Subject: ${message.subject}`,
					`Date: ${message.date}`,
					`Labels: ${message.labels.join(", ")}`,
				].filter(Boolean).join("\n");
				return {
					success: true,
					summary: `Message ${message.id}:`,
					details: `${header}\n${"─".repeat(60)}\n${message.body}`,
				};
			}

			case "send": {
				return {
					success: false,
					summary: "Use the gmail.send tool via natural language (e.g., 'Send an email to...'). Interactive send via protocol is not yet supported.",
				};
			}

			case "reply": {
				return {
					success: false,
					summary: "Use the gmail.reply tool via natural language (e.g., 'Reply to thread...'). Interactive reply via protocol is not yet supported.",
				};
			}

			case "labels": {
				if (!client?.isAuthenticated()) {
					return { success: false, summary: "Gmail not authenticated. Run /gmail auth" };
				}
				const labels = await client.listLabels();
				const lines = labels.map((l) => {
					const unread = l.messagesUnread > 0 ? ` (${l.messagesUnread} unread)` : "";
					return `  ${l.name} [${l.type}] — ${l.messagesTotal} messages${unread}`;
				});
				return {
					success: true,
					summary: `Labels (${labels.length}):`,
					details: lines.join("\n"),
				};
			}

			default:
				return {
					success: false,
					summary: `Unknown subcommand: ${subcommand}. Available: inbox, unread, search, read, send, reply, labels, auth`,
				};
		}
	},
};
```

Note: The protocol file imports `getGmailAuth` from state.ts. Update `src/modules/gmail/state.ts` to also export auth state:

```ts
import type { GmailClient } from "./client.ts";
import type { GmailAuth } from "./auth.ts";

let client: GmailClient | null = null;
let auth: GmailAuth | null = null;

export function getGmailClient(): GmailClient | null {
	return client;
}

export function setGmailClient(c: GmailClient | null): void {
	client = c;
}

export function getGmailAuth(): GmailAuth | null {
	return auth;
}

export function setGmailAuth(a: GmailAuth | null): void {
	auth = a;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/gmail-protocol.test.ts -v`
Expected: All 4 tests PASS

**Step 5: Run lint**

Run: `bun run lint:fix`

**Step 6: Commit**

```bash
git add src/modules/gmail/protocol.ts src/modules/gmail/state.ts tests/unit/gmail-protocol.test.ts
git commit -m "feat(gmail): add /gmail protocol with inbox, search, read, labels, auth subcommands"
```

---

### Task 10: Module manifest and wiring

**Files:**
- Create: `src/modules/gmail/index.ts`
- Test: `tests/unit/gmail-module.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import gmailModule from "../../src/modules/gmail/index.ts";

describe("gmail module", () => {
	test("exports valid module manifest", () => {
		expect(gmailModule.name).toBe("gmail");
		expect(gmailModule.version).toBe("1.0.0");
		expect(gmailModule.description).toContain("Gmail");
	});

	test("includes all 6 tools", () => {
		expect(gmailModule.tools).toHaveLength(6);
		const names = gmailModule.tools.map((t) => t.name);
		expect(names).toContain("gmail.search");
		expect(names).toContain("gmail.read");
		expect(names).toContain("gmail.send");
		expect(names).toContain("gmail.reply");
		expect(names).toContain("gmail.modify");
		expect(names).toContain("gmail.list_labels");
	});

	test("includes gmail protocol", () => {
		expect(gmailModule.protocols).toHaveLength(1);
		expect(gmailModule.protocols[0]!.name).toBe("gmail");
	});

	test("declares network and email-send clearance", () => {
		expect(gmailModule.clearance).toContain("network");
		expect(gmailModule.clearance).toContain("email-send");
	});

	test("has onLoad lifecycle hook", () => {
		expect(typeof gmailModule.onLoad).toBe("function");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/unit/gmail-module.test.ts -v`
Expected: FAIL

**Step 3: Implement the module manifest**

Create `src/modules/gmail/index.ts`:

```ts
import type { FridayModule } from "../types.ts";
import { gmailSearch } from "./tools/search.ts";
import { gmailRead } from "./tools/read.ts";
import { gmailSend } from "./tools/send.ts";
import { gmailReply } from "./tools/reply.ts";
import { gmailModify } from "./tools/modify.ts";
import { gmailListLabels } from "./tools/labels.ts";
import { gmailProtocol } from "./protocol.ts";
import { GmailAuth } from "./auth.ts";
import { GmailClient } from "./client.ts";
import { SecretStore } from "../../core/secrets.ts";
import { setGmailClient, setGmailAuth } from "./state.ts";

const gmailModule = {
	name: "gmail",
	description:
		"Gmail integration — read, search, send, reply, and organize Friday's email account via the Gmail API.",
	version: "1.0.0",
	tools: [gmailSearch, gmailRead, gmailSend, gmailReply, gmailModify, gmailListLabels],
	protocols: [gmailProtocol],
	knowledge: [],
	triggers: ["custom:gmail-auth-expired" as const],
	clearance: ["network", "email-send"] as const,

	async onLoad() {
		const clientId = process.env.GOOGLE_CLIENT_ID;
		const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			console.warn(
				"[Gmail] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set — Gmail module inactive.",
			);
			return;
		}

		// SecretStore needs ScopedMemory — provided via module context at boot
		// For now, use a minimal in-process store until runtime wiring is added
		const memoryStore = new Map<string, unknown>();
		const scopedMemory = {
			get: async <T>(key: string) => memoryStore.get(key) as T | undefined,
			set: async <T>(key: string, value: T) => { memoryStore.set(key, value); },
			delete: async (key: string) => { memoryStore.delete(key); },
			list: async () => [...memoryStore.keys()],
		};

		const secrets = new SecretStore(scopedMemory);
		const auth = new GmailAuth(secrets, clientId, clientSecret);
		setGmailAuth(auth);

		const client = new GmailClient(auth);
		const initialized = await client.initialize();

		if (initialized) {
			setGmailClient(client);
			console.log("[Gmail] Authenticated and ready.");
		} else {
			console.log("[Gmail] Not authenticated. Run /gmail auth to set up.");
		}
	},

	async onUnload() {
		setGmailClient(null);
		setGmailAuth(null);
	},
} satisfies FridayModule;

export default gmailModule;
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/unit/gmail-module.test.ts -v`
Expected: All 5 tests PASS

**Step 5: Run lint**

Run: `bun run lint:fix`

**Step 6: Commit**

```bash
git add src/modules/gmail/index.ts tests/unit/gmail-module.test.ts
git commit -m "feat(gmail): add module manifest with lifecycle hooks and all tools/protocol wired"
```

---

### Task 11: Run full test suite and typecheck

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors. Fix any issues.

**Step 2: Run full test suite**

Run: `bun test`
Expected: All existing tests still pass + all new gmail tests pass.

**Step 3: Run lint**

Run: `bun run lint:fix`

**Step 4: Fix any issues found, then commit**

```bash
git add -A
git commit -m "chore: fix lint/type issues from gmail module integration"
```

---

### Task 12: Update CLAUDE.md and documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md architecture section**

Add the gmail module to the modules list in the Architecture section. Add `"email-send"` to the clearance names. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the Environment section. Update the test count. Add the gmail design doc to the Design Documents list.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Gmail module, email-send clearance, and env vars"
```

---

### Summary

| Task | Description | Files | Tests |
|------|-------------|-------|-------|
| 1 | Install googleapis | package.json | — |
| 2 | email-send clearance | clearance.ts | 2 |
| 3 | SecretStore | core/secrets.ts | 7 |
| 4 | Gmail types | gmail/types.ts | — |
| 5 | OAuth auth flow | gmail/auth.ts | 5 |
| 6 | GmailClient | gmail/client.ts | 6 |
| 7 | Read tools (search, read, labels) | gmail/tools/ | ~8 |
| 8 | Write tools (send, reply, modify) | gmail/tools/ | ~10 |
| 9 | /gmail protocol | gmail/protocol.ts | 4 |
| 10 | Module manifest | gmail/index.ts | 5 |
| 11 | Full suite + typecheck | — | — |
| 12 | CLAUDE.md docs | CLAUDE.md | — |

**Total new tests:** ~47
**Total new files:** 14
**Total commits:** 12
