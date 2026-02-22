import type { LLMProvider, ChatResponse } from "../../src/providers/types.ts";
import { PROVIDER_DEFAULTS } from "../../src/providers/index.ts";

/** Helper to create a text ChatResponse */
export function textResponse(text: string): ChatResponse {
	return { type: "text", text };
}

export const stubProvider: LLMProvider = {
	name: "stub",
	defaultModel: "stub-model",
	chat: async () => textResponse("stub response"),
};

export const grokStub: LLMProvider = {
	name: "grok",
	defaultModel: PROVIDER_DEFAULTS.grok,
	chat: async () => textResponse("grok response"),
};
