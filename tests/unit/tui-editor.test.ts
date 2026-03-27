import { describe, test, expect, afterEach } from "bun:test";
import { openExternalEditor } from "../../src/cli/tui/lib/external-editor.ts";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";

// Collect temp files for cleanup
const tempFiles: string[] = [];

afterEach(async () => {
	for (const f of tempFiles) {
		try { await unlink(f); } catch {}
	}
	tempFiles.length = 0;
});

describe("openExternalEditor", () => {
	test("writes initial content to temp file and reads it back", async () => {
		const result = await openExternalEditor("hello world", { editorCommand: "true" });
		expect(result).toBe("hello world");
	});

	test("returns edited content after editor modifies the file", async () => {
		const result = await openExternalEditor("line one", {
			editorCommand: "sed",
			editorArgs: (path) => ["-i", "", "$a\\nline two", path],
		});
		expect(result).toBe("line one\nline two");
	});

	test("returns null when editor exits with non-zero code", async () => {
		const result = await openExternalEditor("content", { editorCommand: "false" });
		expect(result).toBeNull();
	});

	test("returns null when file is empty after edit", async () => {
		const result = await openExternalEditor("some content", {
			editorCommand: "sh",
			editorArgs: (path) => ["-c", `> "${path}"`],
		});
		expect(result).toBeNull();
	});

	test("handles empty initial content", async () => {
		const result = await openExternalEditor("", { editorCommand: "true" });
		expect(result).toBeNull();
	});

	test("preserves multi-line content with tabs", async () => {
		const content = "line one\n\ttabbed line\nline three";
		const result = await openExternalEditor(content, { editorCommand: "true" });
		expect(result).toBe(content);
	});

	test("cleans up temp file after completion", async () => {
		let capturedPath = "";
		const result = await openExternalEditor("test", {
			editorCommand: "true",
			onTempPath: (p) => { capturedPath = p; },
		});
		expect(capturedPath).toMatch(/^\/tmp\/friday-editor-/);
		expect(existsSync(capturedPath)).toBe(false);
	});

	test("cleans up temp file even on editor failure", async () => {
		let capturedPath = "";
		await openExternalEditor("test", {
			editorCommand: "false",
			onTempPath: (p) => { capturedPath = p; },
		});
		expect(capturedPath.length).toBeGreaterThan(0);
		expect(existsSync(capturedPath)).toBe(false);
	});
});
