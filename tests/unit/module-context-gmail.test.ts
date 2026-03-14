import { describe, test, expect, afterEach } from "bun:test";
import { unlink } from "node:fs/promises";
import { SQLiteMemory } from "../../src/core/memory.ts";
import { SecretStore } from "../../src/core/secrets.ts";

const TEST_DB = "/tmp/friday-test-module-context-gmail.db";

describe("Gmail token persistence via ScopedMemory", () => {
	afterEach(async () => {
		await unlink(TEST_DB).catch(() => {});
		await unlink(`${TEST_DB}-wal`).catch(() => {});
		await unlink(`${TEST_DB}-shm`).catch(() => {});
	});

	test("encrypted tokens survive across SecretStore instances sharing same ScopedMemory", async () => {
		const memory = new SQLiteMemory(TEST_DB);
		const scoped = memory.scoped("gmail");

		// First boot: encrypt and store a token
		const secrets1 = new SecretStore(scoped, { injectedKey: "test-key-for-gmail-roundtrip!!" });
		await secrets1.encrypt("gmail:access_token", "ya29.test-access-token");
		await secrets1.encrypt("gmail:refresh_token", "1//test-refresh-token");

		// Second boot: new SecretStore, same ScopedMemory backing
		const secrets2 = new SecretStore(scoped, { injectedKey: "test-key-for-gmail-roundtrip!!" });
		const access = await secrets2.decrypt("gmail:access_token");
		const refresh = await secrets2.decrypt("gmail:refresh_token");

		expect(access).toBe("ya29.test-access-token");
		expect(refresh).toBe("1//test-refresh-token");

		memory.close();
	});

	test("null-object fallback does not crash onLoad", async () => {
		const noopMemory = {
			get: async () => undefined,
			set: async () => {},
			delete: async () => {},
			list: async () => [],
		};

		// SecretStore with no-op memory — encrypt/decrypt should not throw
		// Uses injectedKey to avoid OS keychain interaction in tests
		const secrets = new SecretStore(noopMemory, { injectedKey: "test-key-noop-fallback!!!!!!!!" });
		await secrets.encrypt("gmail:access_token", "ya29.test");
		const result = await secrets.decrypt("gmail:access_token");

		// No-op set means nothing persisted — decrypt returns null
		expect(result).toBeNull();
	});
});
