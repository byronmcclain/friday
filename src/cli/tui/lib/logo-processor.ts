import { parseAnsiOutput, type ParsedLine } from "./ansi-parser.ts";

export interface LogoData {
	parsedLines: ParsedLine[];
	width: number;
	height: number;
}

/**
 * Check if chafa is installed.
 */
export function checkChafa(): boolean {
	return Bun.which("chafa") !== null;
}

function stripAnsi(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
	return str.replace(/\x1b\[\??[0-9;]*[A-Za-z]/g, "");
}

/**
 * Strip DEC private mode sequences (cursor hide/show, etc.) that chafa
 * wraps around its output. These are irrelevant when parsing for OpenTUI
 * rendering and would leak through the ANSI parser as text if they appear
 * on their own line (e.g. \x1b[?25h on the final line).
 */
function stripDecPrivateMode(str: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
	return str.replace(/\x1b\[\?[0-9;]*[A-Za-z]/g, "");
}

/**
 * Process an image into parsed terminal art using chafa.
 * Returns null if chafa fails (missing image, chafa error, etc).
 */
export async function processLogo(
	imagePath: string,
	width: number,
	height: number,
): Promise<LogoData | null> {
	try {
		const args = [
			"--format=symbols",
			`--size=${width}x${height}`,
			"--symbols",
			"half+block",
			"--colors=full",
			"--color-space=din99d",
			"--work=9",
			imagePath,
		];

		const proc = Bun.spawn(["chafa", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});

		const output = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) return null;

		// Strip DEC private mode sequences (cursor hide/show) that chafa
		// wraps around its output before splitting into lines.
		const cleaned = stripDecPrivateMode(output);

		const lines = cleaned.split("\n");
		while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
			lines.pop();
		}

		if (lines.length === 0) return null;

		const parsedLines = parseAnsiOutput(lines);
		const maxWidth = lines.reduce(
			(max, line) => Math.max(max, stripAnsi(line).length),
			0,
		);

		return { parsedLines, width: maxWidth, height: lines.length };
	} catch {
		return null;
	}
}
