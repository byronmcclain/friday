import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { PALETTE, BOLD, DIM } from "../theme.ts";
import { filterCommands, type TypeaheadEntry } from "../filter-commands.ts";
import { usePulse } from "../lib/use-pulse.ts";
import { lerpColor } from "../lib/color-utils.ts";
import { consumePendingEditorResult } from "../app.tsx";
import { platform } from "node:os";

const MAX_SUGGESTIONS = 25;
const VISIBLE_ROWS = 10;
const MAX_HISTORY = 50;
const CHAR_WARN = 1000;
const CHAR_DANGER = 2000;
const MAX_INPUT_LINES = 10;

/** Compute textarea height (in rows) from content — capped at MAX_INPUT_LINES. */
export function computeInputHeight(content: string): number {
	if (content.length === 0) return 1;
	const lineCount = content.split("\n").length;
	return Math.min(lineCount, MAX_INPUT_LINES);
}

interface CommandTypeaheadProps {
	commands: TypeaheadEntry[];
	disabled: boolean;
	placeholder: string;
	onSubmit: (input: string) => void;
	onExit: () => void;
	onOpenEditor: (currentContent: string) => Promise<string | null>;
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
	onOpenEditor,
	isThinking,
	isStreaming,
}: CommandTypeaheadProps) {
	// Shadow copy of input value for suggestion filtering — the <textarea>
	// element owns its own buffer; we never push value back via props.
	const [shadow, setShadow] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	// Bumped to remount <textarea> with a new initialValue (suggestion accept, submit clear)
	const [inputKey, setInputKey] = useState(0);
	// Holds the initialValue for the next <textarea> mount
	const nextValueRef = useRef("");
	const shadowRef = useRef(shadow);
	shadowRef.current = shadow;
	const [suggestionsBlocked, setSuggestionsBlocked] = useState(false);
	const scrollRef = useRef<ScrollBoxRenderable>(null);

	// Cursor tracking for multi-line navigation
	const [cursorLine, setCursorLine] = useState(0);
	const [lineCount, setLineCount] = useState(1);
	const textareaRef = useRef<TextareaRenderable>(null);

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

	// Sync shadow state from textarea ref — called on content change AND cursor change.
	// onContentChange may not fire for all edit operations (e.g., deletions after remount),
	// so we also sync on cursor changes since the cursor moves on every edit.
	const syncShadow = useCallback(() => {
		const value = textareaRef.current?.plainText ?? "";
		if (value !== shadowRef.current) {
			setShadow(value);
			setSelectedIndex(0);
			setSuggestionsBlocked(false);
			setLineCount(computeInputHeight(value));
			historyIndexRef.current = -1;
		}
	}, []);

	const handleCursorChange = useCallback(
		(event: { line: number; visualColumn: number }) => {
			setCursorLine(event.line);
			syncShadow();
		},
		[syncShadow],
	);

	// Programmatically replace input content by remounting with new initialValue
	const replaceInput = useCallback((value: string) => {
		nextValueRef.current = value;
		setShadow(value);
		setLineCount(computeInputHeight(value));
		setCursorLine(0);
		setInputKey((k) => k + 1);
	}, []);

	// After replaceInput remounts the textarea, move cursor to end of content.
	// Deferred to next tick so the textarea has rendered with its new initialValue.
	useEffect(() => {
		if (nextValueRef.current.length > 0) {
			const timer = setTimeout(() => {
				textareaRef.current?.gotoBufferEnd();
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [inputKey]);

	// On mount, check for a pending editor result (set before TUI re-mount)
	useEffect(() => {
		const pending = consumePendingEditorResult();
		if (pending !== undefined && pending !== null) {
			replaceInput(pending);
		}
	}, []);

	useKeyboard((key) => {
		if (disabled) return;

		// Ctrl+C — exit
		if (key.ctrl && key.name === "c") {
			key.preventDefault();
			onExit();
			return;
		}

		// Ctrl+E — open external editor
		if (key.ctrl && key.name === "e") {
			key.preventDefault();
			onOpenEditor(shadowRef.current).then((result) => {
				if (result !== null) replaceInput(result);
			});
			return;
		}

		// Alt+Enter (Option+Enter) — insert newline
		if (key.name === "return" && (key.meta || key.option)) {
			key.preventDefault();
			textareaRef.current?.insertText("\n");
			// Sync shadow state after programmatic insert
			const value = textareaRef.current?.plainText ?? "";
			setShadow(value);
			setLineCount(computeInputHeight(value));
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

		// Up — suggestion navigation, history (only on first line), or let textarea handle
		if (key.name === "up") {
			if (hasSuggestions) {
				key.preventDefault();
				setSelectedIndex((i) =>
					i <= 0 ? suggestions.length - 1 : i - 1,
				);
				return;
			}
			// Multi-line: let textarea handle cursor movement unless on first line
			if (lineCount > 1 && cursorLine > 0) {
				return; // don't preventDefault — textarea moves cursor up
			}
			key.preventDefault();
			if (historyRef.current.length > 0) {
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

		// Down — suggestion navigation, history (only on last line), or let textarea handle
		if (key.name === "down") {
			if (hasSuggestions) {
				key.preventDefault();
				setSelectedIndex((i) =>
					i >= suggestions.length - 1 ? 0 : i + 1,
				);
				return;
			}
			// Multi-line: let textarea handle cursor movement unless on last line
			if (lineCount > 1 && cursorLine < lineCount - 1) {
				return; // don't preventDefault — textarea moves cursor down
			}
			key.preventDefault();
			if (historyIndexRef.current >= 0) {
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

		// Tab — accept selected suggestion, or insert tab character
		if (key.name === "tab") {
			key.preventDefault();
			if (hasSuggestions) {
				const selected = suggestions[selectedIndex];
				if (selected) {
					replaceInput(`/${selected.name} `);
					setSelectedIndex(0);
				}
				return;
			}
			// No suggestions — insert tab character
			textareaRef.current?.insertText("\t");
			const value = textareaRef.current?.plainText ?? "";
			setShadow(value);
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
					width="100%"
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
									flexDirection="row"
									width="100%"
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
				<textarea
					ref={textareaRef}
					key={inputKey}
					placeholder={placeholder}
					initialValue={nextValueRef.current}
					onContentChange={syncShadow}
					onCursorChange={handleCursorChange}
					focused={!disabled}
					flexGrow={1}
					height={computeInputHeight(shadow)}
					wrapMode="word"
					textColor={PALETTE.textPrimary}
					backgroundColor={PALETTE.background}
					showCursor={!disabled}
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
						{`↑↓ history · Tab complete · ${platform() === "darwin" ? "⌥" : "Alt+"}↵ newline · ^E vim · ^L logs · ^C exit`}
					</text>
				</box>
			)}
		</box>
	);
}
