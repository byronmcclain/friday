export interface RGB {
	r: number;
	g: number;
	b: number;
}

export function parseHex(hex: string): RGB {
	const h = hex.startsWith("#") ? hex.slice(1) : hex;
	return {
		r: Number.parseInt(h.slice(0, 2), 16),
		g: Number.parseInt(h.slice(2, 4), 16),
		b: Number.parseInt(h.slice(4, 6), 16),
	};
}

function toHex(n: number): string {
	return Math.round(Math.max(0, Math.min(255, n)))
		.toString(16)
		.padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Linearly interpolate between two hex colors.
 * t=0 returns `from`, t=1 returns `to`.
 */
export function lerpColor(from: string, to: string, t: number): string {
	const clamped = Math.max(0, Math.min(1, t));
	const a = parseHex(from);
	const b = parseHex(to);
	return rgbToHex(
		a.r + (b.r - a.r) * clamped,
		a.g + (b.g - a.g) * clamped,
		a.b + (b.b - a.b) * clamped,
	);
}
