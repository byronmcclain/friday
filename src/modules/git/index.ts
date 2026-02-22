import type { FridayModule } from "../types.ts";
import { gitBranch } from "./branch.ts";
import { gitCommit } from "./commit.ts";
import { gitDiff } from "./diff.ts";
import { gitLog } from "./log.ts";
import { gitPull } from "./pull.ts";
import { gitPush } from "./push.ts";
import { gitStash } from "./stash.ts";
import { gitStatus } from "./status.ts";

const gitModule = {
	name: "git",
	description:
		"Git version control operations — status, diff, log, commit, push, pull, branch management, and stash.",
	version: "1.0.0",
	tools: [gitStatus, gitDiff, gitLog, gitCommit, gitPush, gitPull, gitBranch, gitStash],
	protocols: [],
	knowledge: [],
	triggers: ["command:pre-commit"],
	clearance: ["git-read", "git-write", "network"],
} satisfies FridayModule;

export default gitModule;
