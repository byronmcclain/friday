import { describe, expect, test } from "bun:test";
import {
	VOICE_SESSION_GREETING,
	buildForceMessagePayload,
} from "../../src/core/voice/force-message.ts";

describe("buildForceMessagePayload", () => {
	test("builds xAI force_message item", () => {
		const msg = buildForceMessagePayload(VOICE_SESSION_GREETING, {
			interruptible: false,
		});
		expect(msg.type).toBe("conversation.item.create");
		expect(msg.item.type).toBe("force_message");
		expect(msg.item.role).toBe("assistant");
		expect(msg.item.interruptible).toBe(false);
		expect(msg.item.content[0]).toEqual({
			type: "output_text",
			text: VOICE_SESSION_GREETING,
		});
	});
});
