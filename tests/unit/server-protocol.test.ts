import { describe, test, expect } from "bun:test";
import { parseClientMessage } from "../../src/server/protocol.ts";
import type { ServerMessage } from "../../src/server/protocol.ts";

describe("parseClientMessage — voice messages", () => {
  test("parses session:identify", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "session:identify",
      id: "1",
      clientType: "voice",
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("session:identify");
  });

  test("session:identify requires clientType", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "session:identify",
      id: "1",
    }));
    expect(msg).toBeNull();
  });

  test("parses voice:start", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:start",
      id: "1",
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("voice:start");
  });

  test("parses voice:stop", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:stop",
      id: "1",
    }));
    expect(msg).not.toBeNull();
  });

  test("parses voice:mode", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:mode",
      id: "1",
      mode: "whisper",
    }));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("voice:mode");
  });

  test("voice:mode requires mode field", () => {
    const msg = parseClientMessage(JSON.stringify({
      type: "voice:mode",
      id: "1",
    }));
    expect(msg).toBeNull();
  });
});

describe("ServerMessage types", () => {
	test("conversation:message supports replay source", () => {
		const msg: ServerMessage = {
			type: "conversation:message",
			role: "user",
			content: "hello",
			source: "replay",
		};
		expect(msg.source).toBe("replay");
	});
});
