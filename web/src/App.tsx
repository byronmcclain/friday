import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { ChatProvider } from "./contexts/ChatContext.tsx";
import { Layout } from "./components/layout/Layout.tsx";
import { ChatPanel } from "./components/chat/ChatPanel.tsx";
import { AutoBoot } from "./components/AutoBoot.tsx";

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 3000}/ws`;

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
