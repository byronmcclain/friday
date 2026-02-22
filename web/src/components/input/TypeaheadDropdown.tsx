export interface TypeaheadEntry {
	name: string;
	description: string;
}

interface TypeaheadDropdownProps {
	entries: TypeaheadEntry[];
	selectedIndex: number;
	onSelect: (entry: TypeaheadEntry) => void;
}

export function TypeaheadDropdown({
	entries,
	selectedIndex,
	onSelect,
}: TypeaheadDropdownProps) {
	if (entries.length === 0) return null;

	return (
		<div className="absolute bottom-full left-0 right-0 mb-1 bg-friday-elevated border border-friday-amber-dim/40 rounded-lg overflow-hidden shadow-lg">
			{entries.map((entry, i) => (
				<button
					type="button"
					key={entry.name}
					onClick={() => onSelect(entry)}
					className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${
						i === selectedIndex
							? "bg-friday-amber/15 text-friday-amber"
							: "text-friday-text hover:bg-friday-surface"
					}`}
				>
					<span className="font-mono text-friday-amber">
						/{entry.name}
					</span>
					<span className="text-friday-text-dim truncate">
						{entry.description}
					</span>
				</button>
			))}
		</div>
	);
}
