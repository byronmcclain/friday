import type { FridayModule } from "../types.ts";
import { forgePropose } from "./propose.ts";
import { forgeApply } from "./apply.ts";
import { forgeValidate } from "./validate.ts";
import { forgeRestart } from "./restart.ts";
import { forgeStatus } from "./status.ts";

const forgeModule = {
	name: "forge",
	description:
		"The Forge — Friday's self-improvement system. Create new modules, patch existing ones, validate, and restart to load changes.",
	version: "1.0.0",
	tools: [forgePropose, forgeApply, forgeValidate, forgeRestart, forgeStatus],
	protocols: [],
	knowledge: [],
	triggers: [],
	clearance: [
		"write-fs",
		"read-fs",
		"exec-shell",
		"system",
		"forge-modify",
	],
} satisfies FridayModule;

export default forgeModule;
