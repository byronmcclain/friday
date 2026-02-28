import type { ReactNode } from "react";

export type AppMode = "terminal" | "voice";

interface MenuBarProps {
	activeMode: AppMode;
	onModeChange: (mode: AppMode) => void;
}

const MODES: { mode: AppMode; label: string }[] = [
	{ mode: "terminal", label: "Terminal" },
	{ mode: "voice", label: "Voice" },
];

function Divider() {
	return (
		<div
			className="h-3.5 w-px mx-1.5"
			style={{ background: "rgba(232, 148, 58, 0.15)" }}
		/>
	);
}

function ModeTab({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			className="menu-tab relative px-2.5 py-1 rounded transition-all duration-200"
			style={{
				color: active
					? "var(--color-friday-amber)"
					: "var(--color-friday-text-dim)",
				background: active ? "rgba(245, 166, 35, 0.08)" : "transparent",
				fontSize: "11px",
				fontWeight: active ? 500 : 400,
				letterSpacing: "0.04em",
			}}
		>
			{children}
			{active && (
				<span
					className="absolute bottom-0 left-1/2 -translate-x-1/2 h-px rounded-full"
					style={{
						width: "70%",
						background:
							"linear-gradient(90deg, transparent, var(--color-friday-amber), transparent)",
					}}
				/>
			)}
		</button>
	);
}

export function MenuBar({ activeMode, onModeChange }: MenuBarProps) {
	return (
		<nav
			className="menu-bar relative flex items-center h-9 shrink-0 z-50"
			role="menubar"
		>
			{/* Glass background */}
			<div
				className="absolute inset-0 pointer-events-none"
				style={{
					background: "rgba(11, 14, 20, 0.92)",
					backdropFilter: "saturate(180%) blur(16px)",
					WebkitBackdropFilter: "saturate(180%) blur(16px)",
				}}
			/>

			{/* Bottom glow line — amber HUD divider, brighter at center */}
			<div className="absolute bottom-0 left-0 right-0 h-px pointer-events-none menu-glow-line" />

			{/* Content layer */}
			<div className="relative flex items-center w-full px-3 z-10">
				{/* Diamond icon — brand presence without redundant text */}
				<span
					className="friday-diamond mr-1"
					style={{
						color: "var(--color-friday-amber)",
						fontSize: "12px",
					}}
				>
					&#x25C6;
				</span>

				<Divider />

				{/* Mode Tabs */}
				<div className="flex items-center gap-0.5">
					{MODES.map(({ mode, label }) => (
						<ModeTab
							key={mode}
							active={activeMode === mode}
							onClick={() => onModeChange(mode)}
						>
							{label}
						</ModeTab>
					))}
				</div>

				{/* Right side — expansion area for future items */}
				<div className="ml-auto flex items-center gap-3" />
			</div>
		</nav>
	);
}
