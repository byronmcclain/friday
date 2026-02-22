import type {
	ForgeManifest,
	ForgeModuleEntry,
	ForgeHistoryEntry,
} from "./types.ts";
import { resolve } from "node:path";

export class ForgeManifestManager {
	private manifestPath: string;

	constructor(forgeDir: string) {
		this.manifestPath = resolve(forgeDir, "manifest.json");
	}

	async load(): Promise<ForgeManifest> {
		const file = Bun.file(this.manifestPath);
		if (!(await file.exists())) {
			return { version: 1, modules: {} };
		}
		return JSON.parse(await file.text()) as ForgeManifest;
	}

	private async save(manifest: ForgeManifest): Promise<void> {
		await Bun.write(this.manifestPath, JSON.stringify(manifest, null, 2));
	}

	async addModule(
		name: string,
		description: string,
		version: string,
		reason: string,
	): Promise<void> {
		const manifest = await this.load();
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
		await this.save(manifest);
	}

	async updateModule(
		name: string,
		version: string,
		action: ForgeHistoryEntry["action"],
		reason: string,
	): Promise<void> {
		const manifest = await this.load();
		const entry = manifest.modules[name];
		if (!entry) throw new Error(`Module "${name}" not found in manifest`);
		const now = new Date().toISOString();
		entry.version = version;
		entry.lastModified = now;
		entry.history.push({ version, date: now, action, reason });
		await this.save(manifest);
	}

	async getEntry(name: string): Promise<ForgeModuleEntry | undefined> {
		const manifest = await this.load();
		return manifest.modules[name];
	}

	async isProtected(name: string): Promise<boolean> {
		const entry = await this.getEntry(name);
		return entry?.protected ?? false;
	}

	async setProtected(name: string, value: boolean): Promise<void> {
		const manifest = await this.load();
		const entry = manifest.modules[name];
		if (!entry) throw new Error(`Module "${name}" not found in manifest`);
		entry.protected = value;
		await this.save(manifest);
	}

	async setStatus(
		name: string,
		status: ForgeModuleEntry["status"],
	): Promise<void> {
		const manifest = await this.load();
		const entry = manifest.modules[name];
		if (!entry) throw new Error(`Module "${name}" not found in manifest`);
		entry.status = status;
		await this.save(manifest);
	}

	async listModules(): Promise<string[]> {
		const manifest = await this.load();
		return Object.keys(manifest.modules);
	}
}
