import { SyntaxStyle, RGBA } from "@opentui/core";

export const PALETTE = {
	background: "#0D1117",
	surface: "#161B22",
	amberPrimary: "#F0A030",
	amberGlow: "#FFD080",
	amberDim: "#8B6914",
	copperAccent: "#C07020",
	textPrimary: "#E6EDF3",
	textMuted: "#7D8590",
	success: "#3FB950",
	error: "#F85149",
	warning: "#D29922",
} as const;

export const FRIDAY_SYNTAX_STYLE = SyntaxStyle.fromStyles({
	"markup.heading.1": { fg: RGBA.fromHex(PALETTE.amberPrimary), bold: true },
	"markup.heading": { fg: RGBA.fromHex(PALETTE.amberGlow), bold: true },
	"markup.list": { fg: RGBA.fromHex(PALETTE.copperAccent) },
	"markup.raw": { fg: RGBA.fromHex(PALETTE.amberGlow) },
	"markup.link": {
		fg: RGBA.fromHex(PALETTE.amberPrimary),
		underline: true,
	},
	default: { fg: RGBA.fromHex(PALETTE.textPrimary) },
});
