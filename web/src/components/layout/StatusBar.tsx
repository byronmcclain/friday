import { useSensorium } from "../../hooks/useSensorium.ts";

function GaugeBar({
	value,
	max = 100,
	thresholdHigh = 80,
}: { value: number; max?: number; thresholdHigh?: number }) {
	const percent = Math.min((value / max) * 100, 100);
	const color =
		percent >= 90
			? "bg-friday-error"
			: percent >= thresholdHigh
				? "bg-friday-warning"
				: "bg-friday-success";

	return (
		<div className="w-16 h-2 bg-friday-surface rounded-full overflow-hidden">
			<div
				className={`h-full ${color} transition-all duration-500`}
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}

export function StatusBar() {
	const data = useSensorium();

	return (
		<footer className="flex items-center gap-6 px-4 py-2 border-t border-friday-amber-dim/20 bg-friday-bg text-xs text-friday-text-dim">
			<div className="flex items-center gap-2">
				<span>CPU</span>
				<GaugeBar value={data?.cpu ?? 0} />
				<span>{data?.cpu ?? "--"}%</span>
			</div>
			<div className="flex items-center gap-2">
				<span>MEM</span>
				<GaugeBar value={data?.memory.percent ?? 0} />
				<span>{data?.memory.percent ?? "--"}%</span>
			</div>
			{data?.git && (
				<span>
					{data.git.branch}
					{data.git.dirty && (
						<span className="text-friday-warning ml-1">*</span>
					)}
				</span>
			)}
			{data?.containers.running &&
				data.containers.running.length > 0 && (
					<span>{data.containers.running.length} containers</span>
				)}
			{data?.ports && data.ports.length > 0 && (
				<span>
					:{data.ports.map((p) => p.port).join(", ")}
				</span>
			)}
		</footer>
	);
}
