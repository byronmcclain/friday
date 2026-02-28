import { describe, expect, test } from "bun:test";
import { assertSafeArg, assertAllowedProtocol, assertInteger, assertNotPrivateIP } from "../../src/modules/validation.ts";

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

	test("rejects values with leading whitespace before dash", () => {
		const result = assertSafeArg(" -rf", "flag");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});

	test("rejects whitespace-only values", () => {
		const result = assertSafeArg("   ", "label");
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

describe("assertNotPrivateIP", () => {
	test("allows public URLs", () => {
		expect(assertNotPrivateIP("https://example.com")).toBeNull();
		expect(assertNotPrivateIP("https://8.8.8.8")).toBeNull();
		expect(assertNotPrivateIP("https://1.1.1.1")).toBeNull();
	});

	test("blocks 127.x.x.x loopback", () => {
		const result = assertNotPrivateIP("http://127.0.0.1");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
		expect(result!.output).toContain("private");
	});

	test("blocks 10.x.x.x private range", () => {
		const result = assertNotPrivateIP("http://10.0.0.1");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});

	test("blocks 172.16-31.x.x private range", () => {
		expect(assertNotPrivateIP("http://172.16.0.1")).not.toBeNull();
		expect(assertNotPrivateIP("http://172.31.255.255")).not.toBeNull();
		// 172.15 and 172.32 should be allowed
		expect(assertNotPrivateIP("http://172.15.0.1")).toBeNull();
		expect(assertNotPrivateIP("http://172.32.0.1")).toBeNull();
	});

	test("blocks 192.168.x.x private range", () => {
		const result = assertNotPrivateIP("http://192.168.1.1");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});

	test("blocks 169.254.x.x link-local", () => {
		const result = assertNotPrivateIP("http://169.254.169.254");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});

	test("blocks 0.x.x.x reserved range", () => {
		const result = assertNotPrivateIP("http://0.0.0.0");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});

	test("blocks IPv6 loopback", () => {
		const result = assertNotPrivateIP("http://[::1]");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
		expect(result!.output).toContain("loopback");
	});

	test("blocks localhost hostname", () => {
		const result = assertNotPrivateIP("http://localhost");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
		expect(result!.output).toContain("localhost");
	});

	test("blocks .local domains", () => {
		const result = assertNotPrivateIP("http://myhost.local");
		expect(result).not.toBeNull();
		expect(result!.success).toBe(false);
	});

	test("rejects invalid URLs", () => {
		const result = assertNotPrivateIP("not-a-url");
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

	test("rejects floating point", () => {
		const result = assertInteger(2.7, "index");
		expect("success" in result).toBe(true);
		if ("success" in result) expect(result.success).toBe(false);
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
