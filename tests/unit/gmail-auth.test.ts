import { describe, expect, test } from "bun:test";
import { GmailAuth, GMAIL_SCOPES } from "../../src/modules/gmail/auth.ts";
import { SecretStore } from "../../src/core/secrets.ts";
import type { ScopedMemory } from "../../src/core/memory.ts";

function createMemoryStub(): ScopedMemory {
	const store = new Map<string, unknown>();
	return {
		get: async <T>(key: string) => store.get(key) as T | undefined,
		set: async <T>(key: string, value: T) => {
			store.set(key, value);
		},
		delete: async (key: string) => {
			store.delete(key);
		},
		list: async () => [...store.keys()],
	};
}

describe("GmailAuth", () => {
	test("generateAuthUrl includes all scopes", () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const url = auth.generateAuthUrl();
		for (const scope of GMAIL_SCOPES) {
			expect(url).toContain(encodeURIComponent(scope));
		}
	});

	test("generateAuthUrl includes access_type=offline", () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const url = auth.generateAuthUrl();
		expect(url).toContain("access_type=offline");
	});

	test("loadTokens returns false when no tokens stored", async () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const result = await auth.loadTokens();
		expect(result).toBe(false);
	});

	test("loadTokens returns true when tokens exist", async () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		await secrets.encrypt(
			"gmail:access_token",
			"fake-access-token",
		);
		await secrets.encrypt(
			"gmail:refresh_token",
			"fake-refresh-token",
		);
		await secrets.encrypt(
			"gmail:token_expiry",
			new Date(Date.now() + 3600000).toISOString(),
		);
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		const result = await auth.loadTokens();
		expect(result).toBe(true);
	});

	test("isAuthenticated is false before loadTokens", () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		const auth = new GmailAuth(secrets, "client-id", "client-secret");
		expect(auth.isAuthenticated()).toBe(false);
	});
});
