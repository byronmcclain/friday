import { describe, test, expect } from "bun:test";
import { createProvider, DEFAULT_PROVIDER, PROVIDER_DEFAULTS } from "../../src/providers/index.ts";
import { AnthropicProvider } from "../../src/providers/anthropic.ts";

describe("Provider Abstraction", () => {
  test("DEFAULT_PROVIDER is grok", () => {
    expect(DEFAULT_PROVIDER).toBe("grok");
  });

  test("PROVIDER_DEFAULTS has entries for all providers", () => {
    expect(PROVIDER_DEFAULTS.anthropic).toBeDefined();
    expect(PROVIDER_DEFAULTS.grok).toBeDefined();
  });

  test("createProvider('anthropic') returns an AnthropicProvider", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
    try {
      const provider = createProvider("anthropic");
      expect(provider).toBeInstanceOf(AnthropicProvider);
      expect(provider.name).toBe("anthropic");
      expect(provider.defaultModel).toBe(PROVIDER_DEFAULTS.anthropic);
    } finally {
      if (origKey === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = origKey;
      }
    }
  });

  test("createProvider throws on unknown provider name", () => {
    expect(() => createProvider("invalid" as any)).toThrow("Unknown provider");
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
