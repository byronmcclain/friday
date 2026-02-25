import { describe, expect, test } from "bun:test";
import {
	decodeMessageBody,
	stripHtml,
} from "../../src/modules/gmail/client.ts";

describe("GmailClient helpers", () => {
	test("decodeMessageBody decodes base64url text", () => {
		const encoded = Buffer.from("Hello, World!").toString("base64url");
		const result = decodeMessageBody([
			{ mimeType: "text/plain", body: { data: encoded, size: 13 } },
		]);
		expect(result).toBe("Hello, World!");
	});

	test("decodeMessageBody prefers text/plain over text/html", () => {
		const plain = Buffer.from("Plain text").toString("base64url");
		const html = Buffer.from("<p>HTML text</p>").toString("base64url");
		const result = decodeMessageBody([
			{ mimeType: "text/html", body: { data: html, size: 16 } },
			{ mimeType: "text/plain", body: { data: plain, size: 10 } },
		]);
		expect(result).toBe("Plain text");
	});

	test("decodeMessageBody falls back to stripped HTML", () => {
		const html = Buffer.from("<p>Hello</p><br><b>World</b>").toString(
			"base64url",
		);
		const result = decodeMessageBody([
			{ mimeType: "text/html", body: { data: html, size: 27 } },
		]);
		expect(result).toContain("Hello");
		expect(result).toContain("World");
		expect(result).not.toContain("<p>");
	});

	test("decodeMessageBody returns empty string for no parts", () => {
		expect(decodeMessageBody([])).toBe("");
	});

	test("stripHtml removes tags and decodes entities", () => {
		expect(stripHtml("<p>Hello &amp; World</p>")).toBe("Hello & World");
	});

	test("stripHtml converts <br> to newlines", () => {
		expect(stripHtml("Line 1<br>Line 2<br/>Line 3")).toBe(
			"Line 1\nLine 2\nLine 3",
		);
	});
});
