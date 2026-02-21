import { type Token, marked } from "marked";
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

// Fix marked-terminal bug: text renderer returns raw string instead of
// processing inline tokens, breaking bold/italic inside tight list items.
marked.use({
  renderer: {
    text(token: { tokens?: Token[]; text: string } | string) {
      if (typeof token === "object" && token.tokens) {
        return this.parser.parseInline(token.tokens);
      }
      return typeof token === "object" ? token.text : token;
    },
  },
});

function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length);
  if (indents.length === 0) return text;
  const minIndent = Math.min(...indents);
  if (minIndent === 0) return text;
  return lines.map((line) => line.slice(minIndent)).join("\n");
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  return marked.parse(dedent(text)) as string;
}
