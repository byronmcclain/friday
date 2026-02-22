export interface ForgeProposal {
	id: string;
	action: "create" | "patch";
	moduleName: string;
	description: string;
	files: ForgeFile[];
	createdAt: string;
}

export interface ForgeFile {
	path: string;
	content: string;
}

export interface ForgeManifest {
	version: number;
	modules: Record<string, ForgeModuleEntry>;
}

export interface ForgeModuleEntry {
	description: string;
	version: string;
	created: string;
	lastModified: string;
	status: "loaded" | "failed" | "pending";
	protected: boolean;
	history: ForgeHistoryEntry[];
}

export interface ForgeHistoryEntry {
	version: string;
	date: string;
	action: "created" | "patched" | "rolledback";
	reason: string;
}

export interface ForgeHealthReport {
	loaded: string[];
	failed: {
		name: string;
		error: string;
		lastWorkingVersion?: string;
	}[];
	pending: string[];
}

export interface ForgeValidationResult {
	moduleName: string;
	passed: boolean;
	steps: ForgeValidationStep[];
}

export interface ForgeValidationStep {
	name: "import" | "manifest" | "typecheck" | "lint";
	passed: boolean;
	error?: string;
}
