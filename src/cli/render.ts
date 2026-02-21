import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

marked.use(
  markedTerminal({
    firstHeading: chalk.cyan.bold.underline,
    heading: chalk.cyan.bold,
    codespan: chalk.yellow,
    tab: 2,
  }),
);

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return marked.parse(text) as string;
}
