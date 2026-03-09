import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { PALETTE, BOLD, DIM } from "../theme.ts";
import { filterCommands, type TypeaheadEntry } from "../filter-commands.ts";
import { usePulse } from "../lib/use-pulse.ts";
import { lerpColor } from "../lib/color-utils.ts";

const MAX_SUGGESTIONS = 25;
const VISIBLE_ROWS = 10;
const MAX_HISTORY = 50;
const CHAR_WARN = 1000;
const CHAR_DANGER = 2000;

interface CommandTypeaheadProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
	isThinking: boolean;
	isStreaming: boolean;
}

interface PromptGlyphProps {
	isThinking: boolean;
	isStreaming: boolean;
	disabled: boolean;
}

function PromptGlyph({ isThinking, isStreaming, disabled }: PromptGlyphProps) {
	const pulse = usePulse(isThinking, 2000);

	// Thinking/streaming checked before disabled — when isThinking is true,
	// disabled is also true (input is locked), but the glyph should still
	// show the active thinking/streaming state rather than the idle circle.
	if (isThinking) {
		const fg = lerpColor(PALETTE.amberDim, PALETTE.amberGlow, pulse);
		return (
			<text fg={fg} attributes={BOLD}>
				{"◆"}
			</text>
		);
	}
	if (isStreaming) {
		return (
			<text fg={PALETTE.amberGlow} attributes={BOLD}>
				{"▸"}
			</text>
		);
	}
	if (disabled) {
		return <text fg={PALETTE.textMuted}>{"○"}</text>;
	}
	return (
		<text fg={PALETTE.amberPrimary} attributes={BOLD}>
			{"❯"}
		</text>
	);
}

export function CommandTypeahead({
	commands,
	disabled,
	placeholder,
	onSubmit,
	onExit,
	isThinking,
	isStreaming,
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
	const [suggestionsBlocked, setSuggestionsBlocked] = useState(false);
	const scrollRef = useRef<ScrollBoxRenderable>(null);

	// Scroll the suggestion list to keep the selected item visible
	useEffect(() => {
		scrollRef.current?.scrollTo(selectedIndex);
	}, [selectedIndex]);

	// Input history — in-memory ring buffer of past submissions
	const historyRef = useRef<string[]>([]);
	const historyIndexRef = useRef(-1);
	const savedCurrentRef = useRef("");

	const sortedCommands = useMemo(
		() => [...commands].sort((a, b) => a.name.localeCompare(b.name)),
		[commands],
	);
	const suggestions =
		!suggestionsBlocked && shadow.startsWith("/") && !shadow.includes(" ")
			? filterCommands(sortedCommands, shadow.slice(1)).slice(
					0,
					MAX_SUGGESTIONS,
				)
			: [];
	const hasSuggestions = suggestions.length > 0;

	// Track what the user types — only for suggestion filtering, never pushed back
	const handleInput = useCallback((value: string) => {
		setShadow(value);
		setSelectedIndex(0);
		setSuggestionsBlocked(false);
		historyIndexRef.current = -1;
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
				// Push to history (skip consecutive duplicates)
				if (historyRef.current[0] !== trimmed) {
					historyRef.current.unshift(trimmed);
					if (historyRef.current.length > MAX_HISTORY)
						historyRef.current.pop();
				}
				historyIndexRef.current = -1;
				onSubmit(trimmed);
				replaceInput("");
				setSelectedIndex(0);
			}
			return;
		}

		// Up — suggestion navigation or input history
		if (key.name === "up") {
			key.preventDefault();
			if (hasSuggestions) {
				setSelectedIndex((i) =>
					i <= 0 ? suggestions.length - 1 : i - 1,
				);
			} else if (historyRef.current.length > 0) {
				if (historyIndexRef.current === -1) {
					savedCurrentRef.current = shadowRef.current;
				}
				if (
					historyIndexRef.current <
					historyRef.current.length - 1
				) {
					historyIndexRef.current++;
					const entry =
						historyRef.current[historyIndexRef.current];
					if (entry !== undefined) replaceInput(entry);
				}
			}
			return;
		}

		// Down — suggestion navigation or input history
		if (key.name === "down") {
			key.preventDefault();
			if (hasSuggestions) {
				setSelectedIndex((i) =>
					i >= suggestions.length - 1 ? 0 : i + 1,
				);
			} else if (historyIndexRef.current >= 0) {
				if (historyIndexRef.current > 0) {
					historyIndexRef.current--;
					const entry =
						historyRef.current[historyIndexRef.current];
					if (entry !== undefined) replaceInput(entry);
				} else {
					historyIndexRef.current = -1;
					replaceInput(savedCurrentRef.current);
				}
			}
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
			setSuggestionsBlocked(true);
			return;
		}
	});

	// Character count and color
	const charCount = shadow.length;
	const charCountColor =
		charCount > CHAR_DANGER
			? PALETTE.error
			: charCount > CHAR_WARN
				? PALETTE.warning
				: PALETTE.textMuted;

	// Show hints when input is empty, enabled, and no suggestions visible
	const showHints = !disabled && charCount === 0 && !hasSuggestions;

	return (
		<box flexDirection="column" width="100%">
			{/* Suggestion dropdown — renders above input */}
			{hasSuggestions && (
				<box
					border
					borderStyle="rounded"
					borderColor={PALETTE.copperAccent}
					backgroundColor={PALETTE.surface}
					height={Math.min(suggestions.length, VISIBLE_ROWS) + 2}
				>
					<scrollbox
						ref={scrollRef}
						flexGrow={1}
						backgroundColor={PALETTE.surface}
						border={false}
						contentOptions={{
							backgroundColor: PALETTE.surface,
							flexDirection: "column",
						}}
					>
						{suggestions.map((entry, i) => {
							const selected = i === selectedIndex;
							return (
								<box
									key={entry.name}
									backgroundColor={
										selected
											? PALETTE.surfaceLight
											: undefined
									}
									paddingLeft={1}
									paddingRight={1}
								>
									<text
										fg={
											selected
												? PALETTE.amberGlow
												: PALETTE.amberPrimary
										}
									>
										{selected ? `❯ /${entry.name}` : `  /${entry.name}`}
									</text>
									<text
										fg={
											selected
												? PALETTE.textPrimary
												: PALETTE.textMuted
										}
									>
										{`  ${entry.description}`}
									</text>
								</box>
							);
						})}
					</scrollbox>
				</box>
			)}

			{/* Input row: glyph + input field + character count */}
			<box flexDirection="row" gap={1} width="100%">
				<PromptGlyph
					isThinking={isThinking}
					isStreaming={isStreaming}
					disabled={disabled}
				/>
				<input
					key={inputKey}
					placeholder={placeholder}
					value={nextValueRef.current}
					onInput={handleInput}
					focused={!disabled}
					flexGrow={1}
					textColor={PALETTE.textPrimary}
					backgroundColor={PALETTE.background}
				/>
				{charCount > 0 && (
					<text fg={charCountColor} attributes={DIM}>
						{`${charCount}c`}
					</text>
				)}
			</box>

			{/* Shortcut hints — visible only when idle with empty input */}
			{showHints && (
				<box paddingLeft={2}>
					<text fg={PALETTE.textMuted} attributes={DIM}>
						{"↑↓ history · Tab complete · ^L logs · ^C exit"}
					</text>
				</box>
			)}
		</box>
	);
}
