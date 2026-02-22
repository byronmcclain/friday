import { Header } from "./Header.tsx";
import { StatusBar } from "./StatusBar.tsx";
import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
	return (
		<div className="h-screen flex flex-col bg-friday-deep">
			<Header />
			<main className="flex-1 overflow-hidden flex">{children}</main>
			<StatusBar />
		</div>
	);
}
