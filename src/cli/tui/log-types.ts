export type LogLevel = "info" | "success" | "warning" | "error";

export interface LogEntry {
	id: string;
	timestamp: Date;
	level: LogLevel;
	source: string;
	message: string;
	detail?: string;
}

export const LOG_ICONS: Record<LogLevel, string> = {
	info: "●",
	success: "✓",
	warning: "⚠",
	error: "✗",
};

export const MAX_LOG_ENTRIES = 500;
