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

describe("SecretStore.decodeEnvKey", () => {
	test("decodes valid base64 string that produces exactly 32 bytes", () => {
		// Generate a 32-byte key and encode as base64
		const original = Buffer.alloc(32);
		for (let i = 0; i < 32; i++) original[i] = i + 65; // ASCII A-Z...
		const b64 = original.toString("base64");
		const decoded = SecretStore.decodeEnvKey(b64);
		expect(decoded.length).toBe(32);
		expect(decoded).toEqual(original);
	});

	test("treats plain string as UTF-8 padded to 32 bytes", () => {
		const plainKey = "my-simple-password";
		const decoded = SecretStore.decodeEnvKey(plainKey);
		expect(decoded.length).toBe(32);
		// First bytes should match the plain string
		const expected = Buffer.alloc(32);
		Buffer.from(plainKey, "utf-8").copy(expected);
		expect(decoded).toEqual(expected);
	});

	test("truncates long UTF-8 string to 32 bytes", () => {
		const longKey = "A".repeat(64);
		const decoded = SecretStore.decodeEnvKey(longKey);
		expect(decoded.length).toBe(32);
		expect(decoded.toString("utf-8")).toBe("A".repeat(32));
	});

	test("pads short UTF-8 string with zero bytes", () => {
		const shortKey = "abc";
		const decoded = SecretStore.decodeEnvKey(shortKey);
		expect(decoded.length).toBe(32);
		expect(decoded[0]).toBe(97); // 'a'
		expect(decoded[3]).toBe(0); // zero padding
	});

	test("base64 key that decodes to non-32-byte length is treated as plain string", () => {
		// "aGVsbG8=" decodes to "hello" (5 bytes, not 32)
		const decoded = SecretStore.decodeEnvKey("aGVsbG8=");
		expect(decoded.length).toBe(32);
		// Should be treated as UTF-8 of the literal string "aGVsbG8="
		const expected = Buffer.alloc(32);
		Buffer.from("aGVsbG8=", "utf-8").copy(expected);
		expect(decoded).toEqual(expected);
	});
});


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
