import { useState, useCallback, type KeyboardEvent } from "react";

interface ChatInputProps {
	onSend: (message: string) => void;
	disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
	const [input, setInput] = useState("");

	const handleSubmit = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		setInput("");
	}, [input, onSend, disabled]);

	const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	return (
		<div className="border-t border-friday-amber-dim/20 bg-friday-bg px-4 py-3">
			<div
				className={`flex gap-2 items-end rounded-lg border ${
					disabled
						? "border-friday-text-muted/30"
						: "border-friday-amber-dim/40 focus-within:border-friday-amber/60 focus-within:friday-glow"
				} bg-friday-surface px-3 py-2 transition-all`}
			>
				<textarea
					value={input}
					onChange={(e) => setInput(e.target.value)}
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
	);
}
