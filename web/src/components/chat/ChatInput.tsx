import { useState, useCallback, useMemo, type KeyboardEvent } from "react";
import {
	TypeaheadDropdown,
	type TypeaheadEntry,
} from "../input/TypeaheadDropdown.tsx";

const KNOWN_PROTOCOLS: TypeaheadEntry[] = [
	{ name: "history", description: "Browse and manage conversation history" },
	{ name: "env", description: "View system environment" },
	{ name: "smart", description: "Manage SMARTS knowledge base" },
];

interface ChatInputProps {
	onSend: (message: string) => void;
	disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
	const [input, setInput] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);

	const filteredCommands = useMemo(() => {
		if (!input.startsWith("/")) return [];
		const query = input.slice(1).toLowerCase();
		return KNOWN_PROTOCOLS.filter((p) =>
			p.name.toLowerCase().startsWith(query),
		);
	}, [input]);

	const showTypeahead = filteredCommands.length > 0;

	const handleSubmit = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		setInput("");
		setSelectedIndex(0);
	}, [input, onSend, disabled]);

	const handleSelect = useCallback(
		(entry: TypeaheadEntry) => {
			setInput(`/${entry.name} `);
			setSelectedIndex(0);
		},
		[],
	);

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (showTypeahead) {
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIndex((i) =>
					i > 0 ? i - 1 : filteredCommands.length - 1,
				);
				return;
			}
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIndex((i) =>
					i < filteredCommands.length - 1 ? i + 1 : 0,
				);
				return;
			}
			if (e.key === "Tab") {
				e.preventDefault();
				const selected = filteredCommands[selectedIndex];
				if (selected) handleSelect(selected);
				return;
			}
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (showTypeahead) {
				const selected = filteredCommands[selectedIndex];
				if (selected) {
					handleSelect(selected);
					return;
				}
			}
			handleSubmit();
		}
	};

	return (
		<div className="border-t border-friday-amber-dim/20 bg-friday-bg px-4 py-3">
			<div className="relative">
				{showTypeahead && (
					<TypeaheadDropdown
						entries={filteredCommands}
						selectedIndex={selectedIndex}
						onSelect={handleSelect}
					/>
				)}
				<div
					className={`flex gap-2 items-end rounded-lg border ${
						disabled
							? "border-friday-text-muted/30"
							: "border-friday-amber-dim/40 focus-within:border-friday-amber/60 focus-within:friday-glow"
					} bg-friday-surface px-3 py-2 transition-all`}
				>
					<textarea
						value={input}
						onChange={(e) => {
							setInput(e.target.value);
							setSelectedIndex(0);
						}}
						onKeyDown={handleKeyDown}
						placeholder={
							disabled
								? "Connect to start chatting..."
								: "Type a message or /command..."
						}
						disabled={disabled}
						rows={1}
						className="flex-1 bg-transparent text-friday-text placeholder-friday-text-muted resize-none outline-none text-sm leading-relaxed"
					/>
					<button
						onClick={handleSubmit}
						disabled={disabled || !input.trim()}
						className="px-3 py-1 rounded text-sm font-medium bg-friday-amber text-friday-deep hover:bg-friday-amber-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
					>
						Send
					</button>
				</div>
			</div>
		</div>
	);
}
