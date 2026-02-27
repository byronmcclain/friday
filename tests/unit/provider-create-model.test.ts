import { describe, test, expect } from "bun:test";
import { createModel, PROVIDER_DEFAULTS } from "../../src/providers/index.ts";

describe("createModel", () => {
	test("creates xai model for grok provider", () => {
		const model = createModel("grok", PROVIDER_DEFAULTS.grok.model);
		expect(model.modelId).toContain("grok");
		expect(model.provider).toContain("xai");
	});

	test("creates anthropic model for anthropic provider", () => {
		const model = createModel("anthropic", PROVIDER_DEFAULTS.anthropic.model);
		expect(model.modelId).toContain("claude");
		expect(model.provider).toContain("anthropic");
	});

	test("throws for unknown provider", () => {
		expect(() => createModel("unknown" as any, "some-model")).toThrow(
			"Unknown provider",
		);
	});
});
