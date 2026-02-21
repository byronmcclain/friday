import type { LLMProvider } from "../../src/providers/types.ts";
import { PROVIDER_DEFAULTS } from "../../src/providers/index.ts";

export const stubProvider: LLMProvider = {
	name: "stub",
	defaultModel: "stub-model",
	chat: async () => "stub response",
};

export const grokStub: LLMProvider = {
	name: "grok",
	defaultModel: PROVIDER_DEFAULTS.grok,
	chat: async () => "grok response",
};
