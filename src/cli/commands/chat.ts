import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FridayRuntime } from "../../core/runtime.ts";
import type { ProviderName } from "../../core/types.ts";
import { DEFAULT_PROVIDER } from "../../providers/index.ts";
import { renderMarkdown } from "../render.ts";
import {
	typeaheadPrompt,
	type TypeaheadEntry,
} from "../typeahead-prompt.ts";

export function chatCommand(program: Command): void {
	program
		.command("chat")
		.description("Start an interactive chat session with Friday")
		.option(
			"-p, --provider <provider>",
			"LLM provider to use (anthropic, grok)",
			DEFAULT_PROVIDER,
		)
		.option("-m, --model <model>", "Model to use (defaults per provider)")
		.option("--fresh", "Start a fresh session without loading previous conversation")
		.action(async (options) => {
			const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
			const runtime = new FridayRuntime();
			try {
				await runtime.boot({
					provider: options.provider as ProviderName,
					model: options.model,
					smartsDir: resolve(projectRoot, "smarts"),
					dataDir: resolve(projectRoot, "data"),
					modulesDir: resolve(projectRoot, "src/modules"),
					forgeDir: resolve(projectRoot, "forge"),
					fresh: options.fresh,
				});
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red(`\n${error.message}\n`));
				}
				process.exit(1);
			}

			let shuttingDown = false;
			const shutdownWithSpinner = async () => {
				const spinner = ora({
					text: chalk.dim("Shutting down..."),
					spinner: "dots",
				}).start();
				try {
					await runtime.shutdown((_step, label) => {
						spinner.text = chalk.dim(label);
					});
					spinner.succeed(chalk.dim("Shutdown complete"));
				} catch (error) {
					spinner.fail(chalk.red("Shutdown failed"));
					if (error instanceof Error) {
						console.error(chalk.red(`  ${error.message}`));
					}
				}
			};

			const gracefulShutdown = async () => {
				if (shuttingDown) return;
				shuttingDown = true;
				console.log(); // newline after ^C
				await shutdownWithSpinner();
				process.exit(0);
			};
			process.on("SIGINT", gracefulShutdown);
			process.on("SIGTERM", gracefulShutdown);

			const providerLabel = chalk.dim(
				`(${runtime.cortex.providerName}: ${runtime.cortex.modelName})`,
			);
			console.log(
				chalk.cyan(
					`\nHey boss! What can I help you with? ${providerLabel}\n`,
				),
			);
			if (!process.stdin.isTTY) {
				console.error(chalk.red("Interactive chat requires a TTY. Use piped input with 'friday process' instead."));
				try {
					await runtime.shutdown();
				} catch {
					// best-effort cleanup
				}
				process.exit(1);
			}

			console.log(
				chalk.dim(
					"Type 'exit' or 'quit' to end the session. Use /command for protocols.\n",
				),
			);

			const commands: TypeaheadEntry[] = runtime.protocols
				.list()
				.map((p) => ({
					name: p.name,
					description: p.description,
					aliases: p.aliases,
				}));

			while (true) {
				const message = await typeaheadPrompt({
					prompt: chalk.green("You >"),
					commands,
				});

				if (
					["exit", "quit", "bye"].includes(message.toLowerCase().trim())
				) {
					shuttingDown = true;
					await shutdownWithSpinner();
					console.log(chalk.cyan("\nSee you later, boss! \u{1F44B}\n"));
					break;
				}

				const spinner = ora({
					text: chalk.dim("Friday is thinking..."),
					spinner: "dots",
				}).start();

				try {
					const result = await runtime.process(message);
					spinner.stop();
					console.log(`\n${renderMarkdown(result.output)}`);

					// Check if forge requested a restart
					if (runtime.restartRequested) {
						console.log(chalk.cyan("\nForge restart requested. Rebooting subsystems...\n"));
						const restartSpinner = ora({
							text: chalk.dim("Restarting..."),
							spinner: "dots",
						}).start();

						try {
							await runtime.shutdown((_step, label) => {
								restartSpinner.text = chalk.dim(label);
							});
							runtime.restartRequested = false;
							await runtime.boot({
								provider: options.provider as ProviderName,
								model: options.model,
								smartsDir: resolve(projectRoot, "smarts"),
								dataDir: resolve(projectRoot, "data"),
								modulesDir: resolve(projectRoot, "src/modules"),
								forgeDir: resolve(projectRoot, "forge"),
								fresh: false,
							});
							restartSpinner.succeed(chalk.dim("Restart complete"));

							const health = runtime.forgeHealthReport;
							if (health) {
								if (health.loaded.length > 0) {
									console.log(chalk.green(`  Forge modules loaded: ${health.loaded.join(", ")}`));
								}
								for (const f of health.failed) {
									console.log(chalk.red(`  Forge module failed: ${f.name} — ${f.error}`));
								}
							}
							console.log();
						} catch (error) {
							restartSpinner.fail(chalk.red("Restart failed"));
							if (error instanceof Error) {
								console.error(chalk.red(`  ${error.message}\n`));
							}
						}
					}
				} catch (error) {
					spinner.fail(chalk.red("Something went wrong"));
					if (error instanceof Error) {
						console.error(chalk.red(`Error: ${error.message}\n`));
					}
				}
			}
		});
}
