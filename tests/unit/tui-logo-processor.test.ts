import { describe, test, expect } from "bun:test";
import {
	processLogo,
	checkChafa,
} from "../../src/cli/tui/lib/logo-processor.ts";

describe("checkChafa", () => {
	test("returns true when chafa binary exists", () => {
		// chafa should be installed (required dependency)
		const result = checkChafa();
		expect(result).toBe(true);
	});
});

describe("processLogo", () => {
	test("returns LogoData with parsedLines and dimensions", async () => {
		// Uses actual chafa with the project logo
		const logoPath = new URL("../../friday-logo.jpeg", import.meta.url)
			.pathname;
		const data = await processLogo(logoPath, 20, 10);

		expect(data).not.toBeNull();
		expect(data!.parsedLines.length).toBeGreaterThan(0);
		// chafa may output slightly more lines than requested
		expect(data!.parsedLines.length).toBeLessThanOrEqual(12);
		expect(data!.width).toBeGreaterThan(0);
		expect(data!.height).toBeGreaterThan(0);

		// Each line should have at least one span
		for (const line of data!.parsedLines) {
			expect(line.length).toBeGreaterThan(0);
		}
	});

	test("returns null when image file missing", async () => {
		const data = await processLogo("/nonexistent/image.jpg", 20, 10);
		expect(data).toBeNull();
	});
});
