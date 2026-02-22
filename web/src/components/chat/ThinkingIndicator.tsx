export function ThinkingIndicator() {
	return (
		<div className="flex items-center gap-2 px-4 py-2 text-friday-amber">
			<div className="flex gap-1">
				<span className="w-2 h-2 rounded-full bg-friday-amber animate-bounce [animation-delay:0ms]" />
				<span className="w-2 h-2 rounded-full bg-friday-amber animate-bounce [animation-delay:150ms]" />
				<span className="w-2 h-2 rounded-full bg-friday-amber animate-bounce [animation-delay:300ms]" />
			</div>
			<span className="text-sm text-friday-amber-dim">
				Friday is thinking...
			</span>
		</div>
	);
}
