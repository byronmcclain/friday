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

		if (wasEmpty) {
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
		if (!this.sessionId) return;
		await this.saveConversation();
	}

	private startSession(): void {
		this.sessionId = crypto.randomUUID();
		this.sessionStartedAt = new Date();
	}

	private async endSession(): Promise<void> {
		this._saving = true;
		try {
			await this.saveConversation();
			// Only clear if no clients reconnected during save
			if (this.registry.count === 0) {
				this.runtime.cortex.clearHistory();
				this.sessionId = null;
				this.sessionStartedAt = null;
			}
		} finally {
			this._saving = false;
		}
	}

	private async saveConversation(): Promise<void> {
		const memory = this.runtime.memory;
		if (!memory || !this.sessionId || !this.sessionStartedAt) return;

		const history = this.runtime.cortex.getHistory();
		if (history.length === 0) return;

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
			provider: this.runtime.cortex.providerName,
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
				provider: this.runtime.cortex.providerName,
				model: this.runtime.cortex.modelName,
				messages: history,
				summary,
			});
		}

		// Extract knowledge via SmartsCurator
		if (this.curator) {
			try {
				await this.curator.extractFromConversation(history);
			} catch {
				// Knowledge extraction failed — non-fatal
			}
		}
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
