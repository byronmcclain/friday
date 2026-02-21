import { describe, test, expect } from "bun:test";
import { createProvider, DEFAULT_PROVIDER, PROVIDER_DEFAULTS } from "../../src/providers/index.ts";
import { AnthropicProvider } from "../../src/providers/anthropic.ts";

describe("Provider Abstraction", () => {
  test("DEFAULT_PROVIDER is anthropic", () => {
    expect(DEFAULT_PROVIDER).toBe("anthropic");
  });

  test("PROVIDER_DEFAULTS has entries for all providers", () => {
    expect(PROVIDER_DEFAULTS.anthropic).toBe("claude-sonnet-4-20250514");
    expect(PROVIDER_DEFAULTS.grok).toBe("grok-3");
  });

  test("createProvider('anthropic') returns an AnthropicProvider", () => {
    const provider = createProvider("anthropic");
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider.name).toBe("anthropic");
    expect(provider.defaultModel).toBe("claude-sonnet-4-20250514");
  });

  test("createProvider('grok') throws without XAI_API_KEY", () => {
    const original = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      expect(() => createProvider("grok")).toThrow("XAI_API_KEY is not set");
    } finally {
      if (original) process.env.XAI_API_KEY = original;
    }
  });
});
