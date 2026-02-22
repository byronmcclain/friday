import { describe, test, expect } from "bun:test";
import { program } from "../../src/cli/index.ts";

describe("serve command", () => {
	test("is registered on the program", () => {
		const cmd = program.commands.find((c) => c.name() === "serve");
		expect(cmd).toBeDefined();
		expect(cmd!.description()).toContain("web");
	});

	test("has --port option with default 3000", () => {
		const cmd = program.commands.find((c) => c.name() === "serve");
		const portOpt = cmd!.options.find((o) => o.long === "--port");
		expect(portOpt).toBeDefined();
		expect(portOpt!.defaultValue).toBe("3000");
	});
});
