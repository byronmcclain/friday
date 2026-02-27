import type { LanguageModelV3 } from "@ai-sdk/provider";
import { streamText, tool as aiTool, stepCountIs } from "ai";
import type { FridayConfig, ConversationMessage, ContentBlock } from "./types.ts";
import { GENESIS_TEMPLATE } from "./prompts.ts";
import {
	createModel,
	createProvider,
	DEFAULT_PROVIDER,
	PROVIDER_DEFAULTS,
	type LLMProvider,
} from "../providers/index.ts";
import type { ToolDefinition } from "../providers/types.ts";
import type { FridayTool } from "../modules/types.ts";
import type { ClearanceManager } from "./clearance.ts";
import type { SmartsStore } from "../smarts/store.ts";
import { type Sensorium, formatDateTime } from "../sensorium/sensorium.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { SignalBus, SignalEmitter } from "./events.ts";
import type { ScopedMemory } from "./memory.ts";
import type { Vox } from "./voice/vox.ts";
import { HistoryManager } from "./history-manager.ts";
import type { ChatStream } from "./stream-types.ts";
import { toZodSchema } from "../providers/schemas.ts";

export interface CortexConfig extends Partial<FridayConfig> {
	injectedModel?: LanguageModelV3;
	/** @deprecated Legacy provider injection — use injectedModel instead. Removed in Task 13. */
	injectedProvider?: LLMProvider;
	clearance?: ClearanceManager;
	maxToolIterations?: number;
	smartsStore?: SmartsStore;
	sensorium?: Sensorium;
	audit?: AuditLogger;
	signals?: SignalBus;
	toolMemory?: ScopedMemory;
	genesisPrompt?: string;
	vox?: Vox;
	debug?: boolean;
	projectRoot?: string;
}

export class Cortex {
	// AI SDK model (new path)
	private aiModel?: LanguageModelV3;

	// Legacy provider (old path — removed in Task 13)
	private legacyProvider?: LLMProvider;
	private legacyHistory: ConversationMessage[] = [];

	// AI SDK history manager
	private historyManager: HistoryManager;

	// Shared
	private _providerName: string;
	private _modelName: string;
	private maxTokens: number;
	private tools: Map<string, FridayTool> = new Map();
	private clearance?: ClearanceManager;
	private maxToolIterations: number;
	private smartsStore?: SmartsStore;
	private sensorium?: Sensorium;
	private audit?: AuditLogger;
	private signals?: SignalBus;
	private toolMemory?: ScopedMemory;
	private pinnedSmarts = new Set<string>();
	private genesisPrompt?: string;
	private vox?: Vox;
	private _debug: boolean;
	private debugPayloadPath?: string;
	private debugResponsePath?: string;

	constructor(config: CortexConfig = {}) {
		const providerName = config.provider ?? DEFAULT_PROVIDER;
		this._modelName = config.model ?? PROVIDER_DEFAULTS[providerName].model;
		this.maxTokens = config.maxTokens ?? 12288;
		this.maxToolIterations = config.maxToolIterations ?? 10;

		// Resolve model: injectedModel > injectedProvider (legacy) > createModel
		if (config.injectedModel) {
			this.aiModel = config.injectedModel;
			this._providerName = providerName;
		} else if (config.injectedProvider) {
			this.legacyProvider = config.injectedProvider;
			this._providerName = config.injectedProvider.name;
		} else {
			this.aiModel = createModel(providerName, this._modelName);
			this._providerName = providerName;
		}

		this.historyManager = new HistoryManager({ maxTokens: 128000 });
		this.clearance = config.clearance;
		this.smartsStore = config.smartsStore;
		this.sensorium = config.sensorium;
		this.audit = config.audit;
		this.signals = config.signals;
		this.toolMemory = config.toolMemory;
		this.genesisPrompt = config.genesisPrompt;
		this.vox = config.vox;
		this._debug = config.debug ?? false;
		if (this._debug && config.projectRoot) {
			this.debugPayloadPath = `${config.projectRoot}/last-inference-payload.log`;
			this.debugResponsePath = `${config.projectRoot}/last-inference-response.log`;
		}
	}

	get providerName(): string {
		return this._providerName;
	}

