import { useEffect } from "react";
import { useHistory } from "../../hooks/useHistory.ts";
import { useSessionContext } from "../../contexts/SessionContext.tsx";

export function HistoryPanel() {
	const { sessions, loading, fetchHistory, loadSession } = useHistory();
	const { sessionState } = useSessionContext();

	useEffect(() => {
		if (sessionState === "active") fetchHistory();
	}, [sessionState, fetchHistory]);

	if (sessionState !== "active") {
		return (
			<p className="text-friday-text-muted text-sm">
				Connect to view history.
			</p>
		);
	}

	if (loading) {
		return (
			<p className="text-friday-amber-dim text-sm animate-pulse">
				Loading history...
			</p>
		);
	}

	if (sessions.length === 0) {
		return (
			<p className="text-friday-text-muted text-sm">
				No conversation history.
			</p>
		);
	}

	return (
		<div className="space-y-2">
			{sessions.map((session) => (
				<button
					key={session.id}
					onClick={() => loadSession(session.id)}
					className="w-full text-left p-2 rounded border border-friday-amber-dim/20 hover:border-friday-amber/40 hover:bg-friday-surface/50 transition-colors"
				>
					<div className="text-xs text-friday-text-dim">
						{new Date(session.startedAt).toLocaleDateString()}{" "}
						{new Date(session.startedAt).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</div>
					<div className="text-sm text-friday-text mt-0.5">
						{session.provider}/{session.model}
					</div>
					<div className="text-xs text-friday-text-muted mt-0.5">
						{session.messageCount} messages
					</div>
				</button>
			))}
		</div>
	);
}
