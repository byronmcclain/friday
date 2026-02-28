import type { Command } from "commander";
import chalk from "chalk";
import {
	resolveGenesisPath,
	loadGenesis,
	seedGenesis,
	updateGenesis,
	checkGenesis,
} from "../../core/genesis.ts";

export function genesisCommand(program: Command): void {
	const genesis = program
		.command("genesis")
		.description("Manage Friday's identity prompt (GENESIS.md)");

	genesis
		.command("show")
		.description("Display the current GENESIS.md content")
		.action(async () => {
			const path = resolveGenesisPath();
			try {
				const content = await loadGenesis(path);
				console.log(content);
			} catch (err) {
				console.error(
					chalk.red(err instanceof Error ? err.message : String(err)),
				);
				process.exit(1);
			}
		});

	genesis
		.command("path")
		.description("Print the resolved GENESIS.md file path")
		.action(() => {
			console.log(resolveGenesisPath());
		});

	genesis
		.command("init")
		.description(
			"Seed GENESIS.md from the built-in template (won't overwrite existing)",
		)
		.action(async () => {
			const path = resolveGenesisPath();
			const created = await seedGenesis(path);
			if (created) {
				console.log(chalk.green(`Created ${path}`));
				console.log(
					chalk.hex("#8B6914")("Edit with: friday genesis edit"),
				);
			} else {
				console.log(
					chalk.yellow(`${path} already exists — not overwriting`),
				);
			}
		});

	genesis
		.command("update")
		.description(
			"Overwrite GENESIS.md with the latest built-in template",
		)
		.action(async () => {
			const path = resolveGenesisPath();
			await updateGenesis(path);
			console.log(chalk.green(`Updated ${path} from built-in template`));
		});

	genesis
		.command("edit")
		.description("Open GENESIS.md in $EDITOR")
		.action(async () => {
			const path = resolveGenesisPath();
			const editor = process.env.EDITOR ?? "vi";
			const proc = Bun.spawn([editor, path], {
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			});
			await proc.exited;
		});

	genesis
		.command("check")
		.description(
			"Validate GENESIS.md exists, permissions are correct, and content is non-empty",
		)
		.action(async () => {
			const path = resolveGenesisPath();
			const result = await checkGenesis(path);
			if (result.ok) {
				console.log(chalk.green(`${path} — OK`));
			} else {
				console.log(chalk.red(`${path} — Issues found:`));
				for (const issue of result.issues ?? []) {
					console.log(chalk.red(`  - ${issue}`));
				}
				process.exit(1);
			}
		});
}
