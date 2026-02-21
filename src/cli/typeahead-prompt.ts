import * as readline from "node:readline";
import chalk from "chalk";

export interface TypeaheadEntry {
	name: string;
	description: string;
	aliases: string[];
}

export interface TypeaheadPromptConfig {
	prompt: string;
	commands: TypeaheadEntry[];
}

const MAX_SUGGESTIONS = 6;

export function filterCommands(
	commands: TypeaheadEntry[],
	query: string,
): TypeaheadEntry[] {
	if (!query) return commands;
	const q = query.toLowerCase();
	return commands.filter(
		(cmd) =>
			cmd.name.toLowerCase().startsWith(q) ||
			cmd.aliases.some((a) => a.toLowerCase().startsWith(q)),
	);
}

export function formatSuggestionLine(
	entry: TypeaheadEntry,
	isSelected: boolean,
	maxWidth: number,
): string {
	const prefix = `  /${entry.name}`;
	const separator = " — ";
	const available = maxWidth - prefix.length - separator.length;
	const desc =
		available > 0
			? entry.description.length > available
				? `${entry.description.slice(0, available - 1)}…`
				: entry.description
			: "";

	if (isSelected) {
		const line = desc ? `${prefix}${separator}${desc}` : prefix;
		return chalk.bgCyan.black(line.padEnd(maxWidth));
	}
	const styledPrefix = chalk.cyan(prefix);
	return desc
		? `${styledPrefix}${chalk.dim(separator)}${chalk.dim(desc)}`
		: styledPrefix;
}

