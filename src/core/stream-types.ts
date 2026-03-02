/** Token usage from an LLM invocation */
export interface TokenUsage {
	inputTokens: number | undefined;
	outputTokens: number | undefined;
}

/** Streaming response from Cortex.chatStream() */
export interface ChatStream {
	/** Async iterable of text chunks as they arrive */
	textStream: AsyncIterable<string>;
	/** Resolves to the full text when streaming completes */
	fullText: PromiseLike<string>;
	/** Resolves to token usage after completion */
	usage: PromiseLike<TokenUsage>;
}
