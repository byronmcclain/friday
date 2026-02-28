import { useState } from "react";
import { VoiceMode } from "./components/voice/index.ts";
import { TerminalEmbed } from "./components/terminal/TerminalEmbed.tsx";
import { MenuBar, type AppMode } from "./components/menu/MenuBar.tsx";

// ttyd URL — same host, port 7681, base path /terminal/
const TTYD_URL = `${window.location.protocol}//${window.location.hostname}:7681/terminal/`;

function getInitialMode(): AppMode {
	const params = new URLSearchParams(window.location.search);
	return params.get("mode") === "voice" ? "voice" : "terminal";
}

export function App() {
	const [mode, setMode] = useState<AppMode>(getInitialMode);

	const handleModeChange = (newMode: AppMode) => {
		setMode(newMode);
		// Sync URL without page reload for bookmarkability
		const url = new URL(window.location.href);
		if (newMode === "terminal") {
			url.searchParams.delete("mode");
		} else {
			url.searchParams.set("mode", newMode);
		}
		window.history.replaceState({}, "", url.toString());
	};

	return (
		<div className="h-full w-full flex flex-col overflow-hidden">
			<MenuBar activeMode={mode} onModeChange={handleModeChange} />

			{/* Terminal — always rendered, CSS-hidden when inactive to preserve iframe session */}
			<div
				className="flex-1 min-h-0 overflow-hidden"
				style={{ display: mode === "terminal" ? undefined : "none" }}
			>
				<TerminalEmbed src={TTYD_URL} />
			</div>

			{/* Voice — conditionally rendered to save resources (canvas, audio, WebSocket) */}
			{mode === "voice" && (
				<div className="flex-1 min-h-0 relative overflow-hidden">
					<VoiceMode />
				</div>
			)}
		</div>
	);
}
