import { useReducer, useEffect, useState, useCallback, useRef } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { toast, ToasterRenderable } from "@opentui-ui/toast";
import { resolve } from "node:path";
import { writeSync } from "node:fs";
import type { RuntimeBridge } from "../../core/bridges/types.ts";
import { SocketBridge } from "../../core/bridges/socket.ts";
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
import { LOG_ICONS, type LogEntry } from "./log-types.ts";

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

// Project root — used for logo path resolution
const projectRoot = resolve(import.meta.dir, "../../..");

interface FridayAppProps {
	options: {
		socketPath: string;
	};
	renderer: Awaited<ReturnType<typeof createCliRenderer>>;
}

function FridayApp({ options, renderer }: FridayAppProps) {
	const [state, dispatch] = useReducer(appReducer, initialState);
	const bridgeRef = useRef<RuntimeBridge | null>(null);
	const commandsRef = useRef<TypeaheadEntry[]>([]);
	const processingRef = useRef(false);
	const logoDataRef = useRef<LogoData | null>(null);
	const [bootComplete, setBootComplete] = useState(false);
	const logStoreRef = useRef(new LogStore());
	const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
	const isShuttingDownRef = useRef(false);
	const phaseRef = useRef(state.phase);
	phaseRef.current = state.phase;

	// Add toast overlay AFTER React's initial commit — must happen here
	// because React's ConcurrentRoot calls clearContainer() during the
	// first commit, which removes all pre-existing renderer.root children.
	useEffect(() => {
		const toastWidth = Math.min(100, Math.floor(renderer.width * 0.6));
		const toaster = new ToasterRenderable(renderer, {
			position: "top-right",
			stackingMode: "stack",
			visibleToasts: 3,
			maxWidth: toastWidth,
			toastOptions: {
				duration: 8000,
				style: {
					backgroundColor: PALETTE.surface,
					foregroundColor: PALETTE.textPrimary,
					borderColor: PALETTE.copperAccent,
					maxWidth: toastWidth,
				},
			},
		});
		renderer.root.add(toaster);
		return () => {
			renderer.root.remove(toaster.id);
			toaster.destroy();
		};
	}, [renderer]);

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

	// Subscribe to LogStore changes to update React state
	useEffect(() => {
		const store = logStoreRef.current;
		const cb = () => setLogEntries([...store.entries]);
		store.subscribe(cb);
		return () => store.unsubscribe(cb);
	}, []);

	// Boot runtime on mount — connects to singleton server via socket
	useEffect(() => {
		let cancelled = false;

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

			// Connect to singleton runtime via socket
			dispatch({
				type: "add-message",
				message: createMessage("system", "Connecting to singleton runtime..."),
			});
			pushLog("info", "runtime", "Connecting to singleton runtime...");
			try {
				const socketBridge = new SocketBridge(options.socketPath);
				await socketBridge.connect();
				bridgeRef.current = socketBridge;

				// Wire conversation sync — receives both history replay and live messages from other clients
				socketBridge.onConversationMessage = (msg) => {
					if (cancelled) return;
					dispatch({
						type: "add-message",
						message: createMessage(msg.role as "user" | "assistant", msg.content),
					});
				};

				// Wire audit log entries from the server into the TUI log panel
				socketBridge.onAuditEntry = (entry) => {
					if (cancelled) return;
					const level: LogEntry["level"] = entry.success ? "info" : "warning";
					pushLog(level, entry.source, entry.action, entry.detail);
				};

				// Wire tool signals from the server into the TUI state
				socketBridge.onToolExecuting = (name, args) => {
					if (cancelled) return;
					dispatch({ type: "tool:executing", name, args });
				};
				socketBridge.onToolCompleted = () => {
					if (cancelled) return;
					dispatch({ type: "tool:completed" });
				};

				// Wire notification push from the server into TUI toast + log panel
				socketBridge.onNotification = (msg) => {
					if (cancelled) return;
					const logLevel: LogEntry["level"] = msg.level === "alert" ? "error" : msg.level === "warning" ? "warning" : "info";
					// Toast shows title + truncated body preview; full content lives in the log panel
					const preview = msg.body.length > 160
						? msg.body.slice(0, 160).trimEnd() + "…"
						: msg.body;
					toast(`${LOG_ICONS[logLevel]} ${msg.title}`, { description: preview });
					pushLog(logLevel, msg.source, msg.title, msg.body);
				};

				if (cancelled) return;

				// Query the server for actual model info
				let runtimeModel = "...";
				try {
					const info = await socketBridge.identify();
					runtimeModel = info.model;
				} catch {
					// Identification failed — use fallback
				}

				// Fetch available protocols for typeahead
				try {
					const protocols = await socketBridge.listProtocols();
					commandsRef.current = protocols.map((p) => ({
						name: p.name,
						description: p.description,
						aliases: p.aliases ?? [],
					}));
				} catch {
					// Protocol list unavailable — typeahead will be empty
				}

				dispatch({
					type: "set-welcome",
					info: { model: runtimeModel },
				});
				dispatch({
					type: "add-message",
					message: createMessage("system", `Connected to singleton runtime. (Grok: ${runtimeModel})`),
				});
				if (cancelled) return;
				setBootComplete(true);
				pushLog("success", "runtime", `Connected to singleton runtime. (Grok: ${runtimeModel})`);
			} catch (error) {
				if (cancelled) return;
				const msg =
					error instanceof Error
						? error.message
						: "Unknown connection error";
				dispatch({
					type: "add-message",
					message: createMessage("system", `Connection failed: ${msg}`),
				});
				pushLog("error", "runtime", `Connection failed: ${msg}`);
			}
		})();

		return () => { cancelled = true; };
	}, [options.socketPath]);

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
		if (isShuttingDownRef.current) return;
		const bridge = bridgeRef.current;
		if (!bridge) return;
		isShuttingDownRef.current = true;

		dispatch({ type: "set-phase", phase: "shutting-down" });
		try {
			await bridge.shutdown();
			dispatch({
				type: "add-message",
				message: createMessage("system", "Disconnected."),
			});
			pushLog("success", "runtime", "Disconnected.");
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
	}, []);

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
			const bridge = bridgeRef.current;
			if (!bridge || phaseRef.current !== "active" || processingRef.current)
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
				const isProtocol = input.startsWith("/");

				if (isProtocol) {
					const result = await bridge.process(input);
					dispatch({ type: "set-thinking", value: false });
					dispatch({
						type: "add-message",
						message: createMessage("assistant", result.output),
					});
				} else {
					// Streaming path — dispatch chunks as they arrive.
					// isThinking stays true until chat:chunk clears it (first token).
					const stream = bridge.chat(input);

					for await (const chunk of stream) {
						dispatch({ type: "chat:chunk", text: chunk });
					}
					dispatch({ type: "chat:done" });
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
		[handleShutdown],
	);

	// Gate chat behind splash completion
	if (state.phase === "splash") {
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
	const inputDisabled = state.phase !== "active" || state.isThinking || state.isStreaming;
	const placeholder =
		state.phase === "booting"
			? "Booting..."
			: state.phase === "shutting-down"
				? "Shutting down..."
				: "Type a message or /command...";

	const model = state.welcomeInfo?.model ?? "...";

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
			<Header model={model} />
			<box flexDirection="row" flexGrow={1}>
				<box flexDirection="column" flexGrow={1}>
					<ChatArea
						messages={state.messages}
						isThinking={state.isThinking}
						isStreaming={state.isStreaming}
						welcomeInfo={state.welcomeInfo}
						currentTool={state.currentTool}
					/>
					<InputBar
						commands={commandsRef.current}
						disabled={inputDisabled}
						placeholder={placeholder}
						onSubmit={handleSubmit}
						onExit={handleShutdown}
						isThinking={state.isThinking}
						isStreaming={state.isStreaming}
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
	socketPath: string;
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
		process.on("SIGINT", emergencyCleanup);

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
