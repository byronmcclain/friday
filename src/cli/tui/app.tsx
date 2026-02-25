import { useReducer, useEffect, useState, useCallback, useRef } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { toast, ToasterRenderable } from "@opentui-ui/toast";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSync } from "node:fs";
import { FridayRuntime } from "../../core/runtime.ts";
import { resolveGenesisPath } from "../../core/genesis.ts";
import type { ProviderName } from "../../core/types.ts";
import { TuiChannel } from "./channels/tui-channel.ts";
import { appReducer, initialState, isExitWord, createMessage } from "./state.ts";
import { PALETTE } from "./theme.ts";
import { Header } from "./components/header.tsx";
import { ChatArea } from "./components/chat-area.tsx";
import { InputBar } from "./components/input-bar.tsx";
import { SplashScreen } from "./components/splash.tsx";
import {
	processLogo,
	checkChafa,
	type LogoData,
} from "./lib/logo-processor.ts";
import type { TypeaheadEntry } from "./filter-commands.ts";
import { LogStore } from "./log-store.ts";
import { LogPanel } from "./components/log-panel.tsx";
import type { LogEntry } from "./log-types.ts";
import type { AuditEntry } from "../../audit/types.ts";

// Module-level renderer reference so shutdown can call destroy()
let activeRenderer: Awaited<ReturnType<typeof createCliRenderer>> | null =
	null;

// Explicit terminal restoration — safety net after renderer.destroy().
// Uses writeSync to fd 1 (stdout) to bypass OpenTUI's stdout interception
// (OTUI_OVERRIDE_STDOUT defaults to true, replacing process.stdout.write
// with a capture function). Writing directly to the fd ensures these
// sequences always reach the terminal, even if destroy() deferred
// finalization because a render was in progress.
function restoreTerminal(): void {
	writeSync(
		1,
		"\x1b[?1049l" + // Switch back to main screen (no-op if already there)
			"\x1b[0m" +     // Reset all SGR attributes
			"\x1b[?25h",    // Show cursor
	);
}

interface FridayAppProps {
	options: {
		provider: string;
		model?: string;
		fastModel?: string;
		fresh?: boolean;
	};
	renderer: Awaited<ReturnType<typeof createCliRenderer>>;
}

