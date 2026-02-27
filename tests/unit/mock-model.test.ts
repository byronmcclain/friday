import { describe, test, expect } from "bun:test";
import { createMockModel } from "../helpers/stubs.ts";
import { generateText, streamText } from "ai";

describe("createMockModel", () => {
	test("generates default text response", async () => {
		const model = createMockModel();
		const result = await generateText({
			model,
			prompt: "Hello",
		});
		expect(result.text).toBe("stub response");
	});

	test("generates custom text response", async () => {
		const model = createMockModel({ text: "custom reply" });
		const result = await generateText({
			model,
			prompt: "Hello",
		});
		expect(result.text).toBe("custom reply");
	});

	test("reports token usage", async () => {
		const model = createMockModel({
			usage: { inputTokens: 50, outputTokens: 100 },
		});
		const result = await generateText({
			model,
			prompt: "Hello",
		});
		expect(result.usage.inputTokens).toBe(50);
		expect(result.usage.outputTokens).toBe(100);
	});

	test("streams text response", async () => {
		const model = createMockModel({ text: "streamed" });
		const result = streamText({
			model,
			prompt: "Hello",
		});
		let text = "";
		for await (const chunk of result.textStream) {
			text += chunk;
		}
		expect(text).toBe("streamed");
	});
});
