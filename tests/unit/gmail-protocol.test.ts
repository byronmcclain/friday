import { describe, expect, test } from "bun:test";
import { gmailProtocol } from "../../src/modules/gmail/protocol.ts";

describe("/gmail protocol", () => {
	test("has correct name", () => {
		expect(gmailProtocol.name).toBe("gmail");
	});

	test("has mail and email aliases", () => {
		expect(gmailProtocol.aliases).toContain("mail");
		expect(gmailProtocol.aliases).toContain("email");
	});

	test("declares network clearance", () => {
		expect(gmailProtocol.clearance).toContain("network");
	});

	test("has subcommand parameter", () => {
		const sub = gmailProtocol.parameters.find(
			(p) => p.name === "subcommand",
		);
		expect(sub).toBeDefined();
		expect(sub!.required).toBe(true);
	});
});