function FridayApp({ options, renderer }: FridayAppProps) {
	const [state, dispatch] = useReducer(appReducer, initialState);
	const runtimeRef = useRef<FridayRuntime | null>(null);
	const commandsRef = useRef<TypeaheadEntry[]>([]);
	const processingRef = useRef(false);
	const logoDataRef = useRef<LogoData | null>(null);
	const [bootComplete, setBootComplete] = useState(false);
	const logStoreRef = useRef(new LogStore());
	const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

	const pushLog = useCallback((level: LogEntry["level"], source: string, message: string, detail?: string) => {
		const entry: LogEntry = {
			id: crypto.randomUUID(),
			timestamp: new Date(),
			level,
			source,
			message,
			detail,
		};
		logStoreRef.current.push(entry);
	}, []);

	const projectRoot = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../..",
	);

	const bootConfig = useCallback(
		() => ({
			provider: options.provider as ProviderName,
			model: options.model,
			fastModel: options.fastModel,
			smartsDir: resolve(projectRoot, "smarts"),
			dataDir: resolve(projectRoot, "data"),
			modulesDir: resolve(projectRoot, "src/modules"),
			forgeDir: resolve(projectRoot, "forge"),
			fresh: options.fresh,
			genesisPath: resolveGenesisPath(),
			channels: [],
		}),
		[options, projectRoot],
	);

	// Subscribe to LogStore changes to update React state
	useEffect(() => {
		const store = logStoreRef.current;
		const cb = () => setLogEntries([...store.entries]);
		store.subscribe(cb);
		return () => store.unsubscribe(cb);
	}, []);

	// Boot runtime on mount
	useEffect(() => {
		let cancelled = false;
		const runtime = new FridayRuntime();
		runtimeRef.current = runtime;

		(async () => {
			// Process logo during splash phase, sized to fit the terminal.
			// Reserve rows for: ascii-font title (6) + gaps (2) + subtitle (2) + margin (4)
			if (checkChafa()) {
				const logoPath = resolve(projectRoot, "friday-logo.jpeg");
				const logoWidth = Math.min(80, renderer.width - 4);
				const logoHeight = Math.min(40, renderer.height - 14);
				if (logoWidth >= 10 && logoHeight >= 5) {
					logoDataRef.current = await processLogo(logoPath, logoWidth, logoHeight);
				}
			}

			if (cancelled) return;

			// If logo failed to load, skip splash and go straight to booting
			if (!logoDataRef.current) {
				dispatch({ type: "set-phase", phase: "booting" });
			}

			dispatch({
				type: "add-message",
				message: createMessage("system", "Booting Friday..."),
			});
			pushLog("info", "runtime", "Booting Friday...");
			try {
				await runtime.boot(bootConfig());

				if (cancelled) return;

				// Wire audit log callback to LogStore (after boot so _audit exists)
				runtime.audit.onLog = (entry: AuditEntry) => {
					pushLog(
						entry.success ? "success" : "error",
						"audit",
						entry.action,
						entry.detail,
					);
				};

				// Wire TuiChannel for toast notifications
				const notifications = runtime.notifications;
				if (notifications) {
					notifications.addChannel(
						new TuiChannel((level, text) => {
							if (level === "alert") {
								toast.error(text);
							} else {
								toast(text);
							}
						}),
					);
				}

				// Build command list for typeahead
				commandsRef.current = runtime.protocols.list().map((p) => ({
					name: p.name,
					description: p.description,
					aliases: p.aliases,
				}));

				const providerLabel = runtime.cortex.providerName;
				const modelLabel = runtime.cortex.modelName;
				const toolCount = runtime.cortex.availableTools.length;
				dispatch({
					type: "set-welcome",
					info: { provider: providerLabel, model: modelLabel },
				});
				dispatch({
					type: "add-message",
					message: createMessage(
						"system",
						`Friday online. (${providerLabel}: ${modelLabel}, ${toolCount} tools)`,
					),
				});
				if (cancelled) return;
				setBootComplete(true);
				pushLog("success", "runtime", `Friday online. (${providerLabel}: ${modelLabel}, ${toolCount} tools)`);
			} catch (error) {
				if (cancelled) return;
				const msg =
					error instanceof Error
						? error.message
						: "Unknown boot error";
				dispatch({
					type: "add-message",
					message: createMessage("system", `Boot failed: ${msg}`),
				});
				pushLog("error", "runtime", `Boot failed: ${msg}`);
			}
		})();

		return () => { cancelled = true; };
	}, [bootConfig]);

	// Activate when both splash is done and boot is complete
	useEffect(() => {
		if (state.phase === "booting" && bootComplete) {
			dispatch({ type: "set-phase", phase: "active" });
		}
	}, [state.phase, bootComplete]);

	// Ctrl+L toggles the log panel
	useEffect(() => {
		const handler = (key: { ctrl: boolean; name: string }) => {
			if (key.ctrl && key.name === "l") {
				dispatch({ type: "toggle-log-panel" });
			}
		};
		renderer.keyInput.on("keypress", handler);
		return () => { renderer.keyInput.off("keypress", handler); };
	}, [renderer]);

	// Shutdown handler
	const handleShutdown = useCallback(async () => {
		const runtime = runtimeRef.current;
		if (!runtime || state.phase === "shutting-down") return;

		dispatch({ type: "set-phase", phase: "shutting-down" });
		try {
			await runtime.shutdown((_, label) => {
				dispatch({
					type: "add-message",
					message: createMessage("system", label),
				});
				pushLog("info", "runtime", label);
			});
			dispatch({
				type: "add-message",
				message: createMessage("system", "Shutdown complete."),
			});
			pushLog("success", "runtime", "Shutdown complete.");
		} catch (error) {
			const msg =
				error instanceof Error ? error.message : "Unknown error";
			dispatch({
				type: "add-message",
				message: createMessage("system", `Shutdown failed: ${msg}`),
			});
		}

		// Destroy renderer to restore terminal state, then exit
		setTimeout(() => {
			activeRenderer?.destroy();
			restoreTerminal();
			process.exit(0);
		}, 500);
	}, [state.phase]);

	// Auto-copy selected text on mouse release
	const handleMouseUp = useCallback(() => {
		// Defer to next tick so OpenTUI's internal selection processing completes first
		setTimeout(() => {
			if (!renderer.hasSelection) return;
			const selection = renderer.getSelection();
			if (!selection) return;
			const text = selection.getSelectedText();
			if (!text) {
				renderer.clearSelection();
				return;
			}
			renderer.copyToClipboardOSC52(text);
			toast("Copied!");
			// Clear selection after brief visual flash
			setTimeout(() => {
				renderer.clearSelection();
			}, 500);
		}, 0);
	}, [renderer]);

	// Handle input submission
	const handleSubmit = useCallback(
		async (input: string) => {
			const runtime = runtimeRef.current;
			if (!runtime || state.phase !== "active" || processingRef.current)
				return;

			// Exit words trigger shutdown
			if (isExitWord(input)) {
				await handleShutdown();
				return;
			}

			dispatch({
				type: "add-message",
				message: createMessage("user", input),
			});
			dispatch({ type: "set-thinking", value: true });
			processingRef.current = true;

			try {
				const result = await runtime.process(input);
				dispatch({ type: "set-thinking", value: false });
				dispatch({
					type: "add-message",
					message: createMessage("assistant", result.output),
				});

				// Forge restart check
				if (runtime.restartRequested) {
					dispatch({
						type: "add-message",
						message: createMessage(
							"system",
							"Forge restart requested. Rebooting subsystems...",
						),
					});
					try {
						await runtime.shutdown((_, label) => {
							dispatch({
								type: "add-message",
								message: createMessage("system", label),
							});
						});
						runtime.restartRequested = false;
						await runtime.boot({
							...bootConfig(),
							fresh: false,
						});
						dispatch({
							type: "add-message",
							message: createMessage(
								"system",
								"Restart complete.",
							),
						});

						// Report Forge health
						const health = runtime.forgeHealthReport;
						if (health) {
							if (health.loaded.length > 0) {
								dispatch({
									type: "add-message",
									message: createMessage(
										"system",
										`Forge modules loaded: ${health.loaded.join(", ")}`,
									),
								});
							}
							for (const f of health.failed) {
								dispatch({
									type: "add-message",
									message: createMessage(
										"system",
										`Forge module failed: ${f.name} — ${f.error}`,
									),
								});
							}
						}

						// Rebuild command list
						commandsRef.current = runtime.protocols
							.list()
							.map((p) => ({
								name: p.name,
								description: p.description,
								aliases: p.aliases,
							}));
					} catch (error) {
						const msg =
							error instanceof Error
								? error.message
								: "Unknown error";
						dispatch({
							type: "add-message",
							message: createMessage(
								"system",
								`Restart failed: ${msg}`,
							),
						});
					}
				}
			} catch (error) {
				dispatch({ type: "set-thinking", value: false });
				const msg =
					error instanceof Error ? error.message : "Unknown error";
				dispatch({
					type: "add-message",
					message: createMessage("system", `Error: ${msg}`),
				});
			} finally {
				processingRef.current = false;
			}
		},
		[state.phase, bootConfig, handleShutdown],
	);

	// Gate chat behind splash completion
	if (state.phase === "splash" || state.phase === "fading") {
		if (logoDataRef.current) {
			return (
				<box
					style={{
						width: "100%",
						height: "100%",
						backgroundColor: PALETTE.background,
					}}
				>
					<SplashScreen
						logoData={logoDataRef.current}
						onComplete={() =>
							dispatch({ type: "set-phase", phase: "booting" })
						}
					/>
				</box>
			);
		}
		// Logo still loading — show blank dark screen to prevent chat flash
		return (
			<box
				style={{
					width: "100%",
					height: "100%",
					backgroundColor: PALETTE.background,
				}}
			/>
		);
	}

	// Determine input state
	const inputDisabled = state.phase !== "active" || state.isThinking;
	const placeholder =
		state.phase === "booting"
			? "Booting..."
			: state.phase === "shutting-down"
				? "Shutting down..."
				: "Type a message or /command...";

	// Provider info for header
	const runtime = runtimeRef.current;
	const provider = runtime?.isBooted
		? runtime.cortex.providerName
		: options.provider;
	const model = runtime?.isBooted
		? runtime.cortex.modelName
		: (options.model ?? "...");

	const panelWidth = Math.min(60, Math.floor(renderer.width * 0.3));

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			backgroundColor={PALETTE.background}
			shouldFill
			onMouseUp={handleMouseUp}
		>
			<Header provider={provider} model={model} />
			<box flexDirection="row" flexGrow={1}>
				<box flexDirection="column" flexGrow={1}>
					<ChatArea
						messages={state.messages}
						isThinking={state.isThinking}
						welcomeInfo={state.welcomeInfo}
					/>
					<InputBar
						commands={commandsRef.current}
						disabled={inputDisabled}
						placeholder={placeholder}
						onSubmit={handleSubmit}
						onExit={handleShutdown}
					/>
				</box>
				{state.logPanelVisible && (
					<LogPanel entries={logEntries} width={panelWidth} />
				)}
			</box>
		</box>
	);
}

