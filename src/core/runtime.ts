import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { FridayConfig } from "./types.ts";
import { Cortex } from "./cortex.ts";
import { createModel, GROK_DEFAULTS } from "../providers/index.ts";
import { SignalBus } from "./events.ts";
import { ClearanceManager } from "./clearance.ts";
import { AuditLogger } from "../audit/logger.ts";
import { ProtocolRegistry } from "../protocols/registry.ts";
import { DirectiveStore } from "../directives/store.ts";
import { DirectiveEngine } from "../directives/engine.ts";
import { NotificationManager, TerminalChannel, type NotificationChannel } from "./notifications.ts";
import { discoverModules, discoverForgeModules } from "../modules/loader.ts";
import type { FridayModule } from "../modules/types.ts";
import { SmartsStore } from "../smarts/store.ts";
import { SQLiteMemory } from "./memory.ts";
import { SMARTS_DEFAULTS } from "../smarts/types.ts";
import { createSmartProtocol } from "../smarts/protocol.ts";
import { SmartsCurator } from "../smarts/curator.ts";
import { ConversationSummarizer } from "./summarizer.ts";
import { createHistoryProtocol } from "../history/protocol.ts";
import { Sensorium } from "../sensorium/sensorium.ts";
import { createEnvProtocol } from "../sensorium/protocol.ts";
import { createEnvironmentTool } from "../sensorium/tool.ts";
import { SENSORIUM_DEFAULTS } from "../sensorium/types.ts";
import { createForgeProtocol } from "../modules/forge/protocol.ts";
import type { ForgeHealthReport } from "../modules/forge/types.ts";
import { createRecallTool } from "./recall-tool.ts";
import { RhythmStore } from "../arc-rhythm/store.ts";
import { RhythmExecutor } from "../arc-rhythm/executor.ts";
import { RhythmScheduler } from "../arc-rhythm/scheduler.ts";
import { createArcProtocol } from "../arc-rhythm/protocol.ts";
import { createManageRhythmTool } from "../arc-rhythm/tool.ts";
import { mkdir } from "node:fs/promises";
import { loadGenesis, enforceGenesisPermissions } from "./genesis.ts";
import { setProtectedPaths } from "../modules/filesystem/containment.ts";
import { Vox } from "./voice/vox.ts";
import { VOX_DEFAULTS } from "./voice/types.ts";
import { VoiceChannel } from "./voice/channel.ts";
import { createVoiceProtocol } from "./voice/protocol.ts";
import type { GrokVoice } from "./voice/types.ts";

export interface RuntimeConfig extends Partial<FridayConfig> {
	modulesDir?: string;
	injectedModel?: LanguageModelV3;
	injectedFastModel?: LanguageModelV3;
	smartsDir?: string;
	dataDir?: string;
	forgeDir?: string;
	fresh?: boolean;
	enableSensorium?: boolean;
	enableVox?: boolean;
	genesisPath?: string;
	channels?: NotificationChannel[];
	debug?: boolean;
}

export interface ProcessResult {
	output: string;
	source: "protocol" | "cortex";
}

