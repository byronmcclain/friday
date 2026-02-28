/** Configuration for Cortex */
export interface FridayConfig {
  /** Model identifier (e.g., "grok-4-1-fast-reasoning-latest") */
  model: string;
  /** Fast model for utility tasks (summarization, knowledge extraction) */
  fastModel?: string;
  /** Maximum tokens for responses */
  maxTokens: number;
}

/** A plain text content block */
export interface TextBlock {
  type: "text";
  text: string;
}

/** A tool invocation content block (assistant requests tool execution) */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A tool result content block (user returns tool output) */
export interface ToolResultBlock {
  type: "tool_result";
  toolCallId: string;
  content: string;
  isError: boolean;
}

/** Union of all content block types */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** Message content: plain string (backwards compatible) or structured blocks */
export type MessageContent = string | ContentBlock[];

/** A single message in the conversation history */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: MessageContent;
}

/** Extract plain text from message content, joining all TextBlocks */
export function getTextContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
