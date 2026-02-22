import type { FridayModule } from "../types.ts";
import { webFetch } from "./fetch.ts";
import { webSearch } from "./search.ts";

const webFetchModule = {
	name: "web-fetch",
	description:
		"Web data retrieval — HTTP fetch for APIs and web pages, plus web search for fresh information.",
	version: "1.0.0",
	tools: [webFetch, webSearch],
	protocols: [],
	knowledge: [],
	triggers: [],
	clearance: ["network"],
} satisfies FridayModule;

export default webFetchModule;
