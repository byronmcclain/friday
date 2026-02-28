import type { Command } from "commander";
import { DEFAULT_PROVIDER } from "../../providers/index.ts";
import {
	checkSingletonSocket,
	DEFAULT_SOCKET_PATH,
} from "../../server/socket.ts";

export function chatCommand(program: Command): void {
	program
		.command("chat")
		.description("Start an interactive chat session with Friday")
		.option(
			"-p, --provider <provider>",
			"LLM provider to use (anthropic, grok)",
			DEFAULT_PROVIDER,
		)
		.option(
			"-m, --model <model>",
			"Model to use (defaults per provider)",
		)
		.option(
			"--fast-model <model>",
			"Fast model for utility tasks (summarization, knowledge extraction)",
		)
		.option(
			"--fresh",
			"Start a fresh session without loading previous conversation",
		)
		.action(async function (this: Command, options) {
			const globalOpts = this.optsWithGlobals();
			const singletonAvailable = await checkSingletonSocket();
			const { launchTui } = await import("../tui/app.tsx");
			await launchTui({
				provider: options.provider,
				model: options.model,
				fastModel: options.fastModel,
				fresh: options.fresh,
				debug: globalOpts.debug,
				socketPath: singletonAvailable
					? DEFAULT_SOCKET_PATH
					: undefined,
			});
		});
}
