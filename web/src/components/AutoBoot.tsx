import { useEffect, useRef } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import { useSessionContext } from "../contexts/SessionContext.tsx";

export function AutoBoot() {
	const { state: wsState, connect } = useWS();
	const { sessionState, boot } = useSessionContext();
	const bootedRef = useRef(false);

	useEffect(() => {
		connect();
	}, [connect]);

	// Reset boot flag when disconnected so re-connect triggers a fresh boot
	useEffect(() => {
		if (sessionState === "disconnected") {
			bootedRef.current = false;
		}
	}, [sessionState]);

	useEffect(() => {
		if (
			wsState === "connected" &&
			sessionState === "disconnected" &&
			!bootedRef.current
		) {
			bootedRef.current = true;
			boot();
		}
	}, [wsState, sessionState, boot]);

	return null;
}
