import { unlink } from "node:fs/promises";

export interface EditorOptions {
	/** Override the editor binary (default: "vim", fallback "vi") */
	editorCommand?: string;
	/** Override args — receives temp file path, returns args array */
	editorArgs?: (path: string) => string[];
	/** Callback that receives the temp file path (for testing cleanup) */
	onTempPath?: (path: string) => void;
}

/**
 * Opens an external editor with the given content.
 * Returns the edited content on success, null on cancellation/error.
 */
export async function openExternalEditor(
	initialContent: string,
	options?: EditorOptions,
): Promise<string | null> {
	const suffix = crypto.randomUUID().slice(0, 8);
	const tempPath = `/tmp/friday-editor-${suffix}.txt`;

	try {
		await Bun.write(tempPath, initialContent);
		options?.onTempPath?.(tempPath);

		const command = options?.editorCommand ?? (await resolveEditor());
		const args = options?.editorArgs ? options.editorArgs(tempPath) : [tempPath];

		const proc = Bun.spawn([command, ...args], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			return null;
		}

		const file = Bun.file(tempPath);
		const content = await file.text();

		if (content.length === 0) {
			return null;
		}

		return content;
	} finally {
		try {
			await unlink(tempPath);
		} catch {
			// File may not exist if write failed
		}
	}
}

/** Resolve vim → vi fallback chain */
async function resolveEditor(): Promise<string> {
	try {
		const which = Bun.spawn(["which", "vim"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await which.exited;
		if (code === 0) return "vim";
	} catch {
		// vim not found
	}

	return "vi";
}