	/** @deprecated Use createModel() directly — removed in Task 13 */
	get llmProvider(): LLMProvider {
		if (!this.legacyProvider) {
			throw new Error(
				"llmProvider not available on AI SDK path — use createModel() instead",
			);
		}
		return this.legacyProvider;
	}

	get modelName(): string {
		return this._modelName;
	}

	get availableTools(): FridayTool[] {
		return [...this.tools.values()];
	}

	get historyLength(): number {
		if (this.legacyProvider) return this.legacyHistory.length;
		return this.historyManager.length;
	}

	registerTool(tool: FridayTool): void {
		this.tools.set(tool.name, tool);
	}

	pinSmart(name: string): void {
		this.pinnedSmarts.add(name);
	}

	unpinSmart(name: string): void {
		this.pinnedSmarts.delete(name);
	}

	// ── AI SDK path ──────────────────────────────────────────────

	async chatStream(userMessage: string): Promise<ChatStream> {
		if (this.legacyProvider) {
			const text = await this.legacyChat(userMessage);
			return {
				textStream: (async function* () {
					yield text;
				})(),
				fullText: Promise.resolve(text),
				usage: Promise.resolve({
					inputTokens: undefined,
					outputTokens: undefined,
				}),
			};
		}

		const systemPrompt = await this.buildSystemPrompt(userMessage);
		this.historyManager.push({ role: "user", content: userMessage });

		if (this._debug) {
			this.audit?.log({
				action: "debug:system-prompt",
				source: "cortex",
				detail: systemPrompt,
				success: true,
			});
			if (this.debugPayloadPath && this.debugResponsePath) {
				try {
					await Bun.write(this.debugPayloadPath, "");
					await Bun.write(this.debugResponsePath, "");
				} catch {
					this.audit?.log({
						action: "debug:inference-write-failed",
						source: "cortex",
						detail: "Failed to clear inference log files",
						success: false,
					});
				}
			}
		}

		const aiTools = this.buildAiTools();
		const hasTools = Object.keys(aiTools).length > 0;

		const result = streamText({
			model: this.aiModel!,
			system: systemPrompt,
			messages: this.historyManager.toMessages(),
			...(hasTools ? { tools: aiTools } : {}),
			...(hasTools
				? { stopWhen: stepCountIs(this.maxToolIterations) }
				: {}),
			maxTokens: this.maxTokens,
		});

		const fullTextPromise = result.text.then(async (text: string) => {
			this.historyManager.push({ role: "assistant", content: text });

			// Append intermediate messages (tool calls/results) from multi-step execution
			const response = await result.response;
			if (response.messages && response.messages.length > 0) {
				// The response.messages include ALL messages from intermediate steps.
				// The HistoryManager already has the user message and we just pushed the
				// final assistant text. The intermediate tool-call/result messages are
				// internal to the AI SDK's step loop and don't need to be replayed.
				// Record real token usage for calibration.
				const usage = await result.usage;
				if (usage?.inputTokens != null && usage?.outputTokens != null) {
					this.historyManager.recordUsage(
						usage.inputTokens + usage.outputTokens,
					);
				}
			}

			if (this.vox && this.vox.mode !== "off") {
				this.vox.speak(text).catch(() => {});
			}
			return text;
		});

		const usagePromise = result.usage.then(
			(u: { inputTokens?: number; outputTokens?: number }) => ({
				inputTokens: u?.inputTokens,
				outputTokens: u?.outputTokens,
			}),
		);

		return {
			textStream: result.textStream,
			fullText: fullTextPromise,
			usage: usagePromise,
		};
	}

	async chat(userMessage: string): Promise<string> {
		if (this.legacyProvider) {
			return this.legacyChat(userMessage);
		}
		const stream = await this.chatStream(userMessage);
		return stream.fullText;
	}

	// ── History management ───────────────────────────────────────

	clearHistory(): void {
		if (this.legacyProvider) {
			this.legacyHistory = [];
		} else {
			this.historyManager.clear();
		}
	}

	setHistory(messages: ConversationMessage[]): void {
		if (this.legacyProvider) {
			this.legacyHistory = [...messages];
		} else {
			this.historyManager.setHistory(
				messages.map((m) => ({
					role: m.role as "user" | "assistant",
					content:
						typeof m.content === "string"
							? m.content
							: JSON.stringify(m.content),
				})),
			);
		}
	}

