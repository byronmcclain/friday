export type SmartSource = "manual" | "auto" | "conversation";

export interface SmartEntry {
  name: string;
  domain: string;
  tags: string[];
  confidence: number;
  source: SmartSource;
  sessionId?: number;
  createdAt?: string;
  content: string;
  filePath: string;
}

export interface SmartsConfig {
  smartsDir: string;
  maxPerMessage: number;
  tokenBudget: number;
  minConfidence: number;
}

export const SMARTS_DEFAULTS: SmartsConfig = {
  smartsDir: "./smarts",
  maxPerMessage: 5,
  tokenBudget: 24000,
  minConfidence: 0.5,
};
