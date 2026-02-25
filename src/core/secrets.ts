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
			const raw = Buffer.from(this.injectedKey, "utf-8");
			// Pad or truncate to exactly 32 bytes for AES-256
			this.masterKey = Buffer.alloc(32);
			raw.copy(this.masterKey, 0, 0, Math.min(raw.length, 32));
			return this.masterKey;
		}

		// Env var — handle both base64 and plain string formats
		const envKey = process.env.FRIDAY_SECRET_KEY;
		if (envKey) {
			this.masterKey = SecretStore.decodeEnvKey(envKey);
			return this.masterKey;
		}

		// Try OS keychain (returns base64-encoded key)
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

	/** Decode FRIDAY_SECRET_KEY: if valid base64 producing exactly 32 bytes, use as-is; otherwise treat as UTF-8 padded/truncated to 32 bytes. */
	static decodeEnvKey(envKey: string): Buffer {
		try {
			const decoded = Buffer.from(envKey, "base64");
			// Verify it round-trips cleanly and is exactly 32 bytes
			if (decoded.length === 32 && decoded.toString("base64") === envKey) {
				return decoded;
			}
		} catch {
			// Not valid base64
		}
		// Treat as plain UTF-8 string — pad or truncate to 32 bytes
		const raw = Buffer.from(envKey, "utf-8");
		const key = Buffer.alloc(32);
		raw.copy(key, 0, 0, Math.min(raw.length, 32));
		return key;
	}

	private async readKeychain(): Promise<string | null> {
		const platform = process.platform;
		try {
			if (platform === "darwin") {
				const result =
					await Bun.$`security find-generic-password -s ${KEY_SERVICE} -a ${KEY_ACCOUNT} -w 2>/dev/null`.text();
				return result.trim() || null;
			}
			if (platform === "linux") {
				const result =
					await Bun.$`secret-tool lookup service ${KEY_SERVICE} key ${KEY_ACCOUNT} 2>/dev/null`.text();
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
		const cipher = createCipheriv(ALGORITHM, masterKey, iv, {
			authTagLength: AUTH_TAG_LENGTH,
		});
		const encrypted = Buffer.concat([
			cipher.update(value, "utf-8"),
			cipher.final(),
		]);
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

		const decipher = createDecipheriv(ALGORITHM, masterKey, iv, {
			authTagLength: AUTH_TAG_LENGTH,
		});
		decipher.setAuthTag(authTag);
		const decrypted = Buffer.concat([
			decipher.update(encrypted),
			decipher.final(),
		]);
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