	getHistory(): ConversationMessage[] {
		if (this.legacyProvider) {
			return [...this.legacyHistory];
		}
		return this.historyManager.getHistory().map((m) => ({
			role: m.role as "user" | "assistant",
			content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
		}));
	}

	// ── AI SDK tool builder ──────────────────────────────────────

	private buildAiTools(): Record<
		string,
		ReturnType<typeof aiTool<any, any>>
	> {
		const tools: Record<string, ReturnType<typeof aiTool<any, any>>> = {};
		for (const [name, fridayTool] of this.tools) {
			tools[name] = aiTool({
				description: fridayTool.description,
				inputSchema: toZodSchema(fridayTool.parameters),
				execute: async (args: Record<string, unknown>) => {
					if (fridayTool.clearance.length > 0) {
						if (!this.clearance) {
							return `Clearance denied for tool: ${name} (clearance manager not configured)`;
						}
						const check = this.clearance.checkAll(
							fridayTool.clearance,
						);
						if (!check.granted) {
							return (
								check.reason ??
								`Clearance denied for tool: ${name}`
							);
						}
					}
					try {
						const result = await fridayTool.execute(args, {
							workingDirectory: process.cwd(),
							audit:
								this.audit ??
								({
									log: () => {},
								} as unknown as AuditLogger),
							signal:
								this.signals ??
								({
									emit: async () => {},
								} as SignalEmitter),
							memory: this.toolMemory ?? {
								get: async () => undefined,
								set: async () => {},
								delete: async () => {},
								list: async () => [],
							},
						});
						return result.output;
					} catch (err) {
						const msg =
							err instanceof Error ? err.message : String(err);
						return `Tool execution error: ${msg}`;
					}
				},
			});
		}
		return tools;
	}

	// ── System prompt builder ────────────────────────────────────

