import type { AuditEntry, AuditFilter } from "./types.ts";

// Circular buffer replaces Array.shift() (O(n)) with O(1) insertion.
export class AuditLogger {
	private static readonly MAX_ENTRIES = 10_000;
	private buffer: (AuditEntry | undefined)[];
	private head = 0;
	private count = 0;

	onLog?: (entry: AuditEntry) => void;

	constructor() {
		this.buffer = new Array(AuditLogger.MAX_ENTRIES);
	}

	log(entry: Omit<AuditEntry, "timestamp">): void {
		const full: AuditEntry = { ...entry, timestamp: new Date() };
		this.buffer[this.head] = full;
		this.head = (this.head + 1) % AuditLogger.MAX_ENTRIES;
		if (this.count < AuditLogger.MAX_ENTRIES) this.count++;
		if (this.onLog) {
			try {
				this.onLog(full);
			} catch {
				// Isolate callback errors from logging
			}
		}
	}

	entries(filter?: AuditFilter): AuditEntry[] {
		const result: AuditEntry[] = [];
		const start =
			this.count < AuditLogger.MAX_ENTRIES
				? 0
				: this.head;
		for (let i = 0; i < this.count; i++) {
			const idx = (start + i) % AuditLogger.MAX_ENTRIES;
			const e = this.buffer[idx]!;
			if (filter?.source && e.source !== filter.source) continue;
			if (filter?.action && e.action !== filter.action) continue;
			if (filter?.since && e.timestamp < filter.since) continue;
			result.push(e);
		}
		return result;
	}

	clear(): void {
		this.buffer = new Array(AuditLogger.MAX_ENTRIES);
		this.head = 0;
		this.count = 0;
	}
}
