import type { Rhythm } from "./types.ts";
import type { Cortex } from "../core/cortex.ts";
import type { ProtocolRegistry } from "../protocols/registry.ts";
import type { ClearanceManager } from "../core/clearance.ts";
import type { AuditLogger } from "../audit/logger.ts";
import type { ToolContext, ProtocolContext } from "../modules/types.ts";

export interface ExecutorConfig {
	cortex: Cortex;
	protocols: ProtocolRegistry;
	clearance: ClearanceManager;
	audit: AuditLogger;
}

export interface ExecutionResult {
	status: "success" | "failure";
	result?: string;
	error?: string;
}

export class RhythmExecutor {
	private cortex: Cortex;
	private protocols: ProtocolRegistry;
	private clearance: ClearanceManager;
	private audit: AuditLogger;

	constructor(config: ExecutorConfig) {
		this.cortex = config.cortex;
		this.protocols = config.protocols;
		this.clearance = config.clearance;
		this.audit = config.audit;
	}

	async execute(rhythm: Rhythm): Promise<ExecutionResult> {
		if (rhythm.clearance.length > 0) {
			const check = this.clearance.checkAll(rhythm.clearance);
			if (!check.granted) {
				return {
					status: "failure",
					error: `Clearance denied: ${check.reason ?? "insufficient permissions"}`,
				};
			}
		}

		try {
			switch (rhythm.action.type) {
				case "prompt":
					return await this.executePrompt(rhythm);
				case "tool":
					return await this.executeTool(rhythm);
				case "protocol":
					return await this.executeProtocol(rhythm);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { status: "failure", error: message };
		}
	}

	private async executePrompt(rhythm: Rhythm): Promise<ExecutionResult> {
		if (rhythm.action.type !== "prompt") throw new Error("Not a prompt action");
		const response = await this.cortex.chat(rhythm.action.prompt);
		this.audit.log({
			action: "arc-rhythm:prompt",
			target: rhythm.id,
			detail: `Rhythm "${rhythm.name}" prompt executed`,
		});
		return { status: "success", result: response };
	}

	private async executeTool(rhythm: Rhythm): Promise<ExecutionResult> {
		if (rhythm.action.type !== "tool") throw new Error("Not a tool action");
		const toolName = rhythm.action.tool;
		const tool = this.cortex.availableTools.find((t) => t.name === toolName);

		if (!tool) {
			return {
				status: "failure",
				error: `Tool not found: ${toolName}`,
			};
		}

		const context = this.buildToolContext();
		const result = await tool.execute(
			rhythm.action.args ?? {},
			context,
		);

		this.audit.log({
			action: "arc-rhythm:tool",
			target: rhythm.id,
			detail: `Rhythm "${rhythm.name}" tool "${toolName}" executed`,
		});

		return { status: "success", result: result.output };
	}

	private async executeProtocol(rhythm: Rhythm): Promise<ExecutionResult> {
		if (rhythm.action.type !== "protocol") throw new Error("Not a protocol action");
		const protoName = rhythm.action.protocol;
		const protocol = this.protocols.get(protoName);

		if (!protocol) {
			return {
				status: "failure",
				error: `Protocol not found: ${protoName}`,
			};
		}

		const context = this.buildProtocolContext();
		const result = await protocol.execute(
			rhythm.action.args ?? { rawArgs: "" },
			context,
		);

		this.audit.log({
			action: "arc-rhythm:protocol",
			target: rhythm.id,
			detail: `Rhythm "${rhythm.name}" protocol "${protoName}" executed`,
		});

		return { status: "success", result: result.summary };
	}

	private buildToolContext(): ToolContext {
		return {
			workingDirectory: process.cwd(),
			audit: this.audit,
			signal: { emit: async () => {} },
			memory: {
				get: async () => undefined,
				set: async () => {},
				delete: async () => {},
				list: async () => [],
			},
		};
	}

	private buildProtocolContext(): ProtocolContext {
		return {
			...this.buildToolContext(),
			tools: new Map(
				this.cortex.availableTools.map((t) => [t.name, t]),
			),
		};
	}
}
