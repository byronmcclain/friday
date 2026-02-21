import type { ProviderName } from "../core/types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GrokProvider } from "./grok.ts";
import type { LLMProvider } from "./types.ts";

export type { LLMProvider, ChatOptions } from "./types.ts";

export const DEFAULT_PROVIDER: ProviderName = "anthropic";

export const PROVIDER_DEFAULTS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-20250514",
  grok: "grok-3",
};

export function createProvider(name: ProviderName): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "grok":
      return new GrokProvider();
  }
}
