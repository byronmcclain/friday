import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { version, description } from "../../package.json";
import { chatCommand } from "./commands/chat.ts";
import { serveCommand } from "./commands/serve.ts";
import { genesisCommand } from "./commands/genesis.ts";

const program = new Command();

let bannerShown = false;

program
  .name("friday")
  .description(description)
  .version(version)
  .option("--debug", "Enable debug prompt logging")
  .hook("preAction", () => {
    if (bannerShown) return;
    bannerShown = true;
    console.log(
      boxen(chalk.hex("#F0A030").bold("F.R.I.D.A.Y.") + "\n" + chalk.hex("#8B6914")("Female Replacement Intelligent Digital Assistant Youth"), {
        padding: 1,
        borderColor: "#C07020",
        borderStyle: "round",
      })
    );
  });

// Register commands
chatCommand(program);
serveCommand(program);
genesisCommand(program);

// Default action: start interactive chat
program.action(async () => {
  const chat = program.commands.find((cmd) => cmd.name() === "chat");
  if (chat) {
    const globalOpts = program.opts();
    const args: string[] = [];
    if (globalOpts.debug) args.push("--debug");
    await chat.parseAsync(args, { from: "user" });
  }
});

export { program };