// Entry point — called from chat.ts
export async function launchTui(options: {
	provider: string;
	model?: string;
	fastModel?: string;
	fresh?: boolean;
}): Promise<void> {
	if (!process.stdin.isTTY) {
		console.error(
			"Interactive chat requires a TTY. Use 'friday serve' for the web UI.",
		);
		process.exit(1);
	}

	try {
		const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });
		activeRenderer = renderer;

		// Ensure terminal state is restored on unexpected signals
		const emergencyCleanup = () => {
			renderer.destroy();
			restoreTerminal();
			process.exit(0);
		};
		process.on("SIGTERM", emergencyCleanup);

		// Add toast overlay to the renderer
		const toaster = new ToasterRenderable(renderer, {
			position: "top-right",
			stackingMode: "stack",
			visibleToasts: 3,
			toastOptions: {
				style: {
					backgroundColor: PALETTE.surface,
					foregroundColor: PALETTE.textPrimary,
					borderColor: PALETTE.copperAccent,
				},
			},
		});
		renderer.root.add(toaster);

		const root = createRoot(renderer);
		root.render(<FridayApp options={options} renderer={renderer} />);

		// Keep the process alive — OpenTUI handles the event loop
		// Cleanup happens via renderer.destroy() + process.exit() in the shutdown handler
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		console.error(`Cannot start TUI: ${msg}`);
		console.error("Try 'friday serve' for the web UI instead.");
		process.exit(1);
	}
}
