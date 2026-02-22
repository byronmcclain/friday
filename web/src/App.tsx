import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { ChatProvider } from "./contexts/ChatContext.tsx";
import { Layout } from "./components/layout/Layout.tsx";
import { ChatPanel } from "./components/chat/ChatPanel.tsx";
import { AutoBoot } from "./components/AutoBoot.tsx";

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsPort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
const WS_URL = `${wsProtocol}//${window.location.hostname}:${wsPort}/ws`;

export function App() {
	return (
		<WebSocketProvider url={WS_URL}>
			<SessionProvider>
				<ChatProvider>
					<AutoBoot />
					<Layout>
						<ChatPanel />
					</Layout>
				</ChatProvider>
			</SessionProvider>
		</WebSocketProvider>
	);
}
