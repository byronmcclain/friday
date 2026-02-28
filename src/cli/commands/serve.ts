import type { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { createFridayServer } from "../../server/index.ts";
import { FridaySocketServer } from "../../server/socket.ts";
import { spawnTtyd } from "../../server/ttyd.ts";
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
		.action(async function (this: Command, options) {
			const globalOpts = this.optsWithGlobals();
			const port = Number.parseInt(options.port, 10);
			if (Number.isNaN(port) || port < 1 || port > 65535) {
				console.error(chalk.red("Invalid port number"));
				process.exit(1);
			}

			const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
			const result = await createFridayServer({
				port,
				staticDir: resolve(projectRoot, "web/dist"),
				runtimeConfig: {
					provider: options.provider as ProviderName,
					model: options.model,
					smartsDir: resolve(projectRoot, "smarts"),
					dataDir: resolve(projectRoot, "data"),
					modulesDir: resolve(projectRoot, "src/modules"),
					debug: globalOpts.debug,
				},
			});

			// Start Unix socket server for IPC
			await mkdir(`${homedir()}/.friday`, { recursive: true });
			const socketServer = new FridaySocketServer(result.runtime);
			await socketServer.start();

			// Spawn ttyd for terminal-in-browser
			const ttydProc = await spawnTtyd({
				port: 7681,
				basePath: "/terminal",
				command: ["friday", "chat"],
			});

			console.log(
				boxen(
					`${chalk.hex("#F0A030").bold("F.R.I.D.A.Y. Web UI")}\n${chalk.hex("#8B6914")(`http://localhost:${result.server.port}`)}\n${chalk.hex("#8B6914")("IPC socket: ~/.friday/friday.sock")}${ttydProc ? `\n${chalk.hex("#8B6914")("Terminal: http://localhost:7681/terminal/")}` : ""}`,
					{ padding: 1, borderColor: "#C07020", borderStyle: "round" },
				),
			);

			const shutdown = async () => {
				console.log(chalk.hex("#8B6914")("\nShutting down server..."));
				if (ttydProc) {
					ttydProc.kill();
				}
				await socketServer.stop();
				if (result.runtime.isBooted) {
					await result.runtime.shutdown();
				}
				result.server.stop(true);
				await new Promise((r) => setTimeout(r, 1000));
				process.exit(0);
			};
			process.on("SIGINT", () => void shutdown());
			process.on("SIGTERM", () => void shutdown());
		});
}
