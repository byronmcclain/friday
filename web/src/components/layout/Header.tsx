import { useSessionContext } from "../../contexts/SessionContext.tsx";

export function Header() {
	const { sessionState, sessionInfo, boot, shutdown } = useSessionContext();

	return (
		<header className="flex items-center justify-between px-4 py-3 border-b border-friday-amber-dim/30 bg-friday-bg">
			<div className="flex items-center gap-3">
				<h1 className="text-xl font-bold text-friday-amber">
					F.R.I.D.A.Y.
				</h1>
				<span className="text-xs text-friday-text-muted">Web UI</span>
			</div>
			<div className="flex items-center gap-4">
				{sessionInfo && (
					<span className="text-sm text-friday-text-dim">
						{sessionInfo.provider}: {sessionInfo.model}
					</span>
				)}
				{sessionState === "disconnected" && (
					<button
						onClick={() => boot()}
						className="px-3 py-1 text-sm rounded border border-friday-amber text-friday-amber hover:bg-friday-amber/10 transition-colors"
					>
						Connect
					</button>
				)}
				{sessionState === "booting" && (
					<span className="text-sm text-friday-amber animate-pulse">
						Booting...
					</span>
				)}
				{sessionState === "active" && (
					<button
						onClick={shutdown}
						className="px-3 py-1 text-sm rounded border border-friday-text-muted text-friday-text-dim hover:border-friday-error hover:text-friday-error transition-colors"
					>
						Disconnect
					</button>
				)}
			</div>
		</header>
	);
}
