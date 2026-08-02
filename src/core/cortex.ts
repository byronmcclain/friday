import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { AuditLogger } from "../audit/logger.ts";
import type { FridayTool } from "../modules/types.ts";
import { appendInferenceLog } from "../providers/debug-log.ts";
import { createModel, GROK_DEFAULTS } from "../providers/index.ts";
import { buildEmotionalContext } from "../psyche/context.ts";
import type { PsycheStore } from "../psyche/store.ts";
import { formatDateTime, type Sensorium } from "../sensorium/sensorium.ts";
import type { SmartsStore } from "../smarts/store.ts";
import type { ClearanceManager } from "./clearance.ts";
import type { SignalBus } from "./events.ts";
import { HistoryManager } from "./history-manager.ts";
import type { ScopedMemory } from "./memory.ts";
import type { NotificationManager } from "./notifications.ts";
import { GENESIS_TEMPLATE } from "./prompts.ts";
import type { ChatStream, TokenUsage, VoiceChatStream } from "./stream-types.ts";
import { buildToolDefinitions, createToolExecutor } from "./tool-bridge.ts";
import { type ConversationMessage, type FridayConfig, getTextContent } from "./types.ts";
import { buildVoiceSystemPrompt } from "./voice/prompt.ts";
import type { Vox } from "./voice/vox.ts";
import { createPushIterable, type PushIterable } from "./workers/push-iterable.ts";
import { TextWorker } from "./workers/text-worker.ts";
import type { VoiceWorker } from "./workers/voice-worker.ts";

/** Max retries when LLM returns an empty response */
const MAX_EMPTY_RETRIES = 2;

const EMPTY_TOKEN_USAGE: TokenUsage = {
	inputTokens: undefined,
	outputTokens: undefined,
};

function fmtDuration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export interface CortexConfig extends Partial<FridayConfig> {
	injectedModel?: LanguageModelV4;
	sessionId?: string;
	clearance?: ClearanceManager;
	maxToolIterations?: number;
	smartsStore?: SmartsStore;
	sensorium?: Sensorium;
	audit?: AuditLogger;
	signals?: SignalBus;
	toolMemory?: ScopedMemory;
	/** Per-tool memory scoping — maps tool name → module-scoped memory */
	toolMemoryMap?: Map<string, ScopedMemory>;
	notifications?: NotificationManager;
	genesisPrompt?: string;
	vox?: Vox;
	psyche?: PsycheStore;
	debug?: boolean;
	projectRoot?: string;
	/** Per-step inference timeout in ms (default: 120000 = 2 min) */
	inferenceTimeout?: number;
}

export class Cortex {
	private aiModel: LanguageModelV4;
	private historyManager: HistoryManager;

	// Shared
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
	private toolMemoryMap?: Map<string, ScopedMemory>;
	private notifications?: NotificationManager;
	private pinnedSmarts = new Set<string>();
	private genesisPrompt?: string;
	private vox?: Vox;
	private psyche?: PsycheStore;
	private _debug: boolean;
	private debugPayloadPath?: string;
	private debugResponsePath?: string;
	private readonly textWorker: TextWorker;
	private readonly inferenceTimeout: number;
	private _cachedDefs: ReturnType<typeof buildToolDefinitions> | null = null;
	private _cachedExecutor: ReturnType<typeof createToolExecutor> | null = null;

