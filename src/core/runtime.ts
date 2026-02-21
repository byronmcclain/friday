import type { FridayConfig } from "./types.ts";
import { Cortex } from "./cortex.ts";
import type { LLMProvider } from "../providers/index.ts";
import { SignalBus } from "./events.ts";
import { ClearanceManager } from "./clearance.ts";
import { AuditLogger } from "../audit/logger.ts";
import { ProtocolRegistry } from "../protocols/registry.ts";
import { DirectiveStore } from "../directives/store.ts";
import { DirectiveEngine } from "../directives/engine.ts";
import { NotificationManager, TerminalChannel } from "./notifications.ts";
import { discoverModules } from "../modules/loader.ts";
import type { FridayModule } from "../modules/types.ts";
import { SmartsStore } from "../smarts/store.ts";
import { SQLiteMemory } from "./memory.ts";
import { SMARTS_DEFAULTS } from "../smarts/types.ts";

export interface RuntimeConfig extends Partial<FridayConfig> {
	modulesDir?: string;
	injectedProvider?: LLMProvider;
	smartsDir?: string;
}

export interface ProcessResult {
	output: string;
	source: "protocol" | "cortex";
}

export class FridayRuntime {
	private _cortex!: Cortex;
	private _signals!: SignalBus;
	private _clearance!: ClearanceManager;
	private _audit!: AuditLogger;
	private _protocols!: ProtocolRegistry;
	private _directives!: DirectiveStore;
	private _directiveEngine!: DirectiveEngine;
	private _notifications!: NotificationManager;
	private _modules: FridayModule[] = [];
	private _smarts?: SmartsStore;
	private _smartsMemory?: SQLiteMemory;
	private _booted = false;

	get isBooted(): boolean {
		return this._booted;
	}

	get cortex(): Cortex {
		return this._cortex;
	}

	get protocols(): ProtocolRegistry {
		return this._protocols;
	}

	get signals(): SignalBus {
		return this._signals;
	}

	get audit(): AuditLogger {
		return this._audit;
	}

	get smarts(): SmartsStore | undefined {
		return this._smarts;
	}

	async boot(config: RuntimeConfig = {}): Promise<void> {
		if (this._booted) await this.shutdown();

		try {
			this._signals = new SignalBus();
			this._clearance = new ClearanceManager([
				"read-fs",
				"write-fs",
				"exec-shell",
				"network",
				"git-read",
				"git-write",
				"provider",
			]);
			this._audit = new AuditLogger();
			this._notifications = new NotificationManager([new TerminalChannel()]);
			this._protocols = new ProtocolRegistry();
			this._directives = new DirectiveStore();
			this._directiveEngine = new DirectiveEngine({
				store: this._directives,
				signals: this._signals,
				audit: this._audit,
				clearance: this._clearance,
			});
			this._directiveEngine.start();

			if (config.smartsDir) {
				const dbPath = `${config.smartsDir}/.smarts-index.db`;
				this._smartsMemory = new SQLiteMemory(dbPath);
				this._smarts = new SmartsStore();
				await this._smarts.initialize(
					{ ...SMARTS_DEFAULTS, smartsDir: config.smartsDir },
					this._smartsMemory,
				);
			}

			this._cortex = new Cortex({
				...config,
				injectedProvider: config.injectedProvider,
				smartsStore: this._smarts,
			});

			if (config.modulesDir) {
				this._modules = await discoverModules(config.modulesDir);
				for (const mod of this._modules) {
					for (const tool of mod.tools) {
						this._cortex.registerTool(tool);
					}
					for (const protocol of mod.protocols) {
						this._protocols.register(protocol);
					}
					if (mod.onLoad) {
						await mod.onLoad();
					}
				}
			}

			await this._signals.emit("session:start", "runtime");
			this._booted = true;

			this._audit.log({
				action: "runtime:boot",
				source: "runtime",
				detail: `Friday online. Provider: ${this._cortex.providerName}, Modules: ${this._modules.length}`,
				success: true,
			});
		} catch (err) {
			this._booted = false;
			this._modules = [];
			throw err;
		}
	}

	async process(input: string): Promise<ProcessResult> {
		if (!this._booted) throw new Error("Runtime not booted");

		if (this._protocols.isProtocol(input)) {
			const parsed = this._protocols.parseProtocolInput(input);
			if (!parsed) {
				return { output: "Failed to parse protocol input", source: "protocol" };
			}
			const protocol = this._protocols.get(parsed.name);
			if (!protocol) {
				return { output: `Unknown protocol: ${parsed.name}`, source: "protocol" };
			}
			const result = await protocol.execute(
				{ rawArgs: parsed.rawArgs },
				{
					workingDirectory: process.cwd(),
					audit: this._audit,
					signal: this._signals,
					memory: {
						get: async () => undefined,
						set: async () => {},
						delete: async () => {},
						list: async () => [],
					},
					tools: new Map(),
				},
			);
			return { output: result.summary, source: "protocol" };
		}

		const response = await this._cortex.chat(input);
		await this._signals.emit("command:post-execute", "cortex");
		return { output: response, source: "cortex" };
	}

	async shutdown(): Promise<void> {
		if (!this._booted) throw new Error("Runtime not booted");
		await this._signals.emit("session:end", "runtime");
		for (const mod of this._modules) {
			if (mod.onUnload) {
				await mod.onUnload();
			}
		}
		if (this._smartsMemory) {
			this._smartsMemory.close();
			this._smartsMemory = undefined;
			this._smarts = undefined;
		}
		this._audit.log({
			action: "runtime:shutdown",
			source: "runtime",
			detail: "Friday going offline",
			success: true,
		});
		this._booted = false;
	}
}
