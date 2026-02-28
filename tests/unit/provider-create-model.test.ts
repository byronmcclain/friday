import { describe, test, expect } from "bun:test";
import { createModel, GROK_DEFAULTS } from "../../src/providers/index.ts";

describe("createModel", () => {
	test("creates xai model for the given model ID", () => {
		const model = createModel(GROK_DEFAULTS.model);
		expect(model.modelId).toContain("grok");
		expect(model.provider).toContain("xai");
	});

	test("GROK_DEFAULTS has reasoning and fast model", () => {
		expect(GROK_DEFAULTS.model).toBe("grok-4-1-fast-reasoning-latest");
		expect(GROK_DEFAULTS.fastModel).toBe("grok-4-1-fast-non-reasoning");
	});
});
