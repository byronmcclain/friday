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
import { createSmartProtocol } from "../smarts/protocol.ts";
import { SmartsCurator } from "../smarts/curator.ts";
import { createHistoryProtocol } from "../history/protocol.ts";
import { Sensorium } from "../sensorium/sensorium.ts";
import { createEnvProtocol } from "../sensorium/protocol.ts";
import { createEnvironmentTool } from "../sensorium/tool.ts";
import { SENSORIUM_DEFAULTS } from "../sensorium/types.ts";
import { mkdirSync } from "node:fs";

export interface RuntimeConfig extends Partial<FridayConfig> {
	modulesDir?: string;
	injectedProvider?: LLMProvider;
	smartsDir?: string;
	dataDir?: string;
	fresh?: boolean;
	enableSensorium?: boolean;
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
	private _curator?: SmartsCurator;
	private _sensorium?: Sensorium;
	private _memory?: SQLiteMemory;
	private _sessionId?: string;
	private _sessionStartedAt?: Date;
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

	get sensorium(): Sensorium | undefined {
		return this._sensorium;
	}

	get memory(): SQLiteMemory | undefined {
		return this._memory;
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
				"system",
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

			if (config.dataDir) {
				mkdirSync(config.dataDir, { recursive: true });
				const dbPath = `${config.dataDir}/friday.db`;
				this._memory = new SQLiteMemory(dbPath);
				this._sessionId = crypto.randomUUID();
				this._sessionStartedAt = new Date();
				this._protocols.register(createHistoryProtocol(this._memory));
			}

			if (config.smartsDir) {
				const dbPath = `${config.smartsDir}/.smarts-index.db`;
				this._smartsMemory = new SQLiteMemory(dbPath);
				this._smarts = new SmartsStore();
				await this._smarts.initialize(
					{ ...SMARTS_DEFAULTS, smartsDir: config.smartsDir },
					this._smartsMemory,
				);
				this._protocols.register(createSmartProtocol(this._smarts));
			}

			// Sensorium — before Cortex so context block is available from first chat()
			if (config.enableSensorium !== false) {
				this._sensorium = new Sensorium({
					config: SENSORIUM_DEFAULTS,
					signals: this._signals,
					notifications: this._notifications,
				});
				await this._sensorium.poll();
				this._sensorium.start();
				this._protocols.register(createEnvProtocol(this._sensorium));
			}

			this._cortex = new Cortex({
				...config,
				injectedProvider: config.injectedProvider,
				smartsStore: this._smarts,
				sensorium: this._sensorium,
			});

			// Register sensorium tool on Cortex (needs Cortex to exist)
			if (this._sensorium) {
				this._cortex.registerTool(createEnvironmentTool(this._sensorium));
			}

			if (this._smarts) {
				this._curator = new SmartsCurator(this._smarts, this._cortex.llmProvider);
			}

			if (this._memory && !config.fresh) {
				const recent = await this._memory.getConversationHistory(1);
				if (recent.length > 0) {
					this._cortex.setHistory(recent[0]!.messages);
				}
			}

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
			if (this._sensorium) {
				this._sensorium.stop();
				this._sensorium = undefined;
			}
			if (this._smartsMemory) {
				this._smartsMemory.close();
				this._smartsMemory = undefined;
				this._smarts = undefined;
			}
			if (this._memory) {
				this._memory.close();
				this._memory = undefined;
			}
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

		// Stop sensorium polling before cleanup
		if (this._sensorium) {
			this._sensorium.stop();
			this._sensorium = undefined;
		}

		if (this._memory && this._sessionId && this._sessionStartedAt) {
			const history = this._cortex.getHistory();
			if (history.length > 0) {
				await this._memory.saveConversation({
					id: this._sessionId,
					startedAt: this._sessionStartedAt,
					endedAt: new Date(),
					provider: this._cortex.providerName,
					model: this._cortex.modelName,
					messages: history,
				});
			}
		}

		if (this._curator) {
			const history = this._cortex.getHistory();
			await this._curator.extractFromConversation(history);
		}

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
		if (this._memory) {
			this._memory.close();
			this._memory = undefined;
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
