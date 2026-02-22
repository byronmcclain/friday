import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { SessionProvider } from "./contexts/SessionContext.tsx";
import { ChatProvider } from "./contexts/ChatContext.tsx";
import { Layout } from "./components/layout/Layout.tsx";

const WS_URL = `ws://${window.location.hostname}:${window.location.port || 3000}/ws`;

export function App() {
	return (
		<WebSocketProvider url={WS_URL}>
			<SessionProvider>
				<ChatProvider>
					<Layout>
						<div className="flex-1 flex items-center justify-center text-friday-text-dim">
							Chat panel coming soon...
						</div>
					</Layout>
				</ChatProvider>
			</SessionProvider>
		</WebSocketProvider>
	);
}