	constructor(config: CortexConfig = {}) {
		this._modelName = config.model ?? GROK_DEFAULTS.model;
		this.maxTokens = config.maxTokens ?? 12288;
		this.maxToolIterations = config.maxToolIterations ?? 10;

		this.aiModel = config.injectedModel ?? createModel(this._modelName, config.sessionId);

		this.historyManager = new HistoryManager({ maxTokens: 128000 });
		this.clearance = config.clearance;
		this.smartsStore = config.smartsStore;
		this.sensorium = config.sensorium;
		this.audit = config.audit;
		this.signals = config.signals;
		this.toolMemory = config.toolMemory;
		this.toolMemoryMap = config.toolMemoryMap;
		this.notifications = config.notifications;
		this.genesisPrompt = config.genesisPrompt;
		this.vox = config.vox;
		this.psyche = config.psyche;
		this._debug = config.debug ?? false;
		if (this._debug && config.projectRoot) {
			this.debugPayloadPath = `${config.projectRoot}/last-inference-payload.log`;
			this.debugResponsePath = `${config.projectRoot}/last-inference-response.log`;
		}
		this.textWorker = new TextWorker(this.aiModel);
		this.inferenceTimeout = config.inferenceTimeout ?? 120_000;
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
		this._cachedDefs = null;
		this._cachedExecutor = null;
	}

	pinSmart(name: string): void {
		this.pinnedSmarts.add(name);
	}

	unpinSmart(name: string): void {
		this.pinnedSmarts.delete(name);
	}