export type ShutdownStep = "arc-rhythm" | "vox" | "sensorium" | "conversation" | "knowledge" | "modules" | "cleanup";

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
	private _summarizer?: ConversationSummarizer;
	private _sensorium?: Sensorium;
	private _memory?: SQLiteMemory;
	private _rhythmStore?: RhythmStore;
	private _rhythmScheduler?: RhythmScheduler;
	private _vox?: Vox;
	private _fastModel!: string;
	private _sessionId?: string;
	private _sessionStartedAt?: Date;
	private _booted = false;
	private _booting = false;
	private _restartRequested = false;
	private _forgeHealthReport?: ForgeHealthReport;

	get isBooted(): boolean {
		return this._booted;
	}

	get restartRequested(): boolean {
		return this._restartRequested;
	}

	set restartRequested(value: boolean) {
		this._restartRequested = value;
	}

	get forgeHealthReport(): ForgeHealthReport | undefined {
		return this._forgeHealthReport;
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

	get clearance(): ClearanceManager {
		return this._clearance;
	}

	get directives(): DirectiveStore {
		return this._directives;
	}

	get smarts(): SmartsStore | undefined {
		return this._smarts;
	}

	get sensorium(): Sensorium | undefined {
		return this._sensorium;
	}

	get vox(): Vox | undefined {
		return this._vox;
	}

	get notifications(): NotificationManager | undefined {
		return this._booted ? this._notifications : undefined;
	}

	get memory(): SQLiteMemory | undefined {
		return this._memory;
	}

	get fastModel(): string {
		return this._fastModel;
	}

	get summarizer(): ConversationSummarizer | undefined {
		return this._summarizer;
	}

	get curator(): SmartsCurator | undefined {
		return this._curator;
	}

	async boot(config: RuntimeConfig = {}): Promise<void> {
		if (this._booting) throw new Error("Boot already in progress");
		this._booting = true;
		try {
		if (this._booted) await this.shutdown();

		try {
			this._signals = new SignalBus();
			this._clearance = new ClearanceManager([
				"read-fs",
				"write-fs",
				"delete-fs",
				"exec-shell",
				"network",
				"git-read",
				"git-write",
				"provider",
				"system",
				"forge-modify",
				"email-send",
				"audio-output",
			]);
			this._audit = new AuditLogger();
			this._notifications = new NotificationManager(config.channels ?? [new TerminalChannel()]);
			this._protocols = new ProtocolRegistry();
			this._directives = new DirectiveStore();
			this._directiveEngine = new DirectiveEngine({
				store: this._directives,
				signals: this._signals,
				audit: this._audit,
				clearance: this._clearance,
			});
			this._directiveEngine.start();

			// Wire directive action dispatch — routes actions to the appropriate subsystem.
			// This must be set after Cortex/protocols are available, but the handler
			// captures `this` so late-binding is fine. The engine buffers until a handler
			// is registered, and directives won't fire until signals are emitted (post-boot).
			this._directiveEngine.onDirectiveAction(async (_directive, action) => {
				switch (action.type) {
					case "protocol": {
						const protocol = this._protocols.get(action.protocol);
						if (!protocol) break;
						if (protocol.clearance.length > 0) {
							const pCheck = this._clearance.checkAll(protocol.clearance);
							if (!pCheck.granted) {
								this._audit.log({
									action: "protocol:blocked",
									source: protocol.name,
									detail: pCheck.reason ?? `Clearance denied for protocol: ${protocol.name}`,
									success: false,
								});
								break;
							}
						}
						await protocol.execute(
							action.args ?? { rawArgs: "" },
							{
								workingDirectory: process.cwd(),
								audit: this._audit,
								signal: this._signals,
								memory: this._memory?.scoped("directive") ?? {
									get: async () => undefined,
									set: async () => {},
									delete: async () => {},
									list: async () => [],
								},
								tools: new Map(),
							},
						);
						break;
					}
					case "prompt": {
						await this._cortex.chat(action.prompt);
						break;
					}
					case "tool": {
						const tool = this._cortex.availableTools.find(
							(t) => t.name === action.tool,
						);
						if (!tool) break;
						if (tool.clearance.length > 0) {
							const tCheck = this._clearance.checkAll(tool.clearance);
							if (!tCheck.granted) {
								this._audit.log({
									action: "tool:blocked",
									source: tool.name,
									detail: tCheck.reason ?? `Clearance denied for tool: ${tool.name}`,
									success: false,
								});
								break;
							}
						}
						await tool.execute(action.args ?? {}, {
							workingDirectory: process.cwd(),
							audit: this._audit,
							signal: this._signals,
							memory: this._memory?.scoped("directive") ?? {
								get: async () => undefined,
								set: async () => {},
								delete: async () => {},
								list: async () => [],
							},
						});
						break;
					}
					case "sequence": {
						// Sequence actions are not yet dispatched — each step
						// would need recursive handling. Leave as a no-op for now.
						break;
					}
				}
			});

			if (config.dataDir) {
				await mkdir(config.dataDir, { recursive: true });
				const dbPath = `${config.dataDir}/friday.db`;
				this._memory = new SQLiteMemory(dbPath);
				this._sessionId = crypto.randomUUID();
				this._sessionStartedAt = new Date();
				this._protocols.register(createHistoryProtocol(this._memory));
			}

			// Backfill conversation FTS5 index (one-time migration)
			if (this._memory) {
				const backfillDone = await this._memory.get<boolean>("conversations", "backfill-done");
				if (!backfillDone) {
					const sessions = await this._memory.getConversationHistory(500);
					for (const session of sessions) {
						if (session.summary) {
							await this._memory.indexConversation(session);
						}
					}
					await this._memory.set("conversations", "backfill-done", true);
				}
			}

			if (config.smartsDir) {
				await mkdir(config.smartsDir, { recursive: true });
				const dbPath = `${config.smartsDir}/.smarts-index.db`;
				this._smartsMemory = new SQLiteMemory(dbPath);
				this._smarts = new SmartsStore();
				await this._smarts.initialize(
					{ ...SMARTS_DEFAULTS, smartsDir: config.smartsDir },
					this._smartsMemory,
				);
				this._protocols.register(createSmartProtocol(this._smarts));
			}

			// Resolve dual models: CLI flag > env var > default
			const reasoningModel = config.model ?? process.env.FRIDAY_REASONING_MODEL ?? GROK_DEFAULTS.model;
			this._fastModel = config.fastModel ?? process.env.FRIDAY_FAST_MODEL ?? GROK_DEFAULTS.fastModel;

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

			// Load GENESIS.md — Friday's identity prompt (before Cortex)
			let genesisPrompt: string | undefined;
			if (config.genesisPath) {
				genesisPrompt = await loadGenesis(config.genesisPath);
				await enforceGenesisPermissions(config.genesisPath);
				setProtectedPaths([config.genesisPath]);
				this._audit.log({
					action: "genesis:loaded",
					source: "runtime",
					detail: `Identity loaded from ${config.genesisPath} (${genesisPrompt.length} chars)`,
					success: true,
				});
			}

			// Vox — voice output (before Cortex so vox ref can be passed in)
			if (config.enableVox !== false) {
				const voice = (process.env.FRIDAY_VOICE as GrokVoice) ?? VOX_DEFAULTS.defaultVoice;
				this._vox = new Vox({
					config: { ...VOX_DEFAULTS, defaultVoice: voice },
					signals: this._signals,
					notifications: this._notifications,
					clearance: this._clearance,
					audit: this._audit,
				});
				this._notifications.addChannel(new VoiceChannel(this._vox));
				this._protocols.register(createVoiceProtocol(this._vox));
			}

			this._cortex = new Cortex({
				model: reasoningModel,
				maxTokens: config.maxTokens,
				injectedModel: config.injectedModel,

				smartsStore: this._smarts,
				sensorium: this._sensorium,
				clearance: this._clearance,
				audit: this._audit,
				signals: this._signals,
				toolMemory: this._memory?.scoped("tools"),
				genesisPrompt,
				vox: this._vox,
				debug: config.debug,
				projectRoot: process.cwd(),
			});

			// Register sensorium tool on Cortex (needs Cortex to exist)
			if (this._sensorium) {
				this._cortex.registerTool(createEnvironmentTool(this._sensorium));
			}

			// Register recall tool for conversation memory search
			if (this._memory) {
				this._cortex.registerTool(createRecallTool(this._memory));
			}

			// Arc Rhythm — after Cortex and recall tool, before modules
			if (this._memory) {
				this._rhythmStore = new RhythmStore(this._memory.database);
				const rhythmExecutor = new RhythmExecutor({
					cortex: this._cortex,
					protocols: this._protocols,
					clearance: this._clearance,
					audit: this._audit,
					signals: this._signals,
					memory: this._memory?.scoped("arc-rhythm"),
				});
				this._rhythmScheduler = new RhythmScheduler({
					store: this._rhythmStore,
					executor: rhythmExecutor,
					signals: this._signals,
					notifications: this._notifications,
					audit: this._audit,
				});
				this._protocols.register(createArcProtocol(this._rhythmStore, this._rhythmScheduler));
				this._cortex.registerTool(createManageRhythmTool(this._rhythmStore));
				this._rhythmScheduler.start();
			}

			// Subsystem model for curator/summarizer.
			const subsystemModel: LanguageModelV3 =
				config.injectedFastModel ?? config.injectedModel ?? createModel(this._fastModel);

			if (this._smarts) {
				this._curator = new SmartsCurator(this._smarts, subsystemModel);
			}
			this._summarizer = new ConversationSummarizer(subsystemModel);

			// Wire emotion engine into Vox for dynamic voice
			if (this._vox && this._cortex) {
				this._vox.setEmotionEngine(
					subsystemModel,
					() => this._cortex!.getRecentHistory(5),
				);
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

			if (config.forgeDir) {
				await mkdir(config.forgeDir, { recursive: true });
				this._protocols.register(createForgeProtocol(config.forgeDir));

				const forgeResult = await discoverForgeModules(config.forgeDir);
				this._forgeHealthReport = {
					loaded: forgeResult.loaded.map((m) => m.name),
					failed: forgeResult.failed,
					pending: [], // TODO: populate when forge has pending/approval workflow
				};

				for (const mod of forgeResult.loaded) {
					for (const tool of mod.tools) {
						this._cortex.registerTool(tool);
					}
					for (const protocol of mod.protocols) {
						this._protocols.register(protocol);
					}
					if (mod.onLoad) {
						await mod.onLoad();
					}
					this._modules.push(mod);
				}
			}

			await this._signals.emit("session:start", "runtime");
			this._booted = true;

			this._audit.log({
				action: "runtime:boot",
				source: "runtime",
				detail: `Friday online. Model: ${reasoningModel}, Modules: ${this._modules.length}`,
				success: true,
			});

			if (config.debug) {
				this._audit.log({
					action: "debug:enabled",
					source: "runtime",
					detail: "Debug inference logging active — payloads and responses will be written to last-inference-payload.log and last-inference-response.log",
					success: true,
				});
			}
		} catch (err) {
			this._booted = false;
			// Unload any successfully-loaded modules
			for (const mod of this._modules) {
				try {
					if (mod.onUnload) await mod.onUnload();
				} catch { /* best-effort cleanup */ }
			}
			this._modules = [];
			try { this._directiveEngine?.stop(); } catch { /* best-effort */ }
			try {
				if (this._rhythmScheduler) {
					this._rhythmScheduler.stop();
					this._rhythmScheduler = undefined;
					this._rhythmStore = undefined;
				}
			} catch { /* best-effort */ }
			try {
				if (this._vox) {
					this._vox.stop();
					this._vox = undefined;
				}
			} catch { /* best-effort */ }
			try {
				if (this._sensorium) {
					this._sensorium.stop();
					this._sensorium = undefined;
				}
			} catch { /* best-effort */ }
			try {
				if (this._smartsMemory) {
					this._smartsMemory.close();
					this._smartsMemory = undefined;
					this._smarts = undefined;
				}
			} catch { /* best-effort */ }
			try {
				if (this._memory) {
					this._memory.close();
					this._memory = undefined;
				}
			} catch { /* best-effort */ }
			throw err;
		}
		} finally {
			this._booting = false;
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
			if (protocol.clearance.length > 0) {
				const check = this._clearance.checkAll(protocol.clearance);
				if (!check.granted) {
					this._audit.log({
						action: "protocol:blocked",
						source: protocol.name,
						detail: check.reason ?? `Clearance denied for protocol: ${protocol.name}`,
						success: false,
					});
					return { output: check.reason ?? `Clearance denied for protocol: ${protocol.name}`, source: "protocol" };
				}
			}
			const result = await protocol.execute(
				{ rawArgs: parsed.rawArgs },
				{
					workingDirectory: process.cwd(),
					audit: this._audit,
					signal: this._signals,
					memory: this._memory?.scoped("protocol") ?? {
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

	async shutdown(onProgress?: (step: ShutdownStep, label: string) => void): Promise<void> {
		if (!this._booted) {
			console.warn("Runtime.shutdown() called but not booted — allowing graceful re-entry");
			return;
		}
		this._booted = false;

		// Stop Arc Rhythm scheduler before other cleanup
		try {
			if (this._rhythmScheduler) {
				onProgress?.("arc-rhythm", "Stopping Arc Rhythm scheduler...");
				await this._rhythmScheduler.stop();
				this._rhythmScheduler = undefined;
				this._rhythmStore = undefined;
			}
		} catch (err) {
			console.warn("Arc Rhythm shutdown failed:", err instanceof Error ? err.message : err);
		}

		// Stop Vox voice output
		try {
			if (this._vox) {
				onProgress?.("vox", "Stopping voice output...");
				this._vox.stop();
				this._vox = undefined;
			}
		} catch (err) {
			console.warn("Vox shutdown failed:", err instanceof Error ? err.message : err);
		}

		// Stop sensorium polling before cleanup
		try {
			if (this._sensorium) {
				onProgress?.("sensorium", "Stopping environment sensors...");
				this._sensorium.stop();
				this._sensorium = undefined;
			}
		} catch (err) {
			console.warn("Sensorium shutdown failed:", err instanceof Error ? err.message : err);
		}

		try {
			if (this._memory && this._sessionId && this._sessionStartedAt) {
				onProgress?.("conversation", "Saving conversation history...");
				const history = this._cortex.getHistory();
				if (history.length > 0) {
					let summary: string | undefined;
					if (this._summarizer) {
						summary = await this._summarizer.summarize(history);
					}
					await this._memory.saveConversation({
						id: this._sessionId,
						startedAt: this._sessionStartedAt,
						endedAt: new Date(),
						provider: "grok",
						model: this._cortex.modelName,
						messages: history,
						summary,
					});
				}
			}
		} catch (err) {
			console.warn("Conversation save failed:", err instanceof Error ? err.message : err);
		}

		try {
			if (this._curator) {
				onProgress?.("knowledge", "Extracting knowledge from conversation...");
				const history = this._cortex.getHistory();
				await this._curator.extractFromConversation(history);
			}
		} catch (err) {
			console.warn("Knowledge extraction failed:", err instanceof Error ? err.message : err);
		}

		this._forgeHealthReport = undefined;

		onProgress?.("modules", "Unloading modules...");
		try { await this._signals.emit("session:end", "runtime"); } catch { /* best-effort */ }
		for (const mod of this._modules) {
			try {
				if (mod.onUnload) await mod.onUnload();
			} catch { /* best-effort module cleanup */ }
		}
		onProgress?.("cleanup", "Closing databases...");
		try {
			if (this._smartsMemory) {
				this._smartsMemory.close();
				this._smartsMemory = undefined;
				this._smarts = undefined;
			}
		} catch { /* best-effort */ }
		try {
			if (this._memory) {
				this._memory.close();
				this._memory = undefined;
			}
		} catch { /* best-effort */ }
		try { this._directiveEngine?.stop(); } catch { /* best-effort */ }
		this._audit.log({
			action: "runtime:shutdown",
			source: "runtime",
			detail: "Friday going offline",
			success: true,
		});
	}
}
