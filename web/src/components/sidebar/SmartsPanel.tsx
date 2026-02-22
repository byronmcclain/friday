import { useEffect, useState } from "react";
import { useSmarts } from "../../hooks/useSmarts.ts";
import { useSessionContext } from "../../contexts/SessionContext.tsx";

export function SmartsPanel() {
	const { entries, loading, fetchList, search } = useSmarts();
	const { sessionState } = useSessionContext();
	const [query, setQuery] = useState("");

	useEffect(() => {
		if (sessionState === "active") fetchList();
	}, [sessionState, fetchList]);

	if (sessionState !== "active") {
		return (
			<p className="text-friday-text-muted text-sm">
				Connect to view knowledge.
			</p>
		);
	}

	const handleSearch = () => {
		if (query.trim()) search(query.trim());
		else fetchList();
	};

	return (
		<div className="space-y-3">
			<div className="flex gap-1">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleSearch()}
					placeholder="Search knowledge..."
					className="flex-1 bg-friday-surface border border-friday-amber-dim/30 rounded px-2 py-1 text-sm text-friday-text placeholder-friday-text-muted outline-none focus:border-friday-amber/50"
				/>
				<button
					type="button"
					onClick={fetchList}
					className="text-xs text-friday-text-dim hover:text-friday-amber"
				>
					Reload
				</button>
			</div>
			{loading && (
				<p className="text-friday-amber-dim text-sm animate-pulse">
					Loading...
				</p>
			)}
			{entries.map((entry) => (
				<div
					key={`${entry.domain}:${entry.name}`}
					className="p-2 rounded border border-friday-amber-dim/20 bg-friday-surface/30"
				>
					<div className="text-sm text-friday-text font-medium">
						{entry.name}
					</div>
					<div className="flex gap-2 mt-1">
						<span className="text-xs px-1.5 py-0.5 rounded bg-friday-amber/10 text-friday-amber">
							{entry.domain}
						</span>
						<span className="text-xs text-friday-text-muted">
							{(entry.confidence * 100).toFixed(0)}%
						</span>
					</div>
				</div>
			))}
		</div>
	);
}
