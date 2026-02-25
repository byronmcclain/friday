import type { Database } from "bun:sqlite";
import type { Rhythm, RhythmAction, RhythmExecution } from "./types.ts";
import type { ClearanceName } from "../core/clearance.ts";

type RhythmRow = {
	id: string;
	name: string;
	description: string;
	cron: string;
	enabled: number;
	origin: string;
	action_type: string;
	action_data: string;
	last_run: string | null;
	last_result: string | null;
	next_run: string;
	run_count: number;
	consecutive_failures: number;
	clearance: string;
	created_at: string;
	updated_at: string;
};

type ExecutionRow = {
	id: string;
	rhythm_id: string;
	started_at: string;
	completed_at: string | null;
	status: string;
	result: string | null;
	error: string | null;
};

export interface CreateRhythmInput {
	name: string;
	description: string;
	cron: string;
	enabled: boolean;
	origin: "user" | "friday";
	action: RhythmAction;
	nextRun: Date;
	clearance: ClearanceName[];
}

export interface UpdateRhythmInput {
	name?: string;
	description?: string;
	cron?: string;
	enabled?: boolean;
	action?: RhythmAction;
	nextRun?: Date;
	clearance?: ClearanceName[];
}

export interface ListFilter {
	enabled?: boolean;
	origin?: "user" | "friday";
}

export interface LogExecutionInput {
	rhythmId: string;
	startedAt: Date;
	status: "running" | "success" | "failure";
}

export class RhythmStore {
	private static readonly MAX_HISTORY_PER_RHYTHM = 100;
	private db: Database;

	constructor(db: Database) {
		this.db = db;
		this.migrate();
	}

	private migrate(): void {
		this.db.run("PRAGMA foreign_keys=ON;");
		this.db.run(`
			CREATE TABLE IF NOT EXISTS rhythms (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				cron TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				origin TEXT NOT NULL CHECK(origin IN ('user', 'friday')),
				action_type TEXT NOT NULL CHECK(action_type IN ('prompt', 'tool', 'protocol')),
				action_data TEXT NOT NULL,
				last_run TEXT,
				last_result TEXT CHECK(last_result IN ('success', 'failure')),
				next_run TEXT NOT NULL,
				run_count INTEGER NOT NULL DEFAULT 0,
				consecutive_failures INTEGER NOT NULL DEFAULT 0,
				clearance TEXT NOT NULL DEFAULT '[]',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS rhythm_executions (
				id TEXT PRIMARY KEY,
				rhythm_id TEXT NOT NULL REFERENCES rhythms(id) ON DELETE CASCADE,
				started_at TEXT NOT NULL,
				completed_at TEXT,
				status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failure')),
				result TEXT,
				error TEXT
			)
		`);
		this.db.run("CREATE INDEX IF NOT EXISTS idx_rhythm_executions_rhythm_id ON rhythm_executions(rhythm_id)");
		this.db.run("CREATE INDEX IF NOT EXISTS idx_rhythm_executions_started_at ON rhythm_executions(started_at)");
		this.db.run("CREATE INDEX IF NOT EXISTS idx_rhythm_executions_rhythm_started ON rhythm_executions(rhythm_id, started_at DESC)");
		this.db.run("CREATE INDEX IF NOT EXISTS idx_rhythms_next_run ON rhythms(next_run)");
		this.db.run("CREATE INDEX IF NOT EXISTS idx_rhythms_enabled ON rhythms(enabled)");
	}

