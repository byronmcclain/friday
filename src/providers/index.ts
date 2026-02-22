import type { ProviderName } from "../core/types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GrokProvider } from "./grok.ts";
import type { LLMProvider } from "./types.ts";

export type { LLMProvider, ChatOptions, ChatResponse, ToolCallRequest, ToolDefinition } from "./types.ts";
export { toJsonSchema } from "./tool-schema.ts";

export const DEFAULT_PROVIDER: ProviderName = "grok";

export const PROVIDER_DEFAULTS: Record<ProviderName, { model: string; fastModel: string }> = {
  anthropic: { model: "claude-sonnet-4-20250514", fastModel: "claude-haiku-4-5-20251001" },
  grok: { model: "grok-4-1-fast-reasoning-latest", fastModel: "grok-4-1-fast-non-reasoning" },
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
