import { useReducer, useEffect, useCallback, useRef } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { toast, ToasterRenderable } from "@opentui-ui/toast";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FridayRuntime } from "../../core/runtime.ts";
import type { ProviderName } from "../../core/types.ts";
import { TuiChannel } from "./channels/tui-channel.ts";
import { appReducer, initialState, isExitWord, createMessage } from "./state.ts";
import { PALETTE } from "./theme.ts";
import { Header } from "./components/header.tsx";
import { ChatArea } from "./components/chat-area.tsx";
import { InputBar } from "./components/input-bar.tsx";
import type { TypeaheadEntry } from "./filter-commands.ts";

// Module-level renderer reference so shutdown can call destroy()
let activeRenderer: Awaited<ReturnType<typeof createCliRenderer>> | null =
	null;

interface FridayAppProps {
	options: {
		provider: string;
		model?: string;
		fastModel?: string;
		fresh?: boolean;
	};
}

function FridayApp({ options }: FridayAppProps) {
	const [state, dispatch] = useReducer(appReducer, initialState);
	const runtimeRef = useRef<FridayRuntime | null>(null);
	const commandsRef = useRef<TypeaheadEntry[]>([]);
	const processingRef = useRef(false);

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
		}),
		[options, projectRoot],
	);

	// Boot runtime on mount
	useEffect(() => {
		const runtime = new FridayRuntime();
		runtimeRef.current = runtime;

		(async () => {
			dispatch({
				type: "add-message",
				message: createMessage("system", "Booting Friday..."),
			});
			try {
				await runtime.boot(bootConfig());

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
				dispatch({
					type: "set-welcome",
					info: { provider: providerLabel, model: modelLabel },
				});
				dispatch({
					type: "add-message",
					message: createMessage(
						"system",
						`Friday online. (${providerLabel}: ${modelLabel})`,
					),
				});
				dispatch({ type: "set-phase", phase: "active" });
			} catch (error) {
				const msg =
					error instanceof Error
						? error.message
						: "Unknown boot error";
				dispatch({
					type: "add-message",
					message: createMessage("system", `Boot failed: ${msg}`),
				});
			}
		})();
	}, [bootConfig]);

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
			});
			dispatch({
				type: "add-message",
				message: createMessage("system", "Shutdown complete."),
			});
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
			process.exit(0);
		}, 500);
	}, [state.phase]);

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

	return (
		<box
			flexDirection="column"
			width="100%"
			height="100%"
			backgroundColor={PALETTE.background}
		>
			<Header provider={provider} model={model} />
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
		const renderer = await createCliRenderer({ exitOnCtrlC: false });
		activeRenderer = renderer;

		// Ensure terminal state is restored on unexpected signals
		const emergencyCleanup = () => {
			renderer.destroy();
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
		root.render(<FridayApp options={options} />);

		// Keep the process alive — OpenTUI handles the event loop
		// Cleanup happens via renderer.destroy() + process.exit() in the shutdown handler
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		console.error(`Cannot start TUI: ${msg}`);
		console.error("Try 'friday serve' for the web UI instead.");
		process.exit(1);
	}
}
