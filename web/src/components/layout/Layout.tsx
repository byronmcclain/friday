import { useState, type ReactNode } from "react";
import { Header } from "./Header.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { HistoryPanel } from "../sidebar/HistoryPanel.tsx";
import { SmartsPanel } from "../sidebar/SmartsPanel.tsx";
import { NotificationPanel } from "../sidebar/NotificationPanel.tsx";

export function Layout({ children }: { children: ReactNode }) {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	return (
		<div className="h-screen flex flex-col bg-friday-deep">
			<Header />
			<main className="flex-1 overflow-hidden flex">
				{children}
				<Sidebar
					isOpen={sidebarOpen}
					onToggle={() => setSidebarOpen(!sidebarOpen)}
					historyPanel={<HistoryPanel />}
					smartsPanel={<SmartsPanel />}
					notificationsPanel={<NotificationPanel />}
				/>
			</main>
			<StatusBar />
		</div>
	);
}
