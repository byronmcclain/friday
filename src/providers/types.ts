import type { ConversationMessage } from "../core/types.ts";
import type { ToolParameter } from "../modules/types.ts";

export interface ChatOptions {
  model: string;
  maxTokens: number;
  tools?: ToolDefinition[];
}

/** Tool call requested by the LLM */
export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Single chat turn result — either final text or tool-call requests */
export type ChatResponse =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCalls: ToolCallRequest[] };

/** Provider-agnostic tool definition */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

/** Contract that every LLM provider must implement */
export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse>;
}