	create(input: CreateRhythmInput): Rhythm {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const actionData = this.serializeActionData(input.action);

		this.db
			.query<void, [string, string, string, string, number, string, string, string, string, number, number, string, string, string]>(
				`INSERT INTO rhythms (id, name, description, cron, enabled, origin, action_type, action_data, next_run, run_count, consecutive_failures, clearance, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				input.name,
				input.description,
				input.cron,
				input.enabled ? 1 : 0,
				input.origin,
				input.action.type,
				actionData,
				input.nextRun.toISOString(),
				0,
				0,
				JSON.stringify(input.clearance),
				now,
				now,
			);

		return this.get(id)!;
	}

	get(id: string): Rhythm | undefined {
		const row = this.db
			.query<RhythmRow, [string]>("SELECT * FROM rhythms WHERE id = ?")
			.get(id);
		return row ? this.hydrate(row) : undefined;
	}

	list(filter?: ListFilter): Rhythm[] {
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (filter?.enabled !== undefined) {
			conditions.push("enabled = ?");
			params.push(filter.enabled ? 1 : 0);
		}
		if (filter?.origin !== undefined) {
			conditions.push("origin = ?");
			params.push(filter.origin);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const rows = this.db
			.query<RhythmRow, (string | number)[]>(`SELECT * FROM rhythms ${where} ORDER BY created_at`)
			.all(...params);

		return rows.map((row) => this.hydrate(row));
	}

	update(id: string, input: UpdateRhythmInput): Rhythm {
		const existing = this.get(id);
		if (!existing) throw new Error(`Rhythm not found: ${id}`);

		const sets: string[] = [];
		const params: (string | number)[] = [];

		if (input.name !== undefined) {
			sets.push("name = ?");
			params.push(input.name);
		}
		if (input.description !== undefined) {
			sets.push("description = ?");
			params.push(input.description);
		}
		if (input.cron !== undefined) {
			sets.push("cron = ?");
			params.push(input.cron);
		}
		if (input.enabled !== undefined) {
			sets.push("enabled = ?");
			params.push(input.enabled ? 1 : 0);
		}
		if (input.action !== undefined) {
			sets.push("action_type = ?");
			params.push(input.action.type);
			sets.push("action_data = ?");
			params.push(this.serializeActionData(input.action));
		}
		if (input.nextRun !== undefined) {
			sets.push("next_run = ?");
			params.push(input.nextRun.toISOString());
		}
		if (input.clearance !== undefined) {
			sets.push("clearance = ?");
			params.push(JSON.stringify(input.clearance));
		}

		sets.push("updated_at = ?");
		params.push(new Date().toISOString());
		params.push(id);

		this.db
			.query<void, (string | number)[]>(
				`UPDATE rhythms SET ${sets.join(", ")} WHERE id = ?`,
			)
			.run(...params);

		return this.get(id)!;
	}

	remove(id: string): void {
		this.db.query<void, [string]>("DELETE FROM rhythms WHERE id = ?").run(id);
	}

	logExecution(input: LogExecutionInput): RhythmExecution {
		const id = crypto.randomUUID();

		this.db
			.query<void, [string, string, string, string]>(
				`INSERT INTO rhythm_executions (id, rhythm_id, started_at, status) VALUES (?, ?, ?, ?)`,
			)
			.run(id, input.rhythmId, input.startedAt.toISOString(), input.status);

		return {
			id,
			rhythmId: input.rhythmId,
			startedAt: input.startedAt,
			status: input.status,
		};
	}

	completeExecution(
		id: string,
		status: "success" | "failure",
		result?: string,
		error?: string,
	): void {
		this.db
			.query<void, [string, string, string | null, string | null, string]>(
				`UPDATE rhythm_executions SET status = ?, completed_at = ?, result = ?, error = ? WHERE id = ?`,
			)
			.run(status, new Date().toISOString(), result ?? null, error ?? null, id);

		// Prune old execution entries beyond the retention limit
		this.db
			.query<void, [string, string, number]>(
				`DELETE FROM rhythm_executions WHERE rhythm_id = (
					SELECT rhythm_id FROM rhythm_executions WHERE id = ?
				) AND id NOT IN (
					SELECT id FROM rhythm_executions WHERE rhythm_id = (
						SELECT rhythm_id FROM rhythm_executions WHERE id = ?
					) ORDER BY started_at DESC LIMIT ?
				)`,
			)
			.run(id, id, RhythmStore.MAX_HISTORY_PER_RHYTHM);
	}

	getHistory(rhythmId?: string, limit = 20): RhythmExecution[] {
		let rows: ExecutionRow[];

		if (rhythmId) {
			rows = this.db
				.query<ExecutionRow, [string, number]>(
					"SELECT * FROM rhythm_executions WHERE rhythm_id = ? ORDER BY started_at DESC LIMIT ?",
				)
				.all(rhythmId, limit);
		} else {
			rows = this.db
				.query<ExecutionRow, [number]>(
					"SELECT * FROM rhythm_executions ORDER BY started_at DESC LIMIT ?",
				)
				.all(limit);
		}

		return rows.map((row) => this.hydrateExecution(row));
	}

	markExecuted(
		id: string,
		result: "success" | "failure",
		nextRun: Date,
	): void {
		const failureExpr =
			result === "success"
				? "consecutive_failures = 0"
				: "consecutive_failures = consecutive_failures + 1";

		this.db
			.query<void, [string, string, string, string, string]>(
				`UPDATE rhythms SET
					last_run = ?,
					last_result = ?,
					next_run = ?,
					run_count = run_count + 1,
					${failureExpr},
					updated_at = ?
				WHERE id = ?`,
			)
			.run(
				new Date().toISOString(),
				result,
				nextRun.toISOString(),
				new Date().toISOString(),
				id,
			);
	}

	getDueRhythms(now: Date): Rhythm[] {
		const rows = this.db
			.query<RhythmRow, [string]>(
				"SELECT * FROM rhythms WHERE enabled = 1 AND next_run <= ? ORDER BY next_run",
			)
			.all(now.toISOString());

		return rows.map((row) => this.hydrate(row));
	}

	private hydrate(row: RhythmRow): Rhythm {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			cron: row.cron,
			enabled: row.enabled === 1,
			origin: row.origin as "user" | "friday",
			action: this.deserializeAction(row.action_type, row.action_data),
			lastRun: row.last_run ? new Date(row.last_run) : undefined,
			lastResult: row.last_result as "success" | "failure" | undefined,
			nextRun: new Date(row.next_run),
			runCount: row.run_count,
			consecutiveFailures: row.consecutive_failures,
			clearance: JSON.parse(row.clearance) as ClearanceName[],
			createdAt: new Date(row.created_at),
			updatedAt: new Date(row.updated_at),
		};
	}

	private hydrateExecution(row: ExecutionRow): RhythmExecution {
		return {
			id: row.id,
			rhythmId: row.rhythm_id,
			startedAt: new Date(row.started_at),
			completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
			status: row.status as "running" | "success" | "failure",
			result: row.result ?? undefined,
			error: row.error ?? undefined,
		};
	}

	private serializeActionData(action: RhythmAction): string {
		switch (action.type) {
			case "prompt":
				return JSON.stringify({ prompt: action.prompt });
			case "tool":
				return JSON.stringify({ tool: action.tool, args: action.args });
			case "protocol":
				return JSON.stringify({
					protocol: action.protocol,
					args: action.args,
				});
		}
	}

	private deserializeAction(type: string, data: string): RhythmAction {
		const parsed = JSON.parse(data);
		switch (type) {
			case "prompt":
				return { type: "prompt", prompt: parsed.prompt };
			case "tool":
				return { type: "tool", tool: parsed.tool, args: parsed.args };
			case "protocol":
				return {
					type: "protocol",
					protocol: parsed.protocol,
					args: parsed.args,
				};
			default:
				throw new Error(`Unknown action type: ${type}`);
		}
	}
}
