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
			// Import path assumes forge/ directory is at the project root
			content: `import type { FridayModule } from "../../src/modules/types.ts";

const ${toolName}Module: FridayModule = {
  name: ${JSON.stringify(moduleName)},
  description: ${JSON.stringify(description)},
  version: "1.0.0",
  tools: [],
  protocols: [],
  knowledge: [],
  triggers: [],
  clearance: [],
};

export default ${toolName}Module;
`,
		},
	];
}

export const forgePropose: FridayTool = {
	name: "forge_propose",
	description:
		"Generate code for a new module or a patch to an existing forge module. Returns the proposed code as a preview — does NOT write to disk. The user must approve before forge_apply writes it.",
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
		{
			name: "files",
			type: "array",
			description:
				'For LLM-generated proposals: array of {path, content} objects. If omitted, a template is generated for "create" action.',
			required: false,
		},
	],
	clearance: ["provider"],

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
