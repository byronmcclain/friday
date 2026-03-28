// src/psyche/protocol.ts
import type {
	FridayProtocol,
	ProtocolResult,
	ProtocolContext,
} from "../modules/types.ts";
import type { PsycheStore } from "./store.ts";
import { DIMENSION_LABELS } from "./types.ts";

export function createPsycheProtocol(store: PsycheStore): FridayProtocol {
	return {
		name: "psyche",
		description: "View and manage Friday's emotional intelligence state",
		aliases: ["psych", "eq"],
		parameters: [],
		clearance: [],

		async execute(
			args: Record<string, unknown>,
			_context: ProtocolContext,
		): Promise<ProtocolResult> {
			const rawArgs = ((args.rawArgs as string) ?? "").trim();
			const [subcommand] = rawArgs.split(/\s+/, 1);

			switch (subcommand) {
				case "status":
					return handleStatus(store);
				case "dimensions":
					return handleDimensions(store);
				case "milestones":
					return handleMilestones(store);
				case "reset":
					return handleReset(store);
				default:
					return {
						success: false,
						summary: subcommand
							? `Unknown subcommand: "${subcommand}". Available: status, dimensions, milestones, reset`
							: "Usage: /psyche <status|dimensions|milestones|reset>",
					};
			}
		},
	};
}

function handleStatus(store: PsycheStore): ProtocolResult {
	const dims = store.getDimensions();
	if (dims.length === 0) {
		return {
			success: true,
			summary:
				"No emotional state initialized yet. Psyche will activate after the first session.",
		};
	}

	const lines: string[] = ["**Relational Dimensions:**"];
	for (const d of dims) {
		const label = DIMENSION_LABELS[d.name as keyof typeof DIMENSION_LABELS] ?? d.name;
		const desc =
			d.description.length > 80
				? `${d.description.slice(0, 80)}...`
				: d.description;
		lines.push(`- **${label}:** ${desc}`);
	}

	const mood = store.getLastSessionMood();
	if (mood) {
		lines.push("");
		lines.push(`**Last session:** ${mood.arcSummary}`);
	}

	const milestones = store.getMilestones(3);
	if (milestones.length > 0) {
		lines.push("");
		lines.push(`**Recent milestones:** ${milestones.length} stored`);
	}

	return { success: true, summary: lines.join("\n") };
}

function handleDimensions(store: PsycheStore): ProtocolResult {
	const dims = store.getDimensions();
	if (dims.length === 0) {
		return { success: true, summary: "No dimensions initialized yet." };
	}
	const lines = dims.map((d) => {
		const label = DIMENSION_LABELS[d.name as keyof typeof DIMENSION_LABELS] ?? d.name;
		return `**${label}:**\n${d.description}`;
	});
	return { success: true, summary: lines.join("\n\n") };
}

function handleMilestones(store: PsycheStore): ProtocolResult {
	const milestones = store.getMilestones(10);
	if (milestones.length === 0) {
		return { success: true, summary: "No milestones recorded yet." };
	}
	const lines = milestones.map((m) => {
		const date = m.occurredAt.slice(0, 10);
		const decay =
			m.relevanceDecay < 1.0
				? ` (relevance: ${(m.relevanceDecay * 100).toFixed(0)}%)`
				: "";
		return `- **[${date}]** ${m.summary} *(${m.emotionalType})*${decay}`;
	});
	return { success: true, summary: lines.join("\n") };
}

function handleReset(store: PsycheStore): ProtocolResult {
	store.reset();
	return {
		success: true,
		summary:
			"Psyche emotional state reset. Dimensions, milestones, and session moods cleared. Will re-seed on next boot.",
	};
}
