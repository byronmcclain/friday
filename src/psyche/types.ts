export interface RelationalDimension {
	name: string;
	description: string;
	updatedAt: string;
}

export type EmotionalType =
	| "triumph"
	| "tension"
	| "breakthrough"
	| "warmth"
	| "frustration"
	| "growth";

export interface EmotionalMilestone {
	id: string;
	occurredAt: string;
	summary: string;
	emotionalType: EmotionalType;
	sessionId?: string;
	relevanceDecay: number;
}

export interface SessionMood {
	sessionId: string;
	startedMood: string;
	endedMood: string;
	arcSummary: string;
	analyzedAt: string;
}

export interface PsycheState {
	dimensions: RelationalDimension[];
	milestones: EmotionalMilestone[];
	lastSessionMood?: SessionMood;
}

export interface PsycheCuratorResult {
	session_mood: {
		started: string;
		ended: string;
		arc: string;
	};
	milestones: Array<{
		summary: string;
		emotional_type: EmotionalType;
	}>;
	dimension_updates: Array<{
		name: string;
		new_description: string;
		reasoning: string;
	}>;
}

export interface PsycheStoreConfig {
	maxMilestones: number;
	decayGraceDays: number;
	decayHalfLifeDays: number;
	decayFloor: number;
}

export const PSYCHE_DEFAULTS: PsycheStoreConfig = {
	maxMilestones: 50,
	decayGraceDays: 7,
	decayHalfLifeDays: 30,
	decayFloor: 0.1,
};

export const DIMENSION_NAMES = [
	"trust",
	"banter",
	"emotional_openness",
	"shared_history",
	"current_energy",
] as const;

export type DimensionName = (typeof DIMENSION_NAMES)[number];

export const DIMENSION_LABELS: Record<DimensionName, string> = {
	trust: "Trust",
	banter: "Banter",
	emotional_openness: "Emotional openness",
	shared_history: "Shared history",
	current_energy: "Current energy",
};

export function getDimensionLabel(name: string): string {
	return DIMENSION_LABELS[name as DimensionName] ?? name;
}

export const NEUTRAL_SEED_DIMENSIONS: Record<DimensionName, string> = {
	trust:
		"New relationship. No history yet — operating on default professional courtesy with warmth.",
	banter:
		"Untested. Default to professional with light personality. Read the room before pushing humor.",
	emotional_openness:
		"Baseline. No emotional patterns observed yet. Pay attention to communication style.",
	shared_history: "None yet. Everything from here is first.",
	current_energy:
		"Fresh start. Open, attentive, ready to learn who this person is.",
};
