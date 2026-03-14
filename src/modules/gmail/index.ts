import type { FridayModule, ModuleContext } from "../types.ts";
import { gmailSearch } from "./tools/search.ts";
import { gmailRead } from "./tools/read.ts";
import { gmailSend } from "./tools/send.ts";
import { gmailReply } from "./tools/reply.ts";
import { gmailModify } from "./tools/modify.ts";
import { gmailListLabels } from "./tools/labels.ts";
import { gmailProtocol } from "./protocol.ts";
import { GmailAuth } from "./auth.ts";
import { GmailClient } from "./client.ts";
import { SecretStore } from "../../core/secrets.ts";
import { setGmailClient, setGmailAuth } from "./state.ts";

const gmailModule = {
	name: "gmail",
	description:
		"Gmail integration — read, search, send, reply, and organize Friday's email account via the Gmail API.",
	version: "1.0.0",
	tools: [
		gmailSearch,
		gmailRead,
		gmailSend,
		gmailReply,
		gmailModify,
		gmailListLabels,
	],
	protocols: [gmailProtocol],
	knowledge: [],
	triggers: ["custom:gmail-auth-expired"],
	clearance: ["network", "email-send"],

	async onLoad(context: ModuleContext) {
		const clientId = process.env.GOOGLE_CLIENT_ID;
		const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			console.warn(
				"[Gmail] GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not set — Gmail module inactive.",
			);
			return;
		}

		const secrets = new SecretStore(context.memory);
		const auth = new GmailAuth(secrets, clientId, clientSecret);
		setGmailAuth(auth);

		const client = new GmailClient(auth);
		const initialized = await client.initialize();

		if (initialized) {
			setGmailClient(client);
			console.log("[Gmail] Authenticated and ready.");
		} else {
			console.log(
				"[Gmail] Not authenticated. Run /gmail auth to set up.",
			);
		}
	},

	async onUnload() {
		setGmailClient(null);
		setGmailAuth(null);
	},
} satisfies FridayModule;

export default gmailModule;
