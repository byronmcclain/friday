export interface AuditEntry {
  timestamp: Date;
  action: string;
  source: string;
  detail: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuditFilter {
  source?: string;
  action?: string;
  since?: Date;
}
