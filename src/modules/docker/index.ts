import type { FridayModule } from "../types.ts";
import { dockerBuild } from "./build.ts";
import { dockerLogs } from "./logs.ts";
import { dockerPs } from "./ps.ts";
import { dockerRun } from "./run.ts";
import { dockerStop } from "./stop.ts";

const dockerModule = {
	name: "docker",
	description:
		"Docker container management — list, build, run, stop, and view logs for containers.",
	version: "1.0.0",
	tools: [dockerPs, dockerBuild, dockerRun, dockerStop, dockerLogs],
	protocols: [],
	knowledge: [],
	triggers: ["custom:container-down"],
	clearance: ["exec-shell", "network"],
} satisfies FridayModule;

export default dockerModule;
