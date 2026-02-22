export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
}

export interface AppState {
	phase: "booting" | "active" | "shutting-down";
	messages: Message[];
	isThinking: boolean;
}

export type AppAction =
	| { type: "add-message"; message: Message }
	| { type: "set-thinking"; value: boolean }
	| { type: "set-phase"; phase: AppState["phase"] }
	| { type: "clear-messages" };

export const initialState: AppState = {
	phase: "booting",
	messages: [],
	isThinking: false,
};

export function appReducer(state: AppState, action: AppAction): AppState {
	switch (action.type) {
		case "add-message":
			return { ...state, messages: [...state.messages, action.message] };
		case "set-thinking":
			return { ...state, isThinking: action.value };
		case "set-phase":
			return { ...state, phase: action.phase };
		case "clear-messages":
			return { ...state, messages: [] };
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
