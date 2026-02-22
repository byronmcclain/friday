import type { FridayConfig, ConversationMessage, ContentBlock } from "./types.ts";
import { SYSTEM_PROMPT } from "./prompts.ts";
import {
  createProvider,
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULTS,
  type LLMProvider,
} from "../providers/index.ts";
import type { ToolDefinition } from "../providers/types.ts";
import type { FridayTool } from "../modules/types.ts";
import type { ClearanceManager } from "./clearance.ts";
import type { SmartsStore } from "../smarts/store.ts";
import type { Sensorium } from "../sensorium/sensorium.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { SignalBus, SignalEmitter } from "./events.ts";
import type { ScopedMemory } from "./memory.ts";

export interface CortexConfig extends Partial<FridayConfig> {
  injectedProvider?: LLMProvider;
  clearance?: ClearanceManager;
  maxToolIterations?: number;
  smartsStore?: SmartsStore;
  sensorium?: Sensorium;
  audit?: AuditLogger;
  signals?: SignalBus;
  toolMemory?: ScopedMemory;
}

export class Cortex {
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;
  private conversationHistory: ConversationMessage[];
  private tools: Map<string, FridayTool>;
  private clearance?: ClearanceManager;
  private maxToolIterations: number;
  private smartsStore?: SmartsStore;
  private sensorium?: Sensorium;
  private audit?: AuditLogger;
  private signals?: SignalBus;
  private toolMemory?: ScopedMemory;
  private pinnedSmarts = new Set<string>();

  constructor(config: CortexConfig = {}) {
    const providerName = config.provider ?? DEFAULT_PROVIDER;
    this.provider = config.injectedProvider ?? createProvider(providerName);
    this.model = config.model ?? PROVIDER_DEFAULTS[providerName];
    this.maxTokens = config.maxTokens ?? 4096;
    this.conversationHistory = [];
    this.tools = new Map();
    this.clearance = config.clearance;
    this.maxToolIterations = config.maxToolIterations ?? 10;
    this.smartsStore = config.smartsStore;
    this.sensorium = config.sensorium;
    this.audit = config.audit;
    this.signals = config.signals;
    this.toolMemory = config.toolMemory;
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
    const startLength = this.conversationHistory.length;
    this.conversationHistory.push({ role: "user", content: userMessage });

    try {
      const systemPrompt = await this.buildSystemPrompt(userMessage);
      const toolDefs = this.toToolDefinitions();
      const options = {
        model: this.model,
        maxTokens: this.maxTokens,
        ...(toolDefs.length > 0 ? { tools: toolDefs } : {}),
      };

      for (let i = 0; i < this.maxToolIterations; i++) {
        const response = await this.provider.chat(
          systemPrompt,
          this.conversationHistory,
          options,
        );

        if (response.type === "text") {
          this.conversationHistory.push({
            role: "assistant",
            content: response.text,
          });
          return response.text;
        }

        // tool_use response — record assistant's tool calls
        const assistantBlocks: ContentBlock[] = response.toolCalls.map(
          (tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
          }),
        );
        this.conversationHistory.push({
          role: "assistant",
          content: assistantBlocks,
        });

        // Execute all tool calls in parallel
        const results = await Promise.all(
          response.toolCalls.map((tc) => this.executeToolCall(tc)),
        );

        // Record results as user message with tool_result blocks
        const resultBlocks: ContentBlock[] = results.map((r) => ({
          type: "tool_result" as const,
          toolCallId: r.toolCallId,
          content: r.output,
          isError: r.isError,
        }));
        this.conversationHistory.push({
          role: "user",
          content: resultBlocks,
        });
      }

      throw new Error(
        `Max tool iterations (${this.maxToolIterations}) exceeded`,
      );
    } catch (err) {
      // Roll back all messages added during this call
      this.conversationHistory.length = startLength;
      throw err;
    }
  }

  private toToolDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  private async executeToolCall(call: {
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

    if (this.clearance && tool.clearance.length > 0) {
      const check = this.clearance.checkAll(tool.clearance);
      if (!check.granted) {
        return {
          toolCallId: call.id,
          output:
            check.reason ?? `Clearance denied for tool: ${call.name}`,
          isError: true,
        };
      }
    }

    try {
      const result = await tool.execute(call.input, {
        workingDirectory: process.cwd(),
        audit: this.audit ?? ({ log: () => {} } as unknown as AuditLogger),
        signal: this.signals ?? ({ emit: async () => {} } as SignalEmitter),
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
    let prompt = SYSTEM_PROMPT;

    // SMARTS knowledge enrichment
    if (this.smartsStore) {
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

      if (sections.length > 0) {
        prompt = `${prompt}\n\n## Active Knowledge\n\nThe following domain knowledge is available for this conversation.\nUse it to inform your responses when relevant.\n\n${sections.join("\n\n")}`;
      }
    }

    // Sensorium environment context
    if (this.sensorium) {
      const envBlock = this.sensorium.getContextBlock();
      if (envBlock) {
        prompt = `${prompt}\n\n## Environment\n\n${envBlock}`;
      }
    }

    return prompt;
  }
}

export { Cortex as FridayCore };