export function typeaheadPrompt(
	config: TypeaheadPromptConfig,
): Promise<string> {
	return new Promise((resolve) => {
		const { prompt, commands } = config;
		let input = "";
		let cursorPos = 0;
		let selectedIndex = 0;
		let renderedSuggestionLines = 0;

		function getSuggestions(): TypeaheadEntry[] {
			if (!input.startsWith("/")) return [];
			const query = input.slice(1).split(/\s+/)[0] ?? "";
			// Don't show suggestions if user has moved past the command name (typed a space)
			if (input.includes(" ")) return [];
			return filterCommands(commands, query).slice(0, MAX_SUGGESTIONS);
		}

		function getTermWidth(): number {
			return process.stdout.columns || 80;
		}

		function clearSuggestions(): void {
			if (renderedSuggestionLines <= 0) return;
			const width = getTermWidth();
			// Move down from cursor to clear each suggestion line
			for (let i = 0; i < renderedSuggestionLines; i++) {
				process.stdout.write("\n");
				process.stdout.write(" ".repeat(width));
			}
			// Move back up to the prompt line
			if (renderedSuggestionLines > 0) {
				process.stdout.write(`\x1b[${renderedSuggestionLines}A`);
			}
			process.stdout.write("\r");
			renderedSuggestionLines = 0;
		}

		function render(): void {
			const suggestions = getSuggestions();
			const width = getTermWidth();

			// Clear old suggestions first
			clearSuggestions();

			// Render the prompt line
			const promptDisplay = `${prompt} `;
			process.stdout.write(`\r\x1b[K${promptDisplay}${input}`);

			// Render suggestion panel
			if (suggestions.length > 0) {
				for (let i = 0; i < suggestions.length; i++) {
					const entry = suggestions[i] as TypeaheadEntry;
					const line = formatSuggestionLine(
						entry,
						i === selectedIndex,
						width,
					);
					process.stdout.write(`\n\x1b[K${line}`);
				}
				renderedSuggestionLines = suggestions.length;

				// Move cursor back up to the prompt line
				if (suggestions.length > 0) {
					process.stdout.write(`\x1b[${suggestions.length}A`);
				}
			}

			// Position cursor correctly on the prompt line
			const promptLen = stripAnsi(promptDisplay).length;
			const targetCol = promptLen + cursorPos;
			process.stdout.write(`\r\x1b[${targetCol + 1}G`);
		}

		function cleanup(): void {
			clearSuggestions();
			process.stdout.write("\r\x1b[K");
			process.stdin.removeListener("keypress", handleKeypress);
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(false);
			}
			process.stdin.pause();
		}

		function submit(value: string): void {
			cleanup();
			// Print the final line so it's visible in terminal history
			process.stdout.write(`${prompt} ${value}\n`);
			resolve(value);
		}

		function handleKeypress(
			str: string | undefined,
			key: readline.Key,
		): void {
			if (!key) return;

			const suggestions = getSuggestions();
			const hasSuggestions = suggestions.length > 0;

			// Ctrl+C — exit
			if (key.ctrl && key.name === "c") {
				cleanup();
				process.stdout.write("\n");
				process.exit(0);
			}

			// Enter — submit
			if (key.name === "return") {
				// If suggestions are visible and one is selected, fill it first
				if (hasSuggestions) {
					const selected = suggestions[selectedIndex];
					if (selected) {
						input = `/${selected.name} `;
						cursorPos = input.length;
					}
				}
				const value = input.trim();
				if (value.length > 0) {
					submit(value);
				}
				return;
			}

			// Tab — fill selected suggestion
			if (key.name === "tab") {
				if (hasSuggestions) {
					const selected = suggestions[selectedIndex];
					if (selected) {
						input = `/${selected.name} `;
						cursorPos = input.length;
						selectedIndex = 0;
					}
				}
				render();
				return;
			}

			// Escape — dismiss suggestions
			if (key.name === "escape") {
				selectedIndex = 0;
				render();
				return;
			}

			// Up arrow — navigate suggestions
			if (key.name === "up") {
				if (hasSuggestions) {
					selectedIndex =
						selectedIndex <= 0
							? suggestions.length - 1
							: selectedIndex - 1;
				}
				render();
				return;
			}

			// Down arrow — navigate suggestions
			if (key.name === "down") {
				if (hasSuggestions) {
					selectedIndex =
						selectedIndex >= suggestions.length - 1
							? 0
							: selectedIndex + 1;
				}
				render();
				return;
			}

			// Left arrow — move cursor
			if (key.name === "left") {
				if (cursorPos > 0) cursorPos--;
				render();
				return;
			}

			// Right arrow — move cursor
			if (key.name === "right") {
				if (cursorPos < input.length) cursorPos++;
				render();
				return;
			}

			// Home
			if (key.name === "home") {
				cursorPos = 0;
				render();
				return;
			}

			// End
			if (key.name === "end") {
				cursorPos = input.length;
				render();
				return;
			}

			// Backspace
			if (key.name === "backspace") {
				if (cursorPos > 0) {
					input =
						input.slice(0, cursorPos - 1) + input.slice(cursorPos);
					cursorPos--;
					selectedIndex = 0;
				}
				render();
				return;
			}

			// Delete
			if (key.name === "delete") {
				if (cursorPos < input.length) {
					input =
						input.slice(0, cursorPos) + input.slice(cursorPos + 1);
					selectedIndex = 0;
				}
				render();
				return;
			}

			// Ctrl+A — beginning of line
			if (key.ctrl && key.name === "a") {
				cursorPos = 0;
				render();
				return;
			}

			// Ctrl+E — end of line
			if (key.ctrl && key.name === "e") {
				cursorPos = input.length;
				render();
				return;
			}

			// Ctrl+U — clear line
			if (key.ctrl && key.name === "u") {
				input = "";
				cursorPos = 0;
				selectedIndex = 0;
				render();
				return;
			}

			// Ctrl+W — delete word backward
			if (key.ctrl && key.name === "w") {
				const before = input.slice(0, cursorPos);
				const after = input.slice(cursorPos);
				const trimmed = before.replace(/\S+\s*$/, "");
				input = trimmed + after;
				cursorPos = trimmed.length;
				selectedIndex = 0;
				render();
				return;
			}

			// Printable character
			if (str && str.length === 1 && !key.ctrl && !key.meta) {
				input =
					input.slice(0, cursorPos) + str + input.slice(cursorPos);
				cursorPos++;
				selectedIndex = 0;
				render();
			}
		}

		// Set up raw mode and start listening
		readline.emitKeypressEvents(process.stdin);
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
		}
		process.stdin.resume();
		process.stdin.on("keypress", handleKeypress);

		// Initial render
		render();
	});
}

function stripAnsi(str: string): string {
	return str.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape code stripping requires matching control characters
		/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
		"",
	);
}
