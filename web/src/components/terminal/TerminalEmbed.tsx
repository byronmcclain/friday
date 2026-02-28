export function TerminalEmbed({ src }: { src: string }) {
	return (
		<iframe
			src={src}
			className="w-full h-full border-none bg-[#0D1117]"
			title="Friday Terminal"
			allow="clipboard-read; clipboard-write"
		/>
	);
}
