import { MAX_LOG_ENTRIES, type LogEntry } from "./log-types.ts";

export type LogSubscriber = () => void;

export class LogStore {
	private _entries: LogEntry[] = [];
	private subscribers: Set<LogSubscriber> = new Set();
	private maxEntries: number;

	constructor(maxEntries = MAX_LOG_ENTRIES) {
		this.maxEntries = maxEntries;
	}

	get entries(): LogEntry[] {
		return this._entries;
	}

	push(entry: LogEntry): void {
		this._entries.push(entry);
		if (this._entries.length > this.maxEntries) {
			this._entries = this._entries.slice(this._entries.length - this.maxEntries);
		}
		for (const cb of this.subscribers) {
			try {
				cb();
			} catch {
				// Isolate subscriber errors
			}
		}
	}

	subscribe(cb: LogSubscriber): void {
		this.subscribers.add(cb);
	}

	unsubscribe(cb: LogSubscriber): void {
		this.subscribers.delete(cb);
	}

	clear(): void {
		this._entries = [];
	}
}