	private async buildSystemPrompt(userMessage: string): Promise<string> {
		const MAX_SMARTS_SECTIONS = 8;
		const MAX_SMARTS_CHARS = 4000;

		let prompt = this.genesisPrompt ?? GENESIS_TEMPLATE;

		// SMARTS knowledge enrichment
		if (this.smartsStore) {
			const sections: string[] = [];
			let totalChars = 0;

			for (const name of this.pinnedSmarts) {
				if (
					sections.length >= MAX_SMARTS_SECTIONS ||
					totalChars >= MAX_SMARTS_CHARS
				)
					break;
				const entry = await this.smartsStore.getByName(name);
				if (entry) {
					const title =
						entry.content.split("\n")[0]?.replace(/^#+\s*/, "") ||
						entry.name;
					const section = `### ${title} (confidence: ${entry.confidence})\n${entry.content}`;
					sections.push(section);
					totalChars += section.length;
				}
			}

			const relevant =
				await this.smartsStore.findRelevant(userMessage);
			for (const entry of relevant) {
				if (
					sections.length >= MAX_SMARTS_SECTIONS ||
					totalChars >= MAX_SMARTS_CHARS
				)
					break;
				if (this.pinnedSmarts.has(entry.name)) continue;
				const title =
					entry.content.split("\n")[0]?.replace(/^#+\s*/, "") ||
					entry.name;
				const section = `### ${title} (confidence: ${entry.confidence})\n${entry.content}`;
				sections.push(section);
				totalChars += section.length;
			}

			if (sections.length > 0) {
				prompt = `${prompt}\n\n## Active Knowledge\n\nThe following domain knowledge is available for this conversation.\nUse it to inform your responses when relevant.\n\n${sections.join("\n\n")}`;
			}
		}

		// Sensorium environment context (includes date/time)
		if (this.sensorium) {
			const envBlock = this.sensorium.getContextBlock();
			if (envBlock) {
				prompt = `${prompt}\n\n## Environment\n\n${envBlock}`;
			}
		} else {
			prompt = `${prompt}\n\n## Current Time\n\n${formatDateTime()}`;
		}

		return prompt;
	}

	// ── Legacy path (preserved during migration — removed in Task 13) ──

	private async legacyChat(userMessage: string): Promise<string> {
		const startLength = this.legacyHistory.length;
		this.legacyHistory.push({ role: "user", content: userMessage });
		let toolsExecuted = false;

		try {
			const systemPrompt = await this.buildSystemPrompt(userMessage);
			if (this._debug) {
				this.audit?.log({
					action: "debug:system-prompt",
					source: "cortex",
					detail: systemPrompt,
					success: true,
				});
				if (this.debugPayloadPath && this.debugResponsePath) {
					try {
						await Bun.write(this.debugPayloadPath, "");
						await Bun.write(this.debugResponsePath, "");
					} catch {
						this.audit?.log({
							action: "debug:inference-write-failed",
							source: "cortex",
							detail: "Failed to clear inference log files",
							success: false,
						});
					}
				}
			}
			const toolDefs = this.toLegacyToolDefinitions();
			const options = {
				model: this._modelName,
				maxTokens: this.maxTokens,
				...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
			};

			for (let i = 0; i < this.maxToolIterations; i++) {
				const roundOptions = {
					...options,
					...(this._debug &&
					this.debugPayloadPath &&
					this.debugResponsePath
						? {
								debug: {
									payloadPath: this.debugPayloadPath,
									responsePath: this.debugResponsePath,
									round: i + 1,
								},
							}
						: {}),
				};
				const response = await this.legacyProvider!.chat(
					systemPrompt,
					this.legacyHistory,
					roundOptions,
				);

				if (response.type === "text") {
					let text = response.text;
					if (response.truncated) {
						text +=
							"\n\n⚠ [Response truncated — hit token limit]";
					}
					this.legacyHistory.push({
						role: "assistant",
						content: text,
					});
					if (this.vox && this.vox.mode !== "off") {
						this.vox.speak(text).catch(() => {});
					}
					return text;
				}

				// tool_use response
				const assistantBlocks: ContentBlock[] =
					response.toolCalls.map((tc) => ({
						type: "tool_use" as const,
						id: tc.id,
						name: tc.name,
						input: tc.input,
					}));
				this.legacyHistory.push({
					role: "assistant",
					content: assistantBlocks,
				});

				const results = await Promise.all(
					response.toolCalls.map((tc) =>
						this.executeLegacyToolCall(tc),
					),
				);
				toolsExecuted = true;

				const resultBlocks: ContentBlock[] = results.map((r) => ({
					type: "tool_result" as const,
					toolCallId: r.toolCallId,
					content: r.output,
					isError: r.isError,
				}));
				this.legacyHistory.push({
					role: "user",
					content: resultBlocks,
				});
			}

			throw new Error(
				`Max tool iterations (${this.maxToolIterations}) exceeded`,
			);
		} catch (err) {
			if (toolsExecuted) {
				console.warn(
					"Cortex chat() failed after tool executions; preserving partial history",
				);
			} else {
				this.legacyHistory.length = startLength;
			}
			throw err;
		}
	}

	private toLegacyToolDefinitions(): ToolDefinition[] {
		return [...this.tools.values()].map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		}));
	}

	private async executeLegacyToolCall(call: {
		id: string;
		name: string;
		input: Record<string, unknown>;
	}): Promise<{ toolCallId: string; output: string; isError: boolean }> {
		const tool = this.tools.get(call.name);
		if (!tool) {
			return {
				toolCallId: call.id,
				output: `Unknown tool: ${call.name}`,
				isError: true,
			};
		}

		if (tool.clearance.length > 0) {
			if (!this.clearance) {
				console.warn(
					`Clearance check unavailable — denying tool: ${call.name}`,
				);
				return {
					toolCallId: call.id,
					output: `Clearance denied for tool: ${call.name} (clearance manager not configured)`,
					isError: true,
				};
			}
			const check = this.clearance.checkAll(tool.clearance);
			if (!check.granted) {
				return {
					toolCallId: call.id,
					output:
						check.reason ??
						`Clearance denied for tool: ${call.name}`,
					isError: true,
				};
			}
		}

		try {
			const result = await tool.execute(call.input, {
				workingDirectory: process.cwd(),
				audit:
					this.audit ??
					({ log: () => {} } as unknown as AuditLogger),
				signal:
					this.signals ??
					({ emit: async () => {} } as SignalEmitter),
				memory: this.toolMemory ?? {
					get: async () => undefined,
					set: async () => {},
					delete: async () => {},
					list: async () => [],
				},
			});
			return {
				toolCallId: call.id,
				output: result.output,
				isError: !result.success,
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				toolCallId: call.id,
				output: `Tool execution error: ${msg}`,
				isError: true,
			};
		}
	}
}

export { Cortex as FridayCore };
