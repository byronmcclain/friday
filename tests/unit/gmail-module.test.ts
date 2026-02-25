import { describe, expect, test } from "bun:test";
import gmailModule from "../../src/modules/gmail/index.ts";

describe("gmail module", () => {
	test("exports valid module manifest", () => {
		expect(gmailModule.name).toBe("gmail");
		expect(gmailModule.version).toBe("1.0.0");
		expect(gmailModule.description).toContain("Gmail");
	});

	test("includes all 6 tools", () => {
		expect(gmailModule.tools).toHaveLength(6);
		const names = gmailModule.tools.map((t) => t.name);
		expect(names).toContain("gmail.search");
		expect(names).toContain("gmail.read");
		expect(names).toContain("gmail.send");
		expect(names).toContain("gmail.reply");
		expect(names).toContain("gmail.modify");
		expect(names).toContain("gmail.list_labels");
	});

	test("includes gmail protocol", () => {
		expect(gmailModule.protocols).toHaveLength(1);
		expect(gmailModule.protocols[0]!.name).toBe("gmail");
	});

	test("declares network and email-send clearance", () => {
		expect(gmailModule.clearance).toContain("network");
		expect(gmailModule.clearance).toContain("email-send");
	});

	test("has onLoad lifecycle hook", () => {
		expect(typeof gmailModule.onLoad).toBe("function");
	});
});
