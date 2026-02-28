import { useState, useEffect, useCallback } from "react";
import { VoiceMode } from "./components/voice/index.ts";
import { TerminalEmbed } from "./components/terminal/TerminalEmbed.tsx";
import { MenuBar, type AppMode } from "./components/menu/MenuBar.tsx";

// ttyd URL — same host, port 7681, base path /terminal/
const TTYD_URL = `${window.location.protocol}//${window.location.hostname}:7681/terminal/`;

// Server health check — lightweight ping to confirm Friday server is alive
function useServerStatus(intervalMs = 10_000): boolean {
	const [connected, setConnected] = useState(true);

	const check = useCallback(() => {
		fetch("/", { method: "HEAD", cache: "no-store" })
			.then(() => setConnected(true))
			.catch(() => setConnected(false));
	}, []);

	useEffect(() => {
		check();
		const id = setInterval(check, intervalMs);
		return () => clearInterval(id);
	}, [check, intervalMs]);

	return connected;
}

function getInitialMode(): AppMode {
	const params = new URLSearchParams(window.location.search);
	return params.get("mode") === "voice" ? "voice" : "terminal";
}

export function App() {
	const [mode, setMode] = useState<AppMode>(getInitialMode);
	const connected = useServerStatus();

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
			<MenuBar
				activeMode={mode}
				onModeChange={handleModeChange}
				connected={connected}
			/>

			{/* Terminal — always rendered, CSS-hidden when inactive to preserve iframe session */}
			<div
				className="flex-1 min-h-0 overflow-hidden relative"
				style={{ display: mode === "terminal" ? undefined : "none" }}
			>
				<TerminalEmbed src={TTYD_URL} />

				{/* Ambient vignette — softens edges, adds depth to raw iframe */}
				<div
					className="absolute inset-0 pointer-events-none z-10"
					style={{
						background:
							"radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.4) 100%)",
					}}
				/>
			</div>

			{/* Voice — conditionally rendered to save resources (canvas, audio, WebSocket) */}
			{mode === "voice" && (
				<div className="flex-1 min-h-0 relative overflow-hidden">
					<VoiceMode />
				</div>
			)}

			{/* Atmospheric noise grain — unified across both modes */}
			<div className="noise-overlay" />
		</div>
	);
}
