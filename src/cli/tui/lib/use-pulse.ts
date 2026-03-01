import { useState, useEffect } from "react";

const TICK_MS = 60;

/**
 * Returns a 0–1 value that smoothly oscillates on a sine wave while `active`
 * is true. `periodMs` controls the full cycle duration (dim → bright → dim).
 * Returns 0 when inactive. Tick rate matches the header shimmer (60ms).
 */
export function usePulse(active: boolean, periodMs: number): number {
	const [value, setValue] = useState(0);

	useEffect(() => {
		if (!active) {
			setValue(0);
			return;
		}
		const start = Date.now();
		const id = setInterval(() => {
			const elapsed = Date.now() - start;
			const t = (Math.sin((elapsed / periodMs) * Math.PI * 2) + 1) / 2;
			setValue(t);
		}, TICK_MS);
		return () => clearInterval(id);
	}, [active, periodMs]);

	return value;
}
