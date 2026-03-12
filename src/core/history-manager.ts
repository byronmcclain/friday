import type { ModelMessage } from "ai";

/** Function signature for the summarize callback */
export type SummarizeFn = (
	messages: ModelMessage[],
) => Promise<string | undefined>;

export interface HistoryManagerConfig {
	/** Token budget — compact() triggers when tokenEstimate exceeds this */
	maxTokens: number;
	/** Optional summarize callback — if not provided, compact() just truncates */
	summarize?: SummarizeFn;
}

export class HistoryManager {
	private messages: ModelMessage[] = [];
	private _tokenEstimate = 0;
	private summaryPrefix?: string;
	private config: HistoryManagerConfig;

	constructor(config: HistoryManagerConfig) {
		this.config = config;
	}

	get tokenEstimate(): number {
		return this._tokenEstimate;
	}

	get length(): number {
		return this.messages.length;
	}

	push(message: ModelMessage, tokens?: number): void {
		this.messages.push(message);
		this._tokenEstimate += tokens ?? this.estimateTokens(message);
	}

	pop(): ModelMessage | undefined {
		const removed = this.messages.pop();
		if (removed) {
			this._tokenEstimate = Math.max(
				0,
				this._tokenEstimate - this.estimateTokens(removed),
			);
		}
		return removed;
	}

	clear(): void {
		this.messages = [];
		this._tokenEstimate = 0;
		this.summaryPrefix = undefined;
	}

	setHistory(messages: ModelMessage[]): void {
		this.messages = [...messages];
		this._tokenEstimate = messages.reduce(
			(sum, m) => sum + this.estimateTokens(m),
			0,
		);
		this.summaryPrefix = undefined;
	}

	getHistory(): ModelMessage[] {
		return [...this.messages];
	}

	/** Roll back history to a previous length (for error recovery) */
	truncateTo(length: number): void {
		if (length < this.messages.length) {
			this.messages.length = length;
			this._tokenEstimate = this.messages.reduce(
				(sum, m) => sum + this.estimateTokens(m), 0,
			);
		}
	}

	/** Calibrate token count with real usage from API */
	recordUsage(tokens: number): void {
		this._tokenEstimate = tokens;
	}

	/** Compact history if over token budget */
	async compact(): Promise<void> {
		if (this._tokenEstimate < this.config.maxTokens) return;
		if (this.messages.length <= 4) return; // too few to compact

		const keepCount = Math.max(4, Math.floor(this.messages.length * 0.3));
		const old = this.messages.slice(0, -keepCount);
		const recent = this.messages.slice(-keepCount);

		if (this.config.summarize) {
			const summary = await this.config.summarize(old);
			if (summary) {
				this.summaryPrefix = summary;
			}
		}

		this.messages = recent;
		this._tokenEstimate = recent.reduce(
			(sum, m) => sum + this.estimateTokens(m),
			0,
		);
		if (this.summaryPrefix) {
			this._tokenEstimate += Math.ceil(this.summaryPrefix.length / 4);
		}
	}

	/** Get messages ready to send to the model (returns internal array directly when no summary prefix) */
	toMessages(): ModelMessage[] {
		if (this.summaryPrefix) {
			return [
				{
					role: "user",
					content: `[Previous context summary: ${this.summaryPrefix}]`,
				},
				{
					role: "assistant",
					content: "Understood, I have the context.",
				},
				...this.messages,
			];
		}
		return this.messages;
	}

	private estimateTokens(message: ModelMessage | string): number {
		if (typeof message === "string") return Math.ceil(message.length / 4);
		const content =
			typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content);
		return Math.ceil(content.length / 4);
	}
}
