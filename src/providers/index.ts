import type { ProviderName } from "../core/types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GrokProvider } from "./grok.ts";
import type { LLMProvider } from "./types.ts";

export type { LLMProvider, ChatOptions, ChatResponse, ToolCallRequest, ToolDefinition } from "./types.ts";
export { toJsonSchema } from "./tool-schema.ts";

export const DEFAULT_PROVIDER: ProviderName = "grok";

export const PROVIDER_DEFAULTS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-20250514",
  grok: "grok-4-1-fast-reasoning-latest",
};

export function createProvider(name: ProviderName): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "grok":
      return new GrokProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
