import { useNotifications } from "../../hooks/useNotifications.ts";

const levelStyles = {
	info: "border-blue-500/30 bg-blue-500/5",
	warning: "border-friday-warning/30 bg-friday-warning/5",
	alert: "border-friday-error/30 bg-friday-error/5",
};

const levelLabel = {
	info: "text-blue-400",
	warning: "text-friday-warning",
	alert: "text-friday-error",
};

export function NotificationPanel() {
	const { notifications, dismiss, clear } = useNotifications();

	if (notifications.length === 0) {
		return (
			<p className="text-friday-text-muted text-sm">No notifications.</p>
		);
	}

	return (
		<div className="space-y-2">
			<div className="flex justify-end">
				<button
					type="button"
					onClick={clear}
					className="text-xs text-friday-text-dim hover:text-friday-amber"
				>
					Clear all
				</button>
			</div>
			{notifications.map((n) => (
				<div
					key={n.id}
					className={`p-2 rounded border ${levelStyles[n.level]} group relative`}
				>
					<button
						type="button"
						onClick={() => dismiss(n.id)}
						className="absolute top-1 right-1 text-friday-text-dim hover:text-friday-text opacity-0 group-hover:opacity-100 transition-opacity text-xs"
						title="Dismiss"
					>
						&times;
					</button>
					<div className="flex items-center gap-2">
						<span
							className={`text-xs font-medium uppercase ${levelLabel[n.level]}`}
						>
							{n.level}
						</span>
						<span className="text-xs text-friday-text-muted">
							{n.timestamp.toLocaleTimeString([], {
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
					</div>
					<div className="text-sm text-friday-text mt-0.5">
						{n.title}
					</div>
					<div className="text-xs text-friday-text-dim mt-0.5">
						{n.body}
					</div>
				</div>
			))}
		</div>
	);
}
