import { useState, type ReactNode } from "react";

type Tab = "history" | "smarts" | "notifications";

interface SidebarProps {
	isOpen: boolean;
	onToggle: () => void;
	historyPanel: ReactNode;
	smartsPanel: ReactNode;
	notificationsPanel: ReactNode;
}

export function Sidebar({
	isOpen,
	onToggle,
	historyPanel,
	smartsPanel,
	notificationsPanel,
}: SidebarProps) {
	const [activeTab, setActiveTab] = useState<Tab>("history");

	if (!isOpen) {
		return (
			<button
				type="button"
				onClick={onToggle}
				className="px-2 py-4 bg-friday-bg border-l border-friday-amber-dim/20 text-friday-text-dim hover:text-friday-amber transition-colors"
				title="Open sidebar"
			>
				&laquo;
			</button>
		);
	}

	return (
		<aside className="w-72 bg-friday-bg border-l border-friday-amber-dim/20 flex flex-col">
			<div className="flex items-center justify-between px-3 py-2 border-b border-friday-amber-dim/20">
				<div className="flex gap-1">
					{(["history", "smarts", "notifications"] as Tab[]).map(
						(tab) => (
							<button
								type="button"
								key={tab}
								onClick={() => setActiveTab(tab)}
								className={`px-2 py-1 text-xs rounded transition-colors ${
									activeTab === tab
										? "bg-friday-amber/15 text-friday-amber"
										: "text-friday-text-dim hover:text-friday-text"
								}`}
							>
								{tab.charAt(0).toUpperCase() + tab.slice(1)}
							</button>
						),
					)}
				</div>
				<button
					type="button"
					onClick={onToggle}
					className="text-friday-text-dim hover:text-friday-amber text-sm"
				>
					&raquo;
				</button>
			</div>
			<div className="flex-1 overflow-y-auto p-3">
				{activeTab === "history" && historyPanel}
				{activeTab === "smarts" && smartsPanel}
				{activeTab === "notifications" && notificationsPanel}
			</div>
		</aside>
	);
}
