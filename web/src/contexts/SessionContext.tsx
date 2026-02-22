import { createContext, useContext, type ReactNode } from "react";
import {
	useSession,
	type SessionInfo,
	type SessionState,
} from "../hooks/useSession.ts";
import type { ConnectionState } from "../hooks/useWebSocket.ts";
import type { ProviderName } from "@friday/core/types.ts";

interface SessionContextValue {
	sessionState: SessionState;
	sessionInfo: SessionInfo | null;
	wsState: ConnectionState;
	boot: (options?: {
		provider?: ProviderName;
		model?: string;
		fresh?: boolean;
	}) => void;
	shutdown: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
	const session = useSession();
	return (
		<SessionContext.Provider value={session}>
			{children}
		</SessionContext.Provider>
	);
}

export function useSessionContext(): SessionContextValue {
	const ctx = useContext(SessionContext);
	if (!ctx)
		throw new Error(
			"useSessionContext must be used within SessionProvider",
		);
	return ctx;
}
