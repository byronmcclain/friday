import type { FridayConfig, ConversationMessage } from "./types.ts";
import { SYSTEM_PROMPT } from "./prompts.ts";
import {
  createProvider,
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULTS,
  type LLMProvider,
} from "../providers/index.ts";

/**
 * FridayCore is the central orchestrator for the Friday AI assistant.
 * It manages conversation state, routes to providers, and coordinates tools/agents.
 */
export class FridayCore {
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;
  private conversationHistory: ConversationMessage[];

  constructor(config: Partial<FridayConfig> = {}) {
    const providerName = config.provider ?? DEFAULT_PROVIDER;
    this.provider = createProvider(providerName);
    this.model = config.model ?? PROVIDER_DEFAULTS[providerName];
    this.maxTokens = config.maxTokens ?? 4096;
    this.conversationHistory = [];
  }

  /** The active provider name (e.g., "anthropic", "grok") */
  get providerName(): string {
    return this.provider.name;
  }

  /** The active model identifier */
  get modelName(): string {
    return this.model;
  }

  /**
   * Send a message to Friday and get a response.
   * Maintains conversation history for context.
   */
  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    const assistantMessage = await this.provider.chat(
      SYSTEM_PROMPT,
      this.conversationHistory,
      { model: this.model, maxTokens: this.maxTokens },
    );

    this.conversationHistory.push({
      role: "assistant",
      content: assistantMessage,
    });

    return assistantMessage;
  }

  /** Clear conversation history to start fresh */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /** Get current conversation length */
  get historyLength(): number {
    return this.conversationHistory.length;
  }
}
