/** Streaming response from Cortex.chatStream() */
export interface ChatStream {
	/** Async iterable of text chunks as they arrive */
	textStream: AsyncIterable<string>;
	/** Resolves to the full text when streaming completes */
	fullText: Promise<string>;
	/** Resolves to token usage after completion */
	usage: Promise<{
		inputTokens: number | undefined;
		outputTokens: number | undefined;
	}>;
}
