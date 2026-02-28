import type { LanguageModelV3 } from "@ai-sdk/provider";
import { streamText, tool as aiTool, stepCountIs } from "ai";
import type { FridayConfig, ConversationMessage } from "./types.ts";
import { GENESIS_TEMPLATE } from "./prompts.ts";
import {
	createModel,
	DEFAULT_PROVIDER,
	PROVIDER_DEFAULTS,
} from "../providers/index.ts";
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
import { appendInferenceLog } from "../providers/debug-log.ts";

export interface CortexConfig extends Partial<FridayConfig> {
	injectedModel?: LanguageModelV3;
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
	private aiModel: LanguageModelV3;
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

		this.aiModel = config.injectedModel ?? createModel(providerName, this._modelName);
		this._providerName = providerName;

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

	get modelName(): string {
		return this._modelName;
	}

	get availableTools(): FridayTool[] {
		return [...this.tools.values()];
	}

	get historyLength(): number {
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

	async chatStream(userMessage: string): Promise<ChatStream> {
		await this.historyManager.compact();
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
			model: this.aiModel,
			system: systemPrompt,
			messages: this.historyManager.toMessages(),
			...(hasTools ? { tools: aiTools } : {}),
			...(hasTools
				? { stopWhen: stepCountIs(this.maxToolIterations) }
				: {}),
			maxOutputTokens: this.maxTokens,
		});

		if (this._debug && this.debugPayloadPath) {
			appendInferenceLog(this.debugPayloadPath, 1, {
				system: systemPrompt,
				messages: this.historyManager.toMessages(),
				maxOutputTokens: this.maxTokens,
			});
		}

		const fullTextPromise = result.text.then(async (text: string) => {
			this.historyManager.push({ role: "assistant", content: text });

			// Append intermediate messages (tool calls/results) from multi-step execution
			const response = await result.response;

			if (this._debug && this.debugResponsePath) {
				appendInferenceLog(this.debugResponsePath, 1, response);
			}

			// The response.messages include ALL messages from intermediate steps.
			// The HistoryManager already has the user message and we just pushed the
			// final assistant text. The intermediate tool-call/result messages are
			// internal to the AI SDK's step loop and don't need to be replayed.

			// Record real token usage for calibration — runs for all exchanges,
			// not just ones with assistant messages.
			const usage = await result.usage;
			if (usage?.inputTokens != null && usage?.outputTokens != null) {
				this.historyManager.recordUsage(
					usage.inputTokens + usage.outputTokens,
				);
			}

			if (this.vox && this.vox.mode !== "off") {
				this.vox.speak(text).catch(() => {});
			}
			return text;
		});

		const usagePromise = Promise.resolve(result.usage).then(
			(u: { inputTokens?: number; outputTokens?: number }) => ({
				inputTokens: u?.inputTokens,
				outputTokens: u?.outputTokens,
			}),
		).catch(() => ({ inputTokens: undefined, outputTokens: undefined }));

		return {
			textStream: result.textStream,
			fullText: fullTextPromise,
			usage: usagePromise,
		};
	}

	async chat(userMessage: string): Promise<string> {
		const startLength = this.historyManager.length;
		try {
			const stream = await this.chatStream(userMessage);
			return await stream.fullText;
		} catch (err) {
			this.historyManager.truncateTo(startLength);
			throw err;
		}
	}

	// ── History management ───────────────────────────────────────

	clearHistory(): void {
		this.historyManager.clear();
	}

	setHistory(messages: ConversationMessage[]): void {
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

	getHistory(): ConversationMessage[] {
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

}
