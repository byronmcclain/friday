export function StatusBar() {
	return (
		<footer className="flex items-center gap-6 px-4 py-2 border-t border-friday-amber-dim/20 bg-friday-bg text-xs text-friday-text-dim">
			<span>CPU --%</span>
			<span>MEM --%</span>
			<span>Git: --</span>
		</footer>
	);
}
