import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "../core/types.ts";
import type { ChatOptions, LLMProvider } from "./types.ts";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly defaultModel = "claude-sonnet-4-20250514";
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  async chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<string> {
    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      system: systemPrompt,
      messages,
    });

    return response.content[0]?.type === "text" ? response.content[0].text : "";
  }
}
