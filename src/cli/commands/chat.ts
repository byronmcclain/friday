import type { Command } from "commander";
import {
	checkSingletonSocket,
	DEFAULT_SOCKET_PATH,
} from "../../server/socket.ts";

export function chatCommand(program: Command): void {
	program
		.command("chat")
		.description("Start an interactive chat session with Friday")
		.action(async function (this: Command) {
			const singletonAvailable = await checkSingletonSocket();

			if (!singletonAvailable) {
				console.error(
					"Friday server is not running.\n\n  friday serve &    # start server in background\n  friday chat       # then connect\n",
				);
				process.exit(1);
			}

			const { launchTui } = await import("../tui/app.tsx");
			await launchTui({
				socketPath: DEFAULT_SOCKET_PATH,
			});
		});
}
