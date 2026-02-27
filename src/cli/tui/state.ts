export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
}

export interface WelcomeInfo {
	provider: string;
	model: string;
}

export interface AppState {
	phase: "splash" | "booting" | "active" | "shutting-down";
	messages: Message[];
	isThinking: boolean;
	welcomeInfo?: WelcomeInfo;
	logPanelVisible: boolean;
}

export type AppAction =
	| { type: "add-message"; message: Message }
	| { type: "chat:chunk"; text: string }
	| { type: "set-thinking"; value: boolean }
	| { type: "set-phase"; phase: AppState["phase"] }
	| { type: "set-welcome"; info: WelcomeInfo }
	| { type: "clear-messages" }
	| { type: "toggle-log-panel" };

export const initialState: AppState = {
	phase: "splash",
	messages: [],
	isThinking: false,
	logPanelVisible: false,
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
			return { ...state, messages: msgs };
		}
		case "set-thinking":
			return { ...state, isThinking: action.value };
		case "set-phase":
			return { ...state, phase: action.phase };
		case "set-welcome":
			return { ...state, welcomeInfo: action.info };
		case "clear-messages":
			return { ...state, messages: [] };
		case "toggle-log-panel":
			return { ...state, logPanelVisible: !state.logPanelVisible };
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
