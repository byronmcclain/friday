export const VOICE_SESSION_GREETING = "Systems online. I'm listening.";

export function buildForceMessagePayload(
	text: string,
	opts?: { interruptible?: boolean },
): {
	type: "conversation.item.create";
	item: {
		type: "force_message";
		role: "assistant";
		interruptible: boolean;
		content: Array<{ type: "output_text"; text: string }>;
	};
} {
	return {
		type: "conversation.item.create",
		item: {
			type: "force_message",
			role: "assistant",
			interruptible: opts?.interruptible ?? true,
			content: [{ type: "output_text", text }],
		},
	};
}
