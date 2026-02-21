import type { FridayConfig, ConversationMessage } from "./types.ts";
import { SYSTEM_PROMPT } from "./prompts.ts";
import {
  createProvider,
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULTS,
  type LLMProvider,
} from "../providers/index.ts";
import type { FridayTool } from "../modules/types.ts";

export class Cortex {
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;
  private conversationHistory: ConversationMessage[];
  private tools: Map<string, FridayTool>;

  constructor(config: Partial<FridayConfig> = {}) {
    const providerName = config.provider ?? DEFAULT_PROVIDER;
    this.provider = createProvider(providerName);
    this.model = config.model ?? PROVIDER_DEFAULTS[providerName];
    this.maxTokens = config.maxTokens ?? 4096;
    this.conversationHistory = [];
    this.tools = new Map();
  }

  get providerName(): string {
    return this.provider.name;
  }

  get modelName(): string {
    return this.model;
  }

  get availableTools(): FridayTool[] {
    return [...this.tools.values()];
  }

  registerTool(tool: FridayTool): void {
    this.tools.set(tool.name, tool);
  }

  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: "user", content: userMessage });

    const assistantMessage = await this.provider.chat(
      SYSTEM_PROMPT,
      this.conversationHistory,
      { model: this.model, maxTokens: this.maxTokens },
    );

    this.conversationHistory.push({ role: "assistant", content: assistantMessage });
    return assistantMessage;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  get historyLength(): number {
    return this.conversationHistory.length;
  }
}

export { Cortex as FridayCore };
