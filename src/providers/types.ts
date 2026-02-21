import type { ConversationMessage } from "../core/types.ts";

export interface ChatOptions {
  model: string;
  maxTokens: number;
}

/** Contract that every LLM provider must implement */
export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<string>;
}
