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

export function serveCommand(program: Command): void {
	program
		.command("serve")
		.description("Start the Friday web UI server")
		.option("--port <port>", "Port to listen on", "3000")
		.option("-m, --model <model>", "Override reasoning model")
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
					model: options.model,
					smartsDir: resolve(projectRoot, "smarts"),
					dataDir: resolve(projectRoot, "data"),
					modulesDir: resolve(projectRoot, "src/modules"),
					debug: globalOpts.debug,
				},
			});

			// Start Unix socket server for IPC
			await mkdir(`${homedir()}/.friday`, { recursive: true });
			const socketServer = new FridaySocketServer(result.runtime, result.hub);
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

			let shuttingDown = false;
			const shutdown = async () => {
				if (shuttingDown) return;
				shuttingDown = true;

				// Hard timeout — if graceful shutdown hangs, force exit
				const forceExit = setTimeout(() => {
					console.error(chalk.red("\nShutdown timed out — forcing exit"));
					process.exit(1);
				}, 15_000);
				forceExit.unref();

				try {
					console.log(chalk.hex("#8B6914")("\nShutting down server..."));
					if (ttydProc) {
						ttydProc.kill();
					}
					await socketServer.stop();
					await result.hub.saveIfActive();
					if (result.runtime.isBooted) {
						await result.runtime.shutdown();
					}
					result.server.stop(true);
				} catch (err) {
					console.warn(chalk.yellow("Shutdown error:"), err instanceof Error ? err.message : err);
				} finally {
					process.exit(0);
				}
			};
			process.on("SIGINT", () => void shutdown());
			process.on("SIGTERM", () => void shutdown());
		});
}
