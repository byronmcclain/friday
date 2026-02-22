import { useEffect, useState } from "react";
import { useWS } from "../contexts/WebSocketContext.tsx";
import type { ServerMessage } from "@friday/server/protocol.ts";

export interface SensoriumData {
	cpu: number;
	memory: { used: number; total: number; percent: number };
	containers: {
		runtime: string;
		running: { name: string }[];
		stopped: number;
	};
	git?: {
		repo: string;
		branch: string;
		dirty: boolean;
		ahead: number;
		behind: number;
	};
	ports: { port: number; process: string }[];
}

export function useSensorium() {
	const { subscribe } = useWS();
	const [data, setData] = useState<SensoriumData | null>(null);

	useEffect(() => {
		const unsub = subscribe("sensorium:update", (msg) => {
			const m = msg as Extract<
				ServerMessage,
				{ type: "sensorium:update" }
			>;
			setData(m.snapshot as SensoriumData);
		});
		return unsub;
	}, [subscribe]);

	return data;
}
