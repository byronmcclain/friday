import type { AuditEntry, AuditFilter } from "./types.ts";

export class AuditLogger {
  private logEntries: AuditEntry[] = [];

  log(entry: Omit<AuditEntry, "timestamp">): void {
    this.logEntries.push({ ...entry, timestamp: new Date() });
  }

  entries(filter?: AuditFilter): AuditEntry[] {
    let result = [...this.logEntries];
    if (filter?.source) {
      result = result.filter((e) => e.source === filter.source);
    }
    if (filter?.action) {
      result = result.filter((e) => e.action === filter.action);
    }
    if (filter?.since) {
      result = result.filter((e) => e.timestamp >= filter.since!);
    }
    return result;
  }

  clear(): void {
    this.logEntries = [];
  }
}
