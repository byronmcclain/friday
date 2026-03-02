import { ClientRegistry, type RegisteredClient } from "./client-registry.ts";
import type { ServerMessage } from "./protocol.ts";
import type { FridayRuntime } from "../core/runtime.ts";
import type { ConversationSummarizer } from "../core/summarizer.ts";
import type { SmartsCurator } from "../smarts/curator.ts";

export interface SessionHubConfig {
	runtime: FridayRuntime;
	summarizer?: ConversationSummarizer;
	curator?: SmartsCurator;
}

export class SessionHub {
	private registry = new ClientRegistry();
	private runtime: FridayRuntime;
	private summarizer?: ConversationSummarizer;
	private curator?: SmartsCurator;
	private sessionId: string | null = null;
	private sessionStartedAt: Date | null = null;
	private _saving = false;
	private _savePromise: Promise<void> | null = null;

	constructor(config: SessionHubConfig) {
		this.runtime = config.runtime;
		this.summarizer = config.summarizer;
		this.curator = config.curator;
	}

	get clientCount(): number {
		return this.registry.count;
	}

	getClientById(id: string): RegisteredClient | undefined {
		return this.registry.getById(id);
	}

	registerClient(client: RegisteredClient): void {
		const wasEmpty = this.registry.count === 0;
		this.registry.register(client);

		if (wasEmpty && !this._saving) {
			this.startSession();
		}

		this.hydrateClient(client);
	}

	async unregisterClient(id: string): Promise<void> {
		this.registry.unregister(id);
		if (this.registry.count === 0 && this.sessionId && !this._saving) {
			await this.endSession();
		}
	}

	broadcast(msg: ServerMessage, excludeId?: string): void {
		this.registry.broadcast(
			msg,
			excludeId ? (c) => c.id !== excludeId : undefined,
		);
	}

	/** Save active session without clearing. Used before runtime.shutdown() on SIGINT. */
	async saveIfActive(): Promise<void> {
		// Wait for any in-flight save triggered by client disconnect before proceeding
		await this.drain();
		if (!this.sessionId) return;
		await this.saveConversation();
	}

	/** Wait for any in-flight endSession saves to complete. */
	async drain(): Promise<void> {
		if (this._savePromise) {
			await this._savePromise;
		}
	}

	private startSession(): void {
		this.sessionId = crypto.randomUUID();
		this.sessionStartedAt = new Date();
		// Ensure Cortex starts clean — prevents stale history from a previous
		// session leaking into the new one (e.g. if clearHistory wasn't called
		// due to a crash or SIGINT during endSession).
		this.runtime.cortex.clearHistory();
	}

	private async endSession(): Promise<void> {
		this._saving = true;
		try {
			this._savePromise = this.saveConversation();
			await this._savePromise;
			// Only clear if no clients reconnected during save
			if (this.registry.count === 0) {
				this.runtime.cortex.clearHistory();
				this.sessionId = null;
				this.sessionStartedAt = null;
			}
		} finally {
			this._savePromise = null;
			this._saving = false;
		}
	}

	private async saveConversation(): Promise<void> {
		const memory = this.runtime.memory;
		if (!memory || !this.sessionId || !this.sessionStartedAt) return;

		const history = this.runtime.cortex.getHistory();
		if (history.length === 0) return;

		// Curator extraction is independent of summarization — start it early
		// and await at the end so both LLM calls overlap.
		const curatorPromise = this.curator
			? this.curator.extractFromConversation(history).catch(() => {})
			: undefined;

		let summary: string | undefined;
		if (this.summarizer) {
			try {
				summary = await this.summarizer.summarize(history);
			} catch {
				// Summary generation failed — save without summary
			}
		}

		await memory.saveConversation({
			id: this.sessionId,
			startedAt: this.sessionStartedAt,
			endedAt: new Date(),
			provider: "grok",
			model: this.runtime.cortex.modelName,
			messages: history,
			summary,
		});

		// Index for FTS5 search (Deja Vu recall)
		if (summary) {
			await memory.indexConversation({
				id: this.sessionId,
				startedAt: this.sessionStartedAt,
				endedAt: new Date(),
				provider: "grok",
				model: this.runtime.cortex.modelName,
				messages: history,
				summary,
			});
		}

		await curatorPromise;
	}

	private hydrateClient(client: RegisteredClient): void {
		const history = this.runtime.cortex.getHistory();
		for (const msg of history) {
			client.send({
				type: "conversation:message",
				role: msg.role,
				content:
					typeof msg.content === "string"
						? msg.content
						: String(msg.content),
				source: "replay",
			});
		}
	}
}
