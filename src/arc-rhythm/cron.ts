const SHORTHANDS: Record<string, string> = {
	"@hourly": "0 * * * *",
	"@daily": "0 0 * * *",
	"@weekly": "0 0 * * 0",
	"@monthly": "0 0 1 * *",
};

const DAY_NAMES: Record<string, number> = {
	SUN: 0,
	MON: 1,
	TUE: 2,
	WED: 3,
	THU: 4,
	FRI: 5,
	SAT: 6,
};

const MONTH_NAMES: Record<string, number> = {
	JAN: 1,
	FEB: 2,
	MAR: 3,
	APR: 4,
	MAY: 5,
	JUN: 6,
	JUL: 7,
	AUG: 8,
	SEP: 9,
	OCT: 10,
	NOV: 11,
	DEC: 12,
};

interface FieldSpec {
	min: number;
	max: number;
	names?: Record<string, number>;
}

const FIELDS: FieldSpec[] = [
	{ min: 0, max: 59 }, // minute
	{ min: 0, max: 23 }, // hour
	{ min: 1, max: 31 }, // day of month
	{ min: 1, max: 12, names: MONTH_NAMES }, // month
	{ min: 0, max: 7, names: DAY_NAMES }, // day of week (0 and 7 = Sunday)
];

function expandShorthand(expr: string): string {
	return SHORTHANDS[expr.toLowerCase()] ?? expr;
}

function replaceNames(token: string, names: Record<string, number>): string {
	let result = token;
	for (const [name, value] of Object.entries(names)) {
		result = result.replace(new RegExp(`\\b${name}\\b`, "gi"), String(value));
	}
	return result;
}

function parseField(
	token: string,
	spec: FieldSpec,
): { values: Set<number> } | { error: string } {
	const resolved = spec.names ? replaceNames(token, spec.names) : token;
	const values = new Set<number>();

	for (const part of resolved.split(",")) {
		const stepMatch = part.match(/^(.+)\/(\d+)$/);
		const step = stepMatch ? Number.parseInt(stepMatch[2]!, 10) : 1;
		const range = stepMatch ? stepMatch[1]! : part;

		if (range === "*") {
			for (let i = spec.min; i <= spec.max; i += step) values.add(i);
			continue;
		}

		const rangeMatch = range.match(/^(\d+)-(\d+)$/);
		if (rangeMatch) {
			const start = Number.parseInt(rangeMatch[1]!, 10);
			const end = Number.parseInt(rangeMatch[2]!, 10);
			if (start < spec.min || end > spec.max || start > end) {
				return { error: `Range ${start}-${end} out of bounds (${spec.min}-${spec.max})` };
			}
			for (let i = start; i <= end; i += step) values.add(i);
			continue;
		}

		const num = Number.parseInt(range, 10);
		if (Number.isNaN(num) || num < spec.min || num > spec.max) {
			return { error: `Value ${range} out of bounds (${spec.min}-${spec.max})` };
		}
		values.add(num);
	}

	return { values };
}

export function validate(expr: string): { valid: boolean; error?: string } {
	if (!expr) return { valid: false, error: "Empty expression" };

	if (expr.startsWith("@")) {
		if (SHORTHANDS[expr.toLowerCase()]) return { valid: true };
		return { valid: false, error: `Unknown shorthand: ${expr}` };
	}

	const parts = expr.split(/\s+/);
	if (parts.length !== 5) {
		return { valid: false, error: `Expected 5 fields, got ${parts.length}` };
	}

	for (let i = 0; i < 5; i++) {
		const result = parseField(parts[i]!, FIELDS[i]!);
		if ("error" in result) return { valid: false, error: result.error };
	}

	return { valid: true };
}

