import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { ChatProvider } from "./contexts/ChatContext.tsx";
import { Layout } from "./components/layout/Layout.tsx";
import { ChatPanel } from "./components/chat/ChatPanel.tsx";

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 3000}/ws`;

export function App() {
	return (
		<WebSocketProvider url={WS_URL}>
			<SessionProvider>
				<ChatProvider>
					<Layout>
						<ChatPanel />
					</Layout>
				</ChatProvider>
			</SessionProvider>
		</WebSocketProvider>
	);
}
