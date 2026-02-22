import { useState, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { createTextAttributes } from "@opentui/core";
import { PALETTE } from "../theme.ts";
import { filterCommands, type TypeaheadEntry } from "../filter-commands.ts";

const BOLD = createTextAttributes({ bold: true });
const MAX_SUGGESTIONS = 6;

interface CommandTypeaheadProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
}

export function CommandTypeahead({
	commands,
	disabled,
	placeholder,
	onSubmit,
	onExit,
}: CommandTypeaheadProps) {
	const [input, setInput] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef(input);
	inputRef.current = input;

	const suggestions =
		input.startsWith("/") && !input.includes(" ")
			? filterCommands(commands, input.slice(1)).slice(0, MAX_SUGGESTIONS)
			: [];
	const hasSuggestions = suggestions.length > 0;

	// Handle text changes from the input element
	const handleInput = useCallback((value: string) => {
		setInput(value);
		setSelectedIndex(0);
	}, []);

	// All keyboard shortcuts handled here to avoid onSubmit type conflict
	// between React DOM's SubmitEvent and OpenTUI's string callback
	useKeyboard((key) => {
		if (disabled) return;

		// Ctrl+C — exit
		if (key.ctrl && key.name === "c") {
			key.preventDefault();
			onExit();
			return;
		}

		// Enter — accept suggestion or submit input
		if (key.name === "return") {
			key.preventDefault();
			if (hasSuggestions) {
				const selected = suggestions[selectedIndex];
				if (selected) {
					setInput(`/${selected.name} `);
					setSelectedIndex(0);
				}
				return;
			}
			const trimmed = inputRef.current.trim();
			if (trimmed.length > 0) {
				onSubmit(trimmed);
				setInput("");
				setSelectedIndex(0);
			}
			return;
		}

		// Up/Down — navigate suggestions
		if (key.name === "up" && hasSuggestions) {
			key.preventDefault();
			setSelectedIndex((i) =>
				i <= 0 ? suggestions.length - 1 : i - 1,
			);
			return;
		}
		if (key.name === "down" && hasSuggestions) {
			key.preventDefault();
			setSelectedIndex((i) =>
				i >= suggestions.length - 1 ? 0 : i + 1,
			);
			return;
		}

		// Tab — accept selected suggestion
		if (key.name === "tab" && hasSuggestions) {
			key.preventDefault();
			const selected = suggestions[selectedIndex];
			if (selected) {
				setInput(`/${selected.name} `);
				setSelectedIndex(0);
			}
			return;
		}

		// Escape — dismiss suggestions (reset index)
		if (key.name === "escape") {
			setSelectedIndex(0);
			return;
		}
	});

	return (
		<box flexDirection="column">
			{/* Suggestion dropdown — renders above input */}
			{hasSuggestions && (
				<box
					flexDirection="column"
					border
					borderStyle="rounded"
					borderColor={PALETTE.copperAccent}
					backgroundColor={PALETTE.surface}
				>
					{suggestions.map((entry, i) => (
						<box
							key={entry.name}
							backgroundColor={
								i === selectedIndex
									? PALETTE.amberDim
									: undefined
							}
							paddingLeft={1}
							paddingRight={1}
						>
							<text
								fg={
									i === selectedIndex
										? PALETTE.amberGlow
										: PALETTE.amberPrimary
								}
							>
								{`/${entry.name}`}
							</text>
							<text fg={PALETTE.textMuted}>
								{`  ${entry.description}`}
							</text>
						</box>
					))}
				</box>
			)}
			{/* Input field */}
			<box flexDirection="row" gap={1}>
				<text fg={PALETTE.amberGlow} attributes={BOLD}>
					{"You >"}
				</text>
				<input
					placeholder={placeholder}
					value={input}
					onInput={handleInput}
					focused={!disabled}
				/>
			</box>
		</box>
	);
}
