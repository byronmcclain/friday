/** Supported LLM provider names */
export type ProviderName = "anthropic" | "grok";

/** Configuration for FridayCore */
export interface FridayConfig {
  /** Which LLM provider to use */
  provider: ProviderName;
  /** Model identifier (provider-specific, e.g., "claude-sonnet-4-20250514" or "grok-3") */
  model: string;
  /** Maximum tokens for responses */
  maxTokens: number;
}

/** A single message in the conversation history */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/** Represents a tool that Friday can use */
export interface FridayTool {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** Represents a specialized agent that Friday can delegate to */
export interface FridayAgent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: FridayTool[];
}
