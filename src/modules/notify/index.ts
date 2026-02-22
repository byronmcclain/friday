import type { FridayModule } from "../types.ts";
import { notifySend } from "./send.ts";

const notifyModule = {
	name: "notify",
	description:
		"Multi-channel notifications — send alerts via Slack webhooks, generic webhooks, or email relay. Integrates with directives for automated alerting.",
	version: "1.0.0",
	tools: [notifySend],
	protocols: [],
	knowledge: [],
	triggers: ["error:unhandled"],
	clearance: ["network"],
} satisfies FridayModule;

export default notifyModule;
