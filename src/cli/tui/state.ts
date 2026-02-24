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
	phase: "splash" | "fading" | "booting" | "active" | "shutting-down";
	messages: Message[];
	isThinking: boolean;
	welcomeInfo?: WelcomeInfo;
	logPanelVisible: boolean;
}

export type AppAction =
	| { type: "add-message"; message: Message }
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
