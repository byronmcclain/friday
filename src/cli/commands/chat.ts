import type { Command } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import { FridayRuntime } from "../../core/runtime.ts";
import type { ProviderName } from "../../core/types.ts";

export function chatCommand(program: Command): void {
	program
		.command("chat")
		.description("Start an interactive chat session with Friday")
		.option(
			"-p, --provider <provider>",
			"LLM provider to use (anthropic, grok)",
			"anthropic",
		)
		.option("-m, --model <model>", "Model to use (defaults per provider)")
		.action(async (options) => {
			const runtime = new FridayRuntime();
			try {
				await runtime.boot({
					provider: options.provider as ProviderName,
					model: options.model,
				});
			} catch (error) {
				if (error instanceof Error) {
					console.error(chalk.red(`\n${error.message}\n`));
				}
				process.exit(1);
			}

			const providerLabel = chalk.dim(
				`(${runtime.cortex.providerName}: ${runtime.cortex.modelName})`,
			);
			console.log(
				chalk.cyan(
					`\nHey boss! What can I help you with? ${providerLabel}\n`,
				),
			);
			console.log(
				chalk.dim(
					"Type 'exit' or 'quit' to end the session. Use /command for protocols.\n",
				),
			);

			while (true) {
				const { message } = await inquirer.prompt<{ message: string }>([
					{
						type: "input",
						name: "message",
						message: chalk.green("You >"),
						validate: (input: string) =>
							input.trim().length > 0 || "Please enter a message",
					},
				]);

				if (
					["exit", "quit", "bye"].includes(message.toLowerCase().trim())
				) {
					await runtime.shutdown();
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
					const prefix =
						result.source === "protocol"
							? chalk.magenta("Protocol >")
							: chalk.cyan("Friday >");
					console.log(`\n${prefix} ${result.output}\n`);
				} catch (error) {
					spinner.fail(chalk.red("Something went wrong"));
					if (error instanceof Error) {
						console.error(chalk.red(`Error: ${error.message}\n`));
					}
				}
			}
		});
}
