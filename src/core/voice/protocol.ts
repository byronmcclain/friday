import type { FridayProtocol, ProtocolResult, ProtocolContext } from "../../modules/types.ts";
import type { Vox } from "./vox.ts";
import type { VoiceMode } from "./types.ts";

export function createVoiceProtocol(vox: Vox): FridayProtocol {
	return {
		name: "voice",
		description: "Control Friday's voice output: on, off, whisper, test, status",
		aliases: ["vox", "speak"],
		parameters: [],
		clearance: [],
		execute: async (
			args: Record<string, unknown>,
			_context: ProtocolContext,
		): Promise<ProtocolResult> => {
			const rawArgs = (args.rawArgs as string) ?? "";
			const parts = rawArgs.trim().split(/\s+/);
			const subcommand = parts[0] ?? "";

			switch (subcommand) {
				case "":
				case "status":
					return handleStatus(vox);
				case "on":
					return handleSetMode(vox, "on");
				case "off":
					return handleSetMode(vox, "off");
				case "whisper":
					return handleSetMode(vox, "whisper");
				case "test":
					return handleTest(vox);
				default:
					return {
						success: false,
						summary: `Unknown subcommand: "${subcommand}". Available: on, off, whisper, test, status`,
					};
			}
		},
	};
}

function handleStatus(vox: Vox): ProtocolResult {
	const s = vox.status();
	const lines = [
		`Voice: ${s.mode}`,
		`Voice name: ${s.voice}`,
		`Connected: ${s.connected ? "yes" : "no"}`,
		`API key: ${s.apiKeyAvailable ? "set" : "not set"}`,
	];
	return { success: true, summary: lines.join("\n") };
}

function handleSetMode(vox: Vox, mode: VoiceMode): ProtocolResult {
	vox.setMode(mode);
	const label = mode === "off" ? "Voice off." : mode === "on" ? "Voice on." : "Whisper mode.";
	return { success: true, summary: label };
}

async function handleTest(vox: Vox): Promise<ProtocolResult> {
	const prevMode = vox.mode;
	if (prevMode === "off") {
		vox.setMode("on");
	}
	await vox.speak("All systems online, Boss. Voice is working grand.");
	if (prevMode === "off") {
		vox.setMode("off");
	}
	return { success: true, summary: "Test phrase sent to voice output." };
}
