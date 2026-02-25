// tests/unit/arc-rhythm-cron.test.ts
import { describe, test, expect } from "bun:test";
import {
	nextOccurrence,
	validate,
	describe as describeCron,
} from "../../src/arc-rhythm/cron.ts";

describe("cron parser", () => {
	describe("validate()", () => {
		test("accepts standard 5-field expressions", () => {
			expect(validate("0 9 * * *").valid).toBe(true);
			expect(validate("*/15 * * * *").valid).toBe(true);
			expect(validate("0 0 1 1 *").valid).toBe(true);
		});

		test("accepts ranges", () => {
			expect(validate("0 9-17 * * MON-FRI").valid).toBe(true);
		});

		test("accepts lists", () => {
			expect(validate("0,30 * * * *").valid).toBe(true);
		});

		test("accepts steps", () => {
			expect(validate("*/5 * * * *").valid).toBe(true);
			expect(validate("1-30/5 * * * *").valid).toBe(true);
		});

		test("accepts named days", () => {
			expect(validate("0 9 * * MON").valid).toBe(true);
			expect(validate("0 9 * * MON,WED,FRI").valid).toBe(true);
		});

		test("accepts named months", () => {
			expect(validate("0 0 1 JAN *").valid).toBe(true);
			expect(validate("0 0 1 JAN-MAR *").valid).toBe(true);
		});

		test("accepts shorthands", () => {
			expect(validate("@hourly").valid).toBe(true);
			expect(validate("@daily").valid).toBe(true);
			expect(validate("@weekly").valid).toBe(true);
			expect(validate("@monthly").valid).toBe(true);
		});

		test("rejects invalid expressions", () => {
			expect(validate("").valid).toBe(false);
			expect(validate("* *").valid).toBe(false);
			expect(validate("60 * * * *").valid).toBe(false);
			expect(validate("* 25 * * *").valid).toBe(false);
			expect(validate("* * 32 * *").valid).toBe(false);
			expect(validate("* * * 13 *").valid).toBe(false);
			expect(validate("* * * * 8").valid).toBe(false);
			expect(validate("@bogus").valid).toBe(false);
		});

		test("returns error message on invalid", () => {
			const result = validate("60 * * * *");
			expect(result.valid).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("nextOccurrence()", () => {
		test("daily at 9am from before 9am", () => {
			const after = new Date("2026-02-24T08:00:00Z");
			const next = nextOccurrence("0 9 * * *", after);
			expect(next.getUTCHours()).toBe(9);
			expect(next.getUTCMinutes()).toBe(0);
			expect(next.getUTCDate()).toBe(24);
		});

		test("daily at 9am from after 9am advances to next day", () => {
			const after = new Date("2026-02-24T10:00:00Z");
			const next = nextOccurrence("0 9 * * *", after);
			expect(next.getUTCHours()).toBe(9);
			expect(next.getUTCDate()).toBe(25);
		});

		test("every 15 minutes", () => {
			const after = new Date("2026-02-24T10:03:00Z");
			const next = nextOccurrence("*/15 * * * *", after);
			expect(next.getUTCMinutes()).toBe(15);
			expect(next.getUTCHours()).toBe(10);
		});

		test("specific day of week (MON)", () => {
			const after = new Date("2026-02-24T00:00:00Z");
			const next = nextOccurrence("0 9 * * MON", after);
			expect(next.getUTCDay()).toBe(1);
			expect(next.getUTCDate()).toBe(2); // March 2, 2026
		});

		test("monthly on the 1st", () => {
			const after = new Date("2026-02-24T00:00:00Z");
			const next = nextOccurrence("0 0 1 * *", after);
			expect(next.getUTCDate()).toBe(1);
			expect(next.getUTCMonth()).toBe(2); // March
		});

		test("handles month boundary rollover", () => {
			const after = new Date("2026-01-31T23:59:00Z");
			const next = nextOccurrence("0 0 * * *", after);
			expect(next.getUTCDate()).toBe(1);
			expect(next.getUTCMonth()).toBe(1); // February
		});

		test("@hourly shorthand", () => {
			const after = new Date("2026-02-24T10:30:00Z");
			const next = nextOccurrence("@hourly", after);
			expect(next.getUTCMinutes()).toBe(0);
			expect(next.getUTCHours()).toBe(11);
		});

		test("@daily shorthand", () => {
			const after = new Date("2026-02-24T10:00:00Z");
			const next = nextOccurrence("@daily", after);
			expect(next.getUTCHours()).toBe(0);
			expect(next.getUTCMinutes()).toBe(0);
			expect(next.getUTCDate()).toBe(25);
		});

		test("defaults to Date.now() when no after provided", () => {
			const next = nextOccurrence("0 0 * * *");
			expect(next.getTime()).toBeGreaterThan(Date.now());
		});

		test("range 9-17 weekdays", () => {
			const after = new Date("2026-02-24T18:00:00Z"); // Tuesday 6pm
			const next = nextOccurrence("0 9-17 * * 1-5", after);
			expect(next.getUTCHours()).toBe(9);
			expect(next.getUTCDate()).toBe(25); // Wednesday
		});

		test("list of minutes 0,15,30,45", () => {
			const after = new Date("2026-02-24T10:16:00Z");
			const next = nextOccurrence("0,15,30,45 * * * *", after);
			expect(next.getUTCMinutes()).toBe(30);
			expect(next.getUTCHours()).toBe(10);
		});

		test("uses OR semantics when both DOM and DOW are non-wildcard", () => {
			const after = new Date("2026-03-02T00:00:00Z"); // Monday
			const next = nextOccurrence("0 9 1 * 1", after);
			// March 2 is a Monday (DOW match), even though DOM is 2 not 1
			// OR semantics: DOM=1 OR DOW=Monday — Monday March 2 should match
			expect(next.getUTCDate()).toBe(2);
			expect(next.getUTCDay()).toBe(1);
		});
	});

	describe("describe()", () => {
		test("describes daily cron", () => {
			const desc = describeCron("0 9 * * *");
			expect(desc).toContain("9");
			expect(desc.toLowerCase()).toContain("day");
		});

		test("describes @hourly", () => {
			const desc = describeCron("@hourly");
			expect(desc.toLowerCase()).toContain("hour");
		});

		test("describes @daily", () => {
			const desc = describeCron("@daily");
			expect(desc.toLowerCase()).toContain("day");
		});

		test("describes @weekly", () => {
			const desc = describeCron("@weekly");
			expect(desc.toLowerCase()).toContain("week");
		});

		test("describes @monthly", () => {
			const desc = describeCron("@monthly");
			expect(desc.toLowerCase()).toContain("month");
		});
	});
});
