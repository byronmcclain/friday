import type { FridayModule } from "../types.ts";
import { codeEval } from "./eval.ts";
import { codeRunFile } from "./run-file.ts";

const codeExecModule = {
	name: "code-exec",
	description:
		"Code execution sandbox — evaluate code snippets or run existing source files with automatic runtime detection.",
	version: "1.0.0",
	tools: [codeEval, codeRunFile],
	protocols: [],
	knowledge: [],
	triggers: ["test:passed", "test:failed"],
	clearance: ["exec-shell", "read-fs"],
} satisfies FridayModule;

export default codeExecModule;
