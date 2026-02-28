import { VoiceMode } from "./components/voice/index.ts";
import { TerminalEmbed } from "./components/terminal/TerminalEmbed.tsx";

const mode = new URLSearchParams(window.location.search).get("mode");

// ttyd URL — same host, port 7681, base path /terminal/
const TTYD_URL = `${window.location.protocol}//${window.location.hostname}:7681/terminal/`;

export function App() {
	if (mode === "voice") {
		return <VoiceMode />;
	}

	return <TerminalEmbed src={TTYD_URL} />;
}
