import { describe, expect, test } from "bun:test";
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

describe("SecretStore", () => {
	test("encrypt then decrypt returns original value", async () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		await secrets.encrypt("token", "my-secret-value");
		const result = await secrets.decrypt("token");
		expect(result).toBe("my-secret-value");
	});

	test("decrypt returns null for missing key", async () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		const result = await secrets.decrypt("nonexistent");
		expect(result).toBeNull();
	});

	test("delete removes a secret", async () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		await secrets.encrypt("token", "value");
		await secrets.delete("token");
		const result = await secrets.decrypt("token");
		expect(result).toBeNull();
	});

	test("has() returns true for existing key", async () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		await secrets.encrypt("token", "value");
		expect(await secrets.has("token")).toBe(true);
	});

	test("has() returns false for missing key", async () => {
		const secrets = new SecretStore(createMemoryStub(), {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		expect(await secrets.has("nonexistent")).toBe(false);
	});

	test("encrypted value in memory is not plaintext", async () => {
		const mem = createMemoryStub();
		const secrets = new SecretStore(mem, {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		await secrets.encrypt("token", "my-secret-value");
		const raw = await mem.get<string>("token");
		expect(raw).not.toBe("my-secret-value");
		expect(typeof raw).toBe("string");
	});

	test("different IVs produce different ciphertexts", async () => {
		const mem = createMemoryStub();
		const secrets = new SecretStore(mem, {
			injectedKey: "a]secret-key-that-is-32-bytes!!",
		});
		await secrets.encrypt("a", "same-value");
		await secrets.encrypt("b", "same-value");
		const rawA = await mem.get<string>("a");
		const rawB = await mem.get<string>("b");
		expect(rawA).not.toBe(rawB);
	});
});
