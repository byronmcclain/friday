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
	// Track input value for suggestion filtering only — let <input> own its buffer
	const [displayValue, setDisplayValue] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	// Incremented to force <input> to accept a programmatic value change
	const [valueVersion, setValueVersion] = useState(0);
	const displayRef = useRef(displayValue);
	displayRef.current = displayValue;

	const suggestions =
		displayValue.startsWith("/") && !displayValue.includes(" ")
			? filterCommands(commands, displayValue.slice(1)).slice(
					0,
					MAX_SUGGESTIONS,
				)
			: [];
	const hasSuggestions = suggestions.length > 0;

	// Sync from <input>'s internal buffer — fires on every keystroke
	const handleInput = useCallback((value: string) => {
		setDisplayValue(value);
		setSelectedIndex(0);
	}, []);

	// Push a programmatic value into the input and bump version
	const pushValue = useCallback((value: string) => {
		setDisplayValue(value);
		setValueVersion((v) => v + 1);
	}, []);

	// Only intercept specific keys — let everything else flow to <input> unimpeded
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
					pushValue(`/${selected.name} `);
					setSelectedIndex(0);
				}
				return;
			}
			const trimmed = displayRef.current.trim();
			if (trimmed.length > 0) {
				onSubmit(trimmed);
				pushValue("");
				setSelectedIndex(0);
			}
			return;
		}

		// Up/Down — only intercept when suggestions are visible
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

		// Tab — accept selected suggestion (only when suggestions visible)
		if (key.name === "tab" && hasSuggestions) {
			key.preventDefault();
			const selected = suggestions[selectedIndex];
			if (selected) {
				pushValue(`/${selected.name} `);
				setSelectedIndex(0);
			}
			return;
		}

		// Escape — dismiss suggestions only when showing
		if (key.name === "escape" && hasSuggestions) {
			key.preventDefault();
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
					key={valueVersion}
					placeholder={placeholder}
					value={displayValue}
					onInput={handleInput}
					focused={!disabled}
				/>
			</box>
		</box>
	);
}
