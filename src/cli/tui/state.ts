export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
}

export interface WelcomeInfo {
	model: string;
}

export interface ToolInfo {
	name: string;
	args: Record<string, unknown>;
}

export interface AppState {
	phase: "splash" | "booting" | "active" | "shutting-down";
	messages: Message[];
	isThinking: boolean;
	isStreaming: boolean;
	welcomeInfo?: WelcomeInfo;
	logPanelVisible: boolean;
	currentTool: ToolInfo | null;
}

export type AppAction =
	| { type: "add-message"; message: Message }
	| { type: "chat:chunk"; text: string }
	| { type: "chat:done" }
	| { type: "set-thinking"; value: boolean }
	| { type: "set-phase"; phase: AppState["phase"] }
	| { type: "set-welcome"; info: WelcomeInfo }
	| { type: "clear-messages" }
	| { type: "toggle-log-panel" }
	| { type: "tool:executing"; name: string; args: Record<string, unknown> }
	| { type: "tool:completed" };

export const initialState: AppState = {
	phase: "splash",
	messages: [],
	isThinking: false,
	isStreaming: false,
	logPanelVisible: false,
	currentTool: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
	switch (action.type) {
		case "add-message":
			return { ...state, messages: [...state.messages, action.message] };
		case "chat:chunk": {
			const msgs = [...state.messages];
			const last = msgs[msgs.length - 1];
			if (last && last.role === "assistant") {
				msgs[msgs.length - 1] = { ...last, content: last.content + action.text };
			} else {
				msgs.push({
					id: crypto.randomUUID(),
					role: "assistant",
					content: action.text,
					timestamp: new Date(),
				});
			}
			return { ...state, messages: msgs, isThinking: false, isStreaming: true, currentTool: null };
		}
		case "chat:done":
			return { ...state, isStreaming: false };
		case "set-thinking":
			return {
				...state,
				isThinking: action.value,
				currentTool: action.value ? state.currentTool : null,
			};
		case "set-phase":
			return { ...state, phase: action.phase };
		case "set-welcome":
			return { ...state, welcomeInfo: action.info };
		case "clear-messages":
			return { ...state, messages: [] };
		case "toggle-log-panel":
			return { ...state, logPanelVisible: !state.logPanelVisible };
		case "tool:executing":
			return { ...state, currentTool: { name: action.name, args: action.args } };
		case "tool:completed":
			return { ...state, currentTool: null };
	}
}

export function isExitWord(input: string): boolean {
	const trimmed = input.trim().toLowerCase();
	return ["exit", "quit", "bye"].includes(trimmed);
}

export function createMessage(
	role: Message["role"],
	content: string,
): Message {
	return {
		id: crypto.randomUUID(),
		role,
		content,
		timestamp: new Date(),
	};
}
