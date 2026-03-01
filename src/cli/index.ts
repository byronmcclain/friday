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
  .hook("preAction", (_thisCmd, actionCmd) => {
    if (bannerShown) return;
    // serve command prints its own consolidated banner with server info
    if (actionCmd.name() === "serve") return;
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
// Global options (--debug) are already parsed on `program` and accessible
// via optsWithGlobals() in the chat action — no need to forward through args.
program.action(async () => {
  const chat = program.commands.find((cmd) => cmd.name() === "chat");
  if (chat) {
    await chat.parseAsync([], { from: "user" });
  }
});

export { program };
