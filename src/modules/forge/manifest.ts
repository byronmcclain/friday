import type {
	ForgeManifest,
	ForgeModuleEntry,
	ForgeHistoryEntry,
} from "./types.ts";
import { resolve } from "node:path";

export class ForgeManifestManager {
	private manifestPath: string;
	private _lock: Promise<void> = Promise.resolve();

	constructor(forgeDir: string) {
		this.manifestPath = resolve(forgeDir, "manifest.json");
	}

	private async withLock<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this._lock;
		let resolve: () => void;
		this._lock = new Promise((r) => (resolve = r));
		await prev;
		try {
			return await fn();
		} finally {
			resolve!();
		}
	}

	private async _load(): Promise<ForgeManifest> {
		const file = Bun.file(this.manifestPath);
		if (!(await file.exists())) {
			return { version: 1, modules: {} };
		}
		return JSON.parse(await file.text()) as ForgeManifest;
	}

	private async _save(manifest: ForgeManifest): Promise<void> {
		await Bun.write(this.manifestPath, JSON.stringify(manifest, null, 2));
	}

	async load(): Promise<ForgeManifest> {
		return this.withLock(() => this._load());
	}

	async addModule(
		name: string,
		description: string,
		version: string,
		reason: string,
	): Promise<void> {
		return this.withLock(async () => {
			const manifest = await this._load();
			const now = new Date().toISOString();
			const entry: ForgeModuleEntry = {
				description,
				version,
				created: now,
				lastModified: now,
				status: "pending",
				protected: false,
				history: [{ version, date: now, action: "created", reason }],
			};
			manifest.modules[name] = entry;
			await this._save(manifest);
		});
	}

	async updateModule(
		name: string,
		version: string,
		action: ForgeHistoryEntry["action"],
		reason: string,
	): Promise<void> {
		return this.withLock(async () => {
			const manifest = await this._load();
			const entry = manifest.modules[name];
			if (!entry) throw new Error(`Module "${name}" not found in manifest`);
			const now = new Date().toISOString();
			entry.version = version;
			entry.lastModified = now;
			entry.history.push({ version, date: now, action, reason });
			await this._save(manifest);
		});
	}

	async getEntry(name: string): Promise<ForgeModuleEntry | undefined> {
		return this.withLock(async () => {
			const manifest = await this._load();
			return manifest.modules[name];
		});
	}

	async isProtected(name: string): Promise<boolean> {
		const entry = await this.getEntry(name);
		return entry?.protected ?? false;
	}

	async setProtected(name: string, value: boolean): Promise<void> {
		return this.withLock(async () => {
			const manifest = await this._load();
			const entry = manifest.modules[name];
			if (!entry) throw new Error(`Module "${name}" not found in manifest`);
			entry.protected = value;
			await this._save(manifest);
		});
	}

	async setStatus(
		name: string,
		status: ForgeModuleEntry["status"],
	): Promise<void> {
		return this.withLock(async () => {
			const manifest = await this._load();
			const entry = manifest.modules[name];
			if (!entry) throw new Error(`Module "${name}" not found in manifest`);
			entry.status = status;
			await this._save(manifest);
		});
	}

	async setStatusBatch(
		updates: Array<{ name: string; status: ForgeModuleEntry["status"] }>,
	): Promise<void> {
		return this.withLock(async () => {
			const manifest = await this._load();
			for (const { name, status } of updates) {
				const entry = manifest.modules[name];
				if (entry) entry.status = status;
			}
			await this._save(manifest);
		});
	}

	async listModules(): Promise<string[]> {
		return this.withLock(async () => {
			const manifest = await this._load();
			return Object.keys(manifest.modules);
		});
	}
}
