import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import type { ForgeProposal, ForgeFile } from "./types.ts";

function generateModuleTemplate(
	moduleName: string,
	description: string,
): ForgeFile[] {
	const toolName = moduleName.replace(/-/g, "_");
	return [
		{
			path: "index.ts",
			content: `import type { FridayModule, FridayTool, ToolContext, ToolResult } from "../../src/modules/types.ts";

// ToolContext has: { workingDirectory: string, audit, signal, memory }
// ToolResult must have: { success: boolean, output: string, error?: string, artifacts?: Record<string, unknown> }
// NOTE: ToolContext does NOT have a tools property — tools are standalone, use fetch() directly for HTTP
//
// Example tool:
//
// const myTool: FridayTool = {
//   name: "${toolName}.my_action",
//   description: "What this tool does",
//   parameters: [
//     { name: "input", type: "string", description: "The input", required: true },
//   ],
//   clearance: [],
//   async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
//     const input = args.input as string;
//     if (!input) return { success: false, output: "Missing required parameter: input" };
//     return { success: true, output: \`Result: \${input}\`, artifacts: { raw: input } };
//   },
// };

const ${toolName}Module = {
  name: ${JSON.stringify(moduleName)},
  description: ${JSON.stringify(description)},
  version: "1.0.0",
  tools: [],
  protocols: [],
  knowledge: [],
  triggers: [],
  clearance: [],
} satisfies FridayModule;

export default ${toolName}Module;
`,
		},
	];
}

export const forgePropose: FridayTool = {
	name: "forge_propose",
	description:
		"Create a skeleton module or register a patch proposal in the forge. For 'create': generates a template module with empty tools/protocols arrays — after forge_apply writes it to disk, use fs.write to add the actual implementation code to the module files. For 'patch': registers intent to modify an existing module — use fs.read to read current code, then fs.write to make changes, then forge_validate to check. Does NOT write to disk — use forge_apply with the returned proposalId to write.",
	parameters: [
		{
			name: "action",
			type: "string",
			description:
				'"create" for a new module or "patch" to modify an existing one',
			required: true,
		},
		{
			name: "moduleName",
			type: "string",
			description: "Name of the module to create or patch",
			required: true,
		},
		{
			name: "description",
			type: "string",
			description:
				"What the module should do (for create) or what to change (for patch)",
			required: true,
		},
	],
	clearance: [],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const action = args.action as string;
		const moduleName = args.moduleName as string;
		const description = args.description as string;

		if (!action || !["create", "patch"].includes(action)) {
			return {
				success: false,
				output:
					"Missing or invalid required parameter: action (must be 'create' or 'patch')",
			};
		}
		if (!moduleName) {
			return {
				success: false,
				output: "Missing required parameter: moduleName",
			};
		}
		if (/[/\\]/.test(moduleName) || moduleName.includes("..")) {
			return {
				success: false,
				output:
					"Invalid moduleName: must not contain path separators or '..'",
			};
		}
		if (!description) {
			return {
				success: false,
				output: "Missing required parameter: description",
			};
		}

		// files is hidden from the LLM schema but still accepted for programmatic
		// callers (tests, /forge protocol) that pass file content directly.
		let files: ForgeFile[];
		if (args.files) {
			if (!Array.isArray(args.files)) {
				return { success: false, output: "Parameter 'files' must be an array" };
			}
			for (const f of args.files) {
				if (
					typeof f !== "object" || f === null ||
					typeof (f as ForgeFile).path !== "string" ||
					typeof (f as ForgeFile).content !== "string"
				) {
					return {
						success: false,
						output: "Each file in 'files' must have 'path' (string) and 'content' (string)",
					};
				}
			}
			files = args.files as ForgeFile[];
		} else {
			files = generateModuleTemplate(moduleName, description);
		}

		const proposalId = crypto.randomUUID();
		const proposal: ForgeProposal = {
			id: proposalId,
			action: action as "create" | "patch",
			moduleName,
			description,
			files,
			createdAt: new Date().toISOString(),
		};

		await context.memory.set(`proposal:${proposalId}`, proposal);

		await context.audit.log({
			action: "forge:propose",
			source: "forge",
			detail: `Proposed ${action} for module "${moduleName}": ${files.length} file(s)`,
			success: true,
		});

		const fileList = files
			.map((f) => `--- ${moduleName}/${f.path} ---\n${f.content}`)
			.join("\n\n");

		return {
			success: true,
			output: `Proposal for ${action} of "${moduleName}":\n\n${fileList}\n\nProposal ID: ${proposalId}\nApprove this proposal, then use forge_apply to write it to disk.`,
			artifacts: {
				proposalId,
				moduleName,
				action,
				fileCount: files.length,
			},
		};
	},
};
