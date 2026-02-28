import { SyntaxStyle, RGBA, createTextAttributes } from "@opentui/core";

export const PALETTE = {
	background: "#0D1117",
	surface: "#161B22",
	surfaceLight: "#1C2333",
	amberPrimary: "#F0A030",
	amberGlow: "#FFD080",
	amberDim: "#8B6914",
	copperAccent: "#C07020",
	textPrimary: "#E6EDF3",
	textMuted: "#7D8590",
	borderDim: "#30363D",
	success: "#3FB950",
	error: "#F85149",
	warning: "#D29922",
	selectionBg: "#5C3D00",
	selectionFg: "#FFFFFF",
} as const;

// Shared text attribute constants — use these instead of creating per-component
export const BOLD = createTextAttributes({ bold: true });
export const DIM = createTextAttributes({ dim: true });
export const ITALIC = createTextAttributes({ italic: true });
export const BOLD_DIM = createTextAttributes({ bold: true, dim: true });

export const FRIDAY_SYNTAX_STYLE = SyntaxStyle.fromStyles({
	"markup.heading.1": { fg: RGBA.fromHex(PALETTE.amberPrimary), bold: true },
	"markup.heading.2": { fg: RGBA.fromHex(PALETTE.amberPrimary), bold: true },
	"markup.heading.3": { fg: RGBA.fromHex(PALETTE.amberGlow), bold: true },
	"markup.heading.4": { fg: RGBA.fromHex(PALETTE.amberGlow), bold: true },
	"markup.heading.5": { fg: RGBA.fromHex(PALETTE.amberGlow) },
	"markup.heading.6": { fg: RGBA.fromHex(PALETTE.amberGlow) },
	"markup.heading": { fg: RGBA.fromHex(PALETTE.amberGlow), bold: true },
	"markup.list": { fg: RGBA.fromHex(PALETTE.copperAccent) },
	"markup.raw": { fg: RGBA.fromHex(PALETTE.amberGlow) },
	"markup.strong": { fg: RGBA.fromHex(PALETTE.textPrimary), bold: true },
	"markup.italic": { fg: RGBA.fromHex(PALETTE.textPrimary), italic: true },
	"markup.strikethrough": { fg: RGBA.fromHex(PALETTE.textMuted), dim: true },
	"markup.link.label": {
		fg: RGBA.fromHex(PALETTE.amberPrimary),
		underline: true,
	},
	"markup.link.url": { fg: RGBA.fromHex(PALETTE.textMuted) },
	"markup.link": {
		fg: RGBA.fromHex(PALETTE.amberPrimary),
		underline: true,
	},
	"punctuation.special": { fg: RGBA.fromHex(PALETTE.borderDim) },
	conceal: { fg: RGBA.fromHex(PALETTE.borderDim) },
	keyword: { fg: RGBA.fromHex("#FF7B72"), bold: true },
	string: { fg: RGBA.fromHex("#A5D6FF") },
	comment: { fg: RGBA.fromHex(PALETTE.textMuted), italic: true },
	function: { fg: RGBA.fromHex(PALETTE.amberGlow) },
	number: { fg: RGBA.fromHex("#79C0FF") },
	type: { fg: RGBA.fromHex(PALETTE.amberPrimary) },
	operator: { fg: RGBA.fromHex(PALETTE.copperAccent) },
	default: { fg: RGBA.fromHex(PALETTE.textPrimary) },
});