	async chatStream(userMessage: string): Promise<ChatStream> {
		const { systemPrompt, defs, executor } = await this.prepareTurn(userMessage);

		const inferenceStart = Date.now();
		this.audit?.log({
			action: "inference:start",
			source: "cortex",
			detail: `model=${this._modelName} tools=${defs.length}`,
			success: true,
		});

		if (this._debug) {
			this.audit?.log({
				action: "debug:system-prompt",
				source: "cortex",
				detail: systemPrompt,
				success: true,
			});
			if (this.debugPayloadPath && this.debugResponsePath) {
				try {
					await Promise.all([
						Bun.write(this.debugPayloadPath, ""),
						Bun.write(this.debugResponsePath, ""),
					]);
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

		if (this._debug && this.debugPayloadPath) {
			appendInferenceLog(this.debugPayloadPath, 1, {
				system: systemPrompt,
				messages: this.historyManager.toMessages(),
				maxOutputTokens: this.maxTokens,
			});
		}

		const workerOptions = {
			systemPrompt,
			messages: this.historyManager.toMessages(),
			tools: defs,
			executeTool: executor,
			maxToolIterations: this.maxToolIterations,
			maxOutputTokens: this.maxTokens,
			stepTimeoutMs: this.inferenceTimeout,
		};

		// Wrap the underlying worker stream so retries can push chunks into
		// the same textStream exposed to callers. Without this, a retry's
		// chunks are dropped and the conversation UI renders empty while
		// fullText carries the retry text out-of-band.
		const wrapped = createPushIterable<string>({ collect: true });
		const { promise: usagePromise, resolve: resolveUsage } = Promise.withResolvers<TokenUsage>();

		const drainAttempt = async () => {
			const workerResult = this.textWorker.process(workerOptions);
			try {
				for await (const chunk of workerResult.textStream) {
					wrapped.push(chunk);
				}
			} catch (err) {
				// Swallow the mirrored fullText rejection to avoid an unhandled promise.
				void Promise.resolve(workerResult.fullText).catch(() => {});
				throw err;
			}
			const text = await workerResult.fullText;
			return { text, usage: workerResult.usage };
		};

		this.runInferenceWithRetry(wrapped, drainAttempt).then(resolveUsage, () =>
			resolveUsage(EMPTY_TOKEN_USAGE),
		);

		const fullTextPromise = wrapped.fullValue.then(
			async (finalText: string) => {
				const duration = fmtDuration(Date.now() - inferenceStart);
				this.audit?.log({
					action: "inference:complete",
					source: "cortex",
					detail: `${duration}, ${finalText.length} chars`,
					success: true,
				});

				this.historyManager.push({ role: "assistant", content: finalText });

				if (this._debug && this.debugResponsePath) {
					appendInferenceLog(this.debugResponsePath, 1, { text: finalText });
				}

				const usage = await usagePromise;
				if (usage?.inputTokens != null && usage?.outputTokens != null) {
					this.historyManager.recordUsage(usage.inputTokens + usage.outputTokens);
				}

				if (this.vox && this.vox.mode !== "off" && finalText.trim()) {
					this.vox.speak(finalText).catch(() => {});
				}
				return finalText;
			},
			(err) => {
				const errDuration = fmtDuration(Date.now() - inferenceStart);
				this.audit?.log({
					action: "inference:error",
					source: "cortex",
					detail: `${errDuration}: ${err instanceof Error ? err.message : String(err)}`,
					success: false,
				});
				throw err;
			},
		);

		return {
			textStream: wrapped.iterable,
			fullText: fullTextPromise,
			usage: usagePromise,
		};
	}

	private async runInferenceWithRetry(
		wrapped: PushIterable<string>,
		drainAttempt: () => Promise<{
			text: string;
			usage: PromiseLike<TokenUsage | undefined>;
		}>,
	): Promise<TokenUsage> {
		let finalText: string;
		let finalUsageSource: PromiseLike<TokenUsage | undefined>;

		try {
			({ text: finalText, usage: finalUsageSource } = await drainAttempt());

			if (!finalText.trim()) {
				this.audit?.log({
					action: "inference:empty",
					source: "cortex",
					detail: `Empty response from ${this._modelName}, retrying`,
					success: false,
				});

				for (let attempt = 1; attempt <= MAX_EMPTY_RETRIES; attempt++) {
					try {
						const retry = await drainAttempt();
						if (retry.text.trim()) {
							finalText = retry.text;
							finalUsageSource = retry.usage;
							this.audit?.log({
								action: "inference:retry-success",
								source: "cortex",
								detail: `Retry ${attempt}/${MAX_EMPTY_RETRIES} succeeded, ${finalText.length} chars`,
								success: true,
							});
							break;
						}
					} catch {
						// Retry failed — continue to next attempt
					}
				}

				if (!finalText.trim()) {
					finalText = "Apologies — I received an empty response. Could you try again?";
					wrapped.push(finalText);
					this.audit?.log({
						action: "inference:empty-fallback",
						source: "cortex",
						detail: `${MAX_EMPTY_RETRIES} retries all empty, using fallback`,
						success: false,
					});
				}
			}
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			wrapped.error(error);
			throw error;
		}

		wrapped.done();
		try {
			return (await Promise.resolve(finalUsageSource)) ?? EMPTY_TOKEN_USAGE;
		} catch {
			return EMPTY_TOKEN_USAGE;
		}
	}

	async chatStreamVoice(userMessage: string, voiceWorker: VoiceWorker): Promise<VoiceChatStream> {
		const { systemPrompt, defs, executor } = await this.prepareTurn(userMessage);

		// Enrich with voice delivery guidance (identity + delivery rules)
		const voicePrompt = buildVoiceSystemPrompt(systemPrompt);

		// Delegate to VoiceWorker (messages not needed — Grok has its own conversation context)
		const workerResult = voiceWorker.process({
			systemPrompt: voicePrompt,
			messages: [],
			tools: defs,
			executeTool: executor,
			maxToolIterations: this.maxToolIterations,
			maxOutputTokens: this.maxTokens,
		});

		// Record in history when complete — do NOT fire Vox (Grok speaks directly)
		const fullTextPromise = workerResult.fullText.then(async (text: string) => {
			this.historyManager.push({ role: "assistant", content: text });

			const usage = await workerResult.usage;
			if (usage?.inputTokens != null && usage?.outputTokens != null) {
				this.historyManager.recordUsage(usage.inputTokens + usage.outputTokens);
			}
			return text;
		});

		return {
			textStream: workerResult.textStream,
			audioStream: workerResult.audioStream!,
			toolEvents: workerResult.toolEvents,
			fullText: fullTextPromise,
			usage: workerResult.usage,
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

	// ── Turn preparation ────────────────────────────────────────

	private async prepareTurn(userMessage: string) {
		await this.historyManager.compact();
		const systemPrompt = await this.buildSystemPrompt(userMessage);
		this.historyManager.push({ role: "user", content: userMessage });

		if (!this._cachedDefs) {
			this._cachedDefs = buildToolDefinitions(this.tools);
		}
		if (!this._cachedExecutor) {
			this._cachedExecutor = createToolExecutor({
				tools: this.tools,
				clearance: this.clearance,
				audit: this.audit,
				signals: this.signals,
				toolMemory: this.toolMemory,
				toolMemoryMap: this.toolMemoryMap,
				notifications: this.notifications,
			});
		}

		return { systemPrompt, defs: this._cachedDefs, executor: this._cachedExecutor };
	}

	// ── History management ───────────────────────────────────────

	clearHistory(): void {
		this.historyManager.clear();
	}

	setHistory(messages: ConversationMessage[]): void {
		this.historyManager.setHistory(
			messages.map((m) => ({
				role: m.role as "user" | "assistant",
				content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
			})),
		);
	}

	getHistory(): ConversationMessage[] {
		return this.historyManager.getHistory().map((m) => ({
			role: m.role as "user" | "assistant",
			content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
		}));
	}

	getRecentHistory(n: number): string[] {
		return this.getHistory()
			.slice(-n)
			.map((m) => {
				const role = m.role === "user" ? "User" : "Assistant";
				return `${role}: ${getTextContent(m.content)}`;
			});
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

			// Parallel fetch — pinned smarts are independent reads
			const pinnedEntries =
				this.pinnedSmarts.size > 0
					? await Promise.all(
							[...this.pinnedSmarts].map((name) => this.smartsStore!.getByName(name)),
						)
					: [];
			for (const entry of pinnedEntries) {
				if (sections.length >= MAX_SMARTS_SECTIONS || totalChars >= MAX_SMARTS_CHARS) break;
				if (entry) {
					const title = entry.content.split("\n")[0]?.replace(/^#+\s*/, "") || entry.name;
					const section = `### ${title} (confidence: ${entry.confidence})\n${entry.content}`;
					sections.push(section);
					totalChars += section.length;
				}
			}

			const relevant = await this.smartsStore.findRelevant(userMessage);
			for (const entry of relevant) {
				if (sections.length >= MAX_SMARTS_SECTIONS || totalChars >= MAX_SMARTS_CHARS) break;
				if (this.pinnedSmarts.has(entry.name)) continue;
				const title = entry.content.split("\n")[0]?.replace(/^#+\s*/, "") || entry.name;
				const section = `### ${title} (confidence: ${entry.confidence})\n${entry.content}`;
				sections.push(section);
				totalChars += section.length;
			}

			if (sections.length > 0) {
				prompt = `${prompt}\n\n## Active Knowledge\n\nThe following domain knowledge is available for this conversation.\nUse it to inform your responses when relevant.\n\n${sections.join("\n\n")}`;
			}
		}

		// Psyche emotional context
		if (this.psyche && this.psyche.hasDimensions()) {
			const emotionalContext = buildEmotionalContext(
				this.psyche.getDimensions(),
				this.psyche.getLastSessionMood(),
				this.psyche.findRelevantMilestones(userMessage),
			);
			if (emotionalContext) {
				prompt = `${prompt}\n\n${emotionalContext}`;
			}
		}

		// Sensorium environment context (includes date/time)
		if (this.sensorium) {
			const envBlock = this.sensorium.getContextBlock();
			if (envBlock) {
				prompt = `${prompt}\n\n## Environment\n\n${envBlock}\n(Cached ambient snapshot — use the getEnvironmentStatus tool for fresh or detailed readings.)`;
			}
		} else {
			prompt = `${prompt}\n\n## Current Time\n\n${formatDateTime()}`;
		}

		return prompt;
	}
}
