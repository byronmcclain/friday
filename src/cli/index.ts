import { Command } from "commander";
import chalk from "chalk";
import boxen from "boxen";
import { version, description } from "../../package.json";
import { chatCommand } from "./commands/chat.ts";

const program = new Command();

program
  .name("friday")
  .description(description)
  .version(version)
  .hook("preAction", () => {
    console.log(
      boxen(chalk.cyan.bold("F.R.I.D.A.Y.") + "\n" + chalk.dim("Female Replacement Intelligent Digital Assistant Youth"), {
        padding: 1,
        borderColor: "cyan",
        borderStyle: "round",
      })
    );
  });

// Register commands
chatCommand(program);

// Default action: start interactive chat
program.action(async () => {
  const chat = program.commands.find((cmd) => cmd.name() === "chat");
  if (chat) {
    await chat.parseAsync([], { from: "user" });
  }
});

export { program };
