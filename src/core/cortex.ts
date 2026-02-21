import type { FridayConfig, ConversationMessage } from "./types.ts";
import { SYSTEM_PROMPT } from "./prompts.ts";
import {
  createProvider,
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULTS,
  type LLMProvider,
} from "../providers/index.ts";
import type { FridayTool } from "../modules/types.ts";
import type { SmartsStore } from "../smarts/store.ts";

export interface CortexConfig extends Partial<FridayConfig> {
  injectedProvider?: LLMProvider;
  smartsStore?: SmartsStore;
}

export class Cortex {
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;
  private conversationHistory: ConversationMessage[];
  private tools: Map<string, FridayTool>;
  private smartsStore?: SmartsStore;
  private pinnedSmarts = new Set<string>();

  constructor(config: CortexConfig = {}) {
    const providerName = config.provider ?? DEFAULT_PROVIDER;
    this.provider = config.injectedProvider ?? createProvider(providerName);
    this.model = config.model ?? PROVIDER_DEFAULTS[providerName];
    this.maxTokens = config.maxTokens ?? 4096;
    this.conversationHistory = [];
    this.tools = new Map();
    this.smartsStore = config.smartsStore;
  }

  get providerName(): string {
    return this.provider.name;
  }

  get llmProvider(): LLMProvider {
    return this.provider;
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

  pinSmart(name: string): void {
    this.pinnedSmarts.add(name);
  }

  unpinSmart(name: string): void {
    this.pinnedSmarts.delete(name);
  }

  async chat(userMessage: string): Promise<string> {
    this.conversationHistory.push({ role: "user", content: userMessage });

    let assistantMessage: string;
    try {
      const systemPrompt = await this.buildSystemPrompt(userMessage);
      assistantMessage = await this.provider.chat(
        systemPrompt,
        this.conversationHistory,
        { model: this.model, maxTokens: this.maxTokens },
      );
    } catch (err) {
      this.conversationHistory.pop();
      throw err;
    }

    this.conversationHistory.push({ role: "assistant", content: assistantMessage });
    return assistantMessage;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  setHistory(messages: ConversationMessage[]): void {
    this.conversationHistory = [...messages];
  }

  getHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  get historyLength(): number {
    return this.conversationHistory.length;
  }

  private async buildSystemPrompt(userMessage: string): Promise<string> {
    if (!this.smartsStore) return SYSTEM_PROMPT;

    const sections: string[] = [];

    for (const name of this.pinnedSmarts) {
      const entry = await this.smartsStore.getByName(name);
      if (entry) {
        const title = entry.content.split("\n")[0]?.replace(/^#+\s*/, "") || entry.name;
        sections.push(`### ${title} (confidence: ${entry.confidence})\n${entry.content}`);
      }
    }

    const relevant = await this.smartsStore.findRelevant(userMessage);
    for (const entry of relevant) {
      if (this.pinnedSmarts.has(entry.name)) continue;
      const title = entry.content.split("\n")[0]?.replace(/^#+\s*/, "") || entry.name;
      sections.push(`### ${title} (confidence: ${entry.confidence})\n${entry.content}`);
    }

    if (sections.length === 0) return SYSTEM_PROMPT;

    return `${SYSTEM_PROMPT}\n\n## Active Knowledge\n\nThe following domain knowledge is available for this conversation.\nUse it to inform your responses when relevant.\n\n${sections.join("\n\n")}`;
  }
}

export { Cortex as FridayCore };
