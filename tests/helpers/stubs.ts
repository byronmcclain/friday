import type { LLMProvider, ChatResponse } from "../../src/providers/types.ts";
import { PROVIDER_DEFAULTS } from "../../src/providers/index.ts";

/** Helper to create a text ChatResponse */
export function textResponse(text: string): ChatResponse {
	return { type: "text", text };
}

export const stubProvider: LLMProvider = {
	name: "stub",
	defaultModel: "stub-model",
	defaultFastModel: "stub-fast-model",
	chat: async () => textResponse("stub response"),
};

export const grokStub: LLMProvider = {
	name: "grok",
	defaultModel: PROVIDER_DEFAULTS.grok.model,
	defaultFastModel: PROVIDER_DEFAULTS.grok.fastModel,
	chat: async () => textResponse("grok response"),
};