function parsedFields(expr: string): [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>] {
	const expanded = expandShorthand(expr);
	const parts = expanded.split(/\s+/);
	const result: Set<number>[] = [];

	for (let i = 0; i < 5; i++) {
		const parsed = parseField(parts[i]!, FIELDS[i]!);
		if ("error" in parsed) throw new Error(parsed.error);
		// Normalize day-of-week: 7 → 0 (both mean Sunday)
		if (i === 4 && parsed.values.has(7)) {
			parsed.values.delete(7);
			parsed.values.add(0);
		}
		result.push(parsed.values);
	}

	return result as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
}

export function nextOccurrence(expr: string, after?: Date): Date {
	const [minutes, hours, daysOfMonth, months, daysOfWeek] =
		parsedFields(expr);
	const expanded = expandShorthand(expr).split(/\s+/);
	const dowWildcard = expanded[4] === "*";
	const domWildcard = expanded[2] === "*";

	const cursor = new Date(after ?? new Date());
	// Start from the next minute
	cursor.setUTCSeconds(0, 0);
	cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

	const limit = new Date(cursor);
	limit.setUTCFullYear(limit.getUTCFullYear() + 4);

	while (cursor < limit) {
		if (!months.has(cursor.getUTCMonth() + 1)) {
			cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
			cursor.setUTCHours(0, 0, 0, 0);
			continue;
		}

		const domMatch = daysOfMonth.has(cursor.getUTCDate());
		const dowMatch = daysOfWeek.has(cursor.getUTCDay());

		let dayOk: boolean;
		if (domWildcard && dowWildcard) {
			dayOk = true;
		} else if (domWildcard) {
			dayOk = dowMatch;
		} else if (dowWildcard) {
			dayOk = domMatch;
		} else {
			dayOk = domMatch || dowMatch; // OR semantics per POSIX cron
		}

		if (!dayOk) {
			cursor.setUTCDate(cursor.getUTCDate() + 1);
			cursor.setUTCHours(0, 0, 0, 0);
			continue;
		}

		if (!hours.has(cursor.getUTCHours())) {
			cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
			continue;
		}

		if (!minutes.has(cursor.getUTCMinutes())) {
			cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
			continue;
		}

		return new Date(cursor);
	}

	throw new Error(`No occurrence found within 4 years for: ${expr}`);
}

export function describe(expr: string): string {
	const lower = expr.toLowerCase();
	if (lower === "@hourly") return "Every hour";
	if (lower === "@daily") return "Every day at midnight";
	if (lower === "@weekly") return "Every week on Sunday at midnight";
	if (lower === "@monthly") return "Every month on the 1st at midnight";

	const expanded = expandShorthand(expr);
	const parts = expanded.split(/\s+/);
	const min = parts[0] ?? "*";
	const hour = parts[1] ?? "*";
	const dom = parts[2] ?? "*";
	const mon = parts[3] ?? "*";
	const dow = parts[4] ?? "*";

	const pieces: string[] = [];

	if (min === "0" && hour !== "*") {
		pieces.push(`At ${hour}:00`);
	} else if (min !== "*" && hour !== "*") {
		pieces.push(`At ${hour}:${min.padStart(2, "0")}`);
	} else if (min.includes("/")) {
		pieces.push(`Every ${min.split("/")[1] ?? ""} minutes`);
	} else if (min.includes(",")) {
		pieces.push(`At minutes ${min}`);
	} else if (min === "*" && hour === "*") {
		pieces.push("Every minute");
	}

	if (dom !== "*") pieces.push(`on day ${dom}`);
	if (mon !== "*") pieces.push(`of month ${mon}`);
	if (dow !== "*") pieces.push(`on ${dowDescription(dow)}`);

	if (pieces.length === 0) return "Custom schedule";

	const desc = pieces.join(" ");
	if (!desc.toLowerCase().includes("day") && dow === "*" && dom === "*") {
		return `${desc} every day`;
	}

	return desc;
}

function dowDescription(field: string): string {
	const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	const nums = field.split(",").map((n) => {
		const num = Number.parseInt(n, 10);
		if (!Number.isNaN(num) && num >= 0 && num <= 7) return names[num % 7];
		return n;
	});
	return nums.join(", ");
}
