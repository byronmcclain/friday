import { rgbToHex } from "./color-utils.ts";

export interface ColorSpan {
	text: string;
	fg?: string;
	bg?: string;
}

export type ParsedLine = ColorSpan[];

function parseSgrParams(
	params: number[],
	state: { fg?: string; bg?: string },
): void {
	let i = 0;
	while (i < params.length) {
		const p = params[i]!;
		if (p === 0) {
			state.fg = undefined;
			state.bg = undefined;
			i++;
		} else if (p === 38) {
			if (params[i + 1] === 2) {
				state.fg = rgbToHex(
					params[i + 2] ?? 0,
					params[i + 3] ?? 0,
					params[i + 4] ?? 0,
				);
				i += 5;
			} else if (params[i + 1] === 5) {
				state.fg = ansi256ToHex(params[i + 2] ?? 0);
				i += 3;
			} else {
				i++;
			}
		} else if (p === 48) {
			if (params[i + 1] === 2) {
				state.bg = rgbToHex(
					params[i + 2] ?? 0,
					params[i + 3] ?? 0,
					params[i + 4] ?? 0,
				);
				i += 5;
			} else if (params[i + 1] === 5) {
				state.bg = ansi256ToHex(params[i + 2] ?? 0);
				i += 3;
			} else {
				i++;
			}
		} else {
			i++;
		}
	}
}

function ansi256ToHex(n: number): string {
	if (n < 16) {
		const standard = [
			"#000000",
			"#800000",
			"#008000",
			"#808000",
			"#000080",
			"#800080",
			"#008080",
			"#c0c0c0",
			"#808080",
			"#ff0000",
			"#00ff00",
			"#ffff00",
			"#0000ff",
			"#ff00ff",
			"#00ffff",
			"#ffffff",
		];
		return standard[n] ?? "#000000";
	}
	if (n < 232) {
		const idx = n - 16;
		const b = (idx % 6) * 51;
		const g = (Math.floor(idx / 6) % 6) * 51;
		const r = Math.floor(idx / 36) * 51;
		return rgbToHex(r, g, b);
	}
	const gray = (n - 232) * 10 + 8;
	return rgbToHex(gray, gray, gray);
}

export function parseAnsiLine(line: string): ParsedLine {
	const spans: ColorSpan[] = [];
	const state = {
		fg: undefined as string | undefined,
		bg: undefined as string | undefined,
	};

	// biome-ignore lint/suspicious/noControlCharactersInRegex: parsing ANSI escape codes
	const regex = /\x1b\[([0-9;]*)m|\x1b\[\??[0-9;]*[A-Za-z]|([^\x1b]+)/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(line)) !== null) {
		if (match[1] !== undefined) {
			const params = match[1].split(";").map(Number);
			parseSgrParams(params, state);
		} else if (match[2]) {
			const text = match[2];
			const lastSpan = spans[spans.length - 1];
			if (
				lastSpan &&
				lastSpan.fg === state.fg &&
				lastSpan.bg === state.bg
			) {
				lastSpan.text += text;
			} else {
				const span: ColorSpan = { text };
				if (state.fg) span.fg = state.fg;
				if (state.bg) span.bg = state.bg;
				spans.push(span);
			}
		}
	}

	if (spans.length === 0 && line.length > 0) {
		// Only push if line has visible text (not just escape sequences)
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
		const visible = line.replace(/\x1b\[\??[0-9;]*[A-Za-z]/g, "");
		if (visible.length > 0) {
			spans.push({ text: visible });
		}
	}

	return spans;
}

export function parseAnsiOutput(lines: string[]): ParsedLine[] {
	return lines.map(parseAnsiLine);
}
