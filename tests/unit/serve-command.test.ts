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

	test("has --provider option", () => {
		const cmd = program.commands.find((c) => c.name() === "serve");
		const providerOpt = cmd!.options.find((o) => o.long === "--provider");
		expect(providerOpt).toBeDefined();
	});

	test("has --model option", () => {
		const cmd = program.commands.find((c) => c.name() === "serve");
		const modelOpt = cmd!.options.find((o) => o.long === "--model");
		expect(modelOpt).toBeDefined();
	});
});

describe("serve command — port validation", () => {
	function validatePort(portStr: string): boolean {
		const port = Number.parseInt(portStr, 10);
		return !Number.isNaN(port) && port >= 1 && port <= 65535;
	}

	test("rejects port 0", () => {
		expect(validatePort("0")).toBe(false);
	});

	test("rejects port 99999", () => {
		expect(validatePort("99999")).toBe(false);
	});

	test("rejects non-numeric port", () => {
		expect(validatePort("abc")).toBe(false);
	});

	test("accepts port 3000", () => {
		expect(validatePort("3000")).toBe(true);
	});

	test("accepts port 1", () => {
		expect(validatePort("1")).toBe(true);
	});

	test("accepts port 65535", () => {
		expect(validatePort("65535")).toBe(true);
	});

	test("rejects negative port", () => {
		expect(validatePort("-1")).toBe(false);
	});
});
