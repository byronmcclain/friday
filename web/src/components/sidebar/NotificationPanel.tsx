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
	const { notifications } = useNotifications();

	if (notifications.length === 0) {
		return (
			<p className="text-friday-text-muted text-sm">No notifications.</p>
		);
	}

	return (
		<div className="space-y-2">
			{notifications.map((n) => (
				<div
					key={n.id}
					className={`p-2 rounded border ${levelStyles[n.level]}`}
				>
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
