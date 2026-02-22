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
	// Shadow copy of input value for suggestion filtering — the <input>
	// element owns its own buffer; we never push value back via props.
	const [shadow, setShadow] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	// Bumped to remount <input> with a new initialValue (suggestion accept, submit clear)
	const [inputKey, setInputKey] = useState(0);
	// Holds the initialValue for the next <input> mount
	const nextValueRef = useRef("");
	const shadowRef = useRef(shadow);
	shadowRef.current = shadow;

	const suggestions =
		shadow.startsWith("/") && !shadow.includes(" ")
			? filterCommands(commands, shadow.slice(1)).slice(
					0,
					MAX_SUGGESTIONS,
				)
			: [];
	const hasSuggestions = suggestions.length > 0;

	// Track what the user types — only for suggestion filtering, never pushed back
	const handleInput = useCallback((value: string) => {
		setShadow(value);
		setSelectedIndex(0);
	}, []);

	// Programmatically replace input content by remounting with new initialValue
	const replaceInput = useCallback((value: string) => {
		nextValueRef.current = value;
		setShadow(value);
		setInputKey((k) => k + 1);
	}, []);

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
					replaceInput(`/${selected.name} `);
					setSelectedIndex(0);
				}
				return;
			}
			const trimmed = shadowRef.current.trim();
			if (trimmed.length > 0) {
				onSubmit(trimmed);
				replaceInput("");
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

		// Tab — accept selected suggestion
		if (key.name === "tab" && hasSuggestions) {
			key.preventDefault();
			const selected = suggestions[selectedIndex];
			if (selected) {
				replaceInput(`/${selected.name} `);
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
			{/* Input field — no value prop; input owns its own buffer */}
			<box flexDirection="row" gap={1}>
				<text fg={PALETTE.amberGlow} attributes={BOLD}>
					{"You >"}
				</text>
				<input
					key={inputKey}
					placeholder={placeholder}
					value={nextValueRef.current}
					onInput={handleInput}
					focused={!disabled}
					flexGrow={1}
				/>
			</box>
		</box>
	);
}
