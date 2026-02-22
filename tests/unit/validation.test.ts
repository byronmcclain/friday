import { describe, expect, test } from "bun:test";
import { assertSafeArg, assertAllowedProtocol, assertInteger } from "../../src/modules/validation.ts";

describe("assertSafeArg", () => {
	test("returns null for safe values", () => {
		expect(assertSafeArg("main", "ref")).toBeNull();
		expect(assertSafeArg("feature/foo", "ref")).toBeNull();
		expect(assertSafeArg("HEAD~3", "ref")).toBeNull();
	});

	test("rejects values starting with dash", () => {
		const result = assertSafeArg("--upload-pack=evil", "ref");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
		expect(result!.output).toContain("ref");
	});

	test("rejects empty string", () => {
		const result = assertSafeArg("", "name");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});
});

describe("assertAllowedProtocol", () => {
	test("allows http URLs", () => {
		expect(assertAllowedProtocol("http://example.com")).toBeNull();
	});

	test("allows https URLs", () => {
		expect(assertAllowedProtocol("https://example.com/path")).toBeNull();
	});

	test("rejects file: protocol", () => {
		const result = assertAllowedProtocol("file:///etc/passwd");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
		expect(result!.output).toContain("file:");
	});

	test("rejects data: protocol", () => {
		const result = assertAllowedProtocol("data:text/html,<h1>hi</h1>");
		expect(result).not.toBeNull();
		expect(result!.output).toContain("data:");
	});

	test("rejects ftp: protocol", () => {
		const result = assertAllowedProtocol("ftp://files.example.com");
		expect(result).not.toBeNull();
	});

	test("rejects invalid URLs", () => {
		const result = assertAllowedProtocol("not-a-url");
		expect(result).not.toBeNull();
		expect(result!.output).toContain("Invalid URL");
	});
});

describe("assertInteger", () => {
	test("accepts valid numbers", () => {
		const result = assertInteger(5, "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(5);
	});

	test("accepts zero", () => {
		const result = assertInteger(0, "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(0);
	});

	test("floors floating point", () => {
		const result = assertInteger(2.7, "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(2);
	});

	test("rejects negative numbers", () => {
		const result = assertInteger(-1, "index");
		expect("success" in result).toBe(true);
		if ("success" in result) expect(result.success).toBe(false);
	});

	test("rejects NaN", () => {
		const result = assertInteger(NaN, "index");
		expect("success" in result).toBe(true);
	});

	test("rejects strings", () => {
		const result = assertInteger("not-a-number", "index");
		expect("success" in result).toBe(true);
	});

	test("coerces numeric strings", () => {
		const result = assertInteger("3", "index");
		expect("value" in result).toBe(true);
		if ("value" in result) expect(result.value).toBe(3);
	});
});
