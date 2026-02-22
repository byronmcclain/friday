import type { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { resolve } from "node:path";
import { createFridayServer } from "../../server/index.ts";
import type { ProviderName } from "../../core/types.ts";
import { DEFAULT_PROVIDER } from "../../providers/index.ts";

export function serveCommand(program: Command): void {
	program
		.command("serve")
		.description("Start the Friday web UI server")
		.option("--port <port>", "Port to listen on", "3000")
		.option(
			"-p, --provider <provider>",
			"Default LLM provider (anthropic, grok)",
			DEFAULT_PROVIDER,
		)
		.option("-m, --model <model>", "Default model (defaults per provider)")
		.action(async (options) => {
			const port = Number.parseInt(options.port, 10);
			if (Number.isNaN(port) || port < 1 || port > 65535) {
				console.error(chalk.red("Invalid port number"));
				process.exit(1);
			}

			const server = createFridayServer({
				port,
				staticDir: resolve("web/dist"),
				runtimeConfig: {
					provider: options.provider as ProviderName,
					model: options.model,
					smartsDir: resolve("smarts"),
					dataDir: resolve("data"),
				},
			});

			console.log(
				boxen(
					`${chalk.cyan.bold("F.R.I.D.A.Y. Web UI")}\n${chalk.dim(`http://localhost:${server.port}`)}`,
					{ padding: 1, borderColor: "cyan", borderStyle: "round" },
				),
			);

			process.on("SIGINT", () => {
				console.log(chalk.dim("\nShutting down server..."));
				server.stop(true);
				process.exit(0);
			});
		});
}
