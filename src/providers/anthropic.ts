import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage, ContentBlock } from "../core/types.ts";
import type { ChatOptions, ChatResponse, ToolDefinition, LLMProvider } from "./types.ts";
import { toJsonSchema } from "./tool-schema.ts";

/** Convert Friday ToolDefinition[] to Anthropic API tool format */
export function toAnthropicTools(
  tools: ToolDefinition[],
): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toJsonSchema(t.parameters) as Anthropic.Messages.Tool.InputSchema,
  }));
}

/** Convert Friday ConversationMessage[] to Anthropic API message format */
export function toAnthropicMessages(
  messages: ConversationMessage[],
): Anthropic.Messages.MessageParam[] {
  return messages.map((msg) => {
    // String content passes through as-is
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }

    // ContentBlock[] — translate each block
    const blocks = (msg.content as ContentBlock[]).map((block) => {
      switch (block.type) {
        case "text":
          return { type: "text" as const, text: block.text };
        case "tool_use":
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        case "tool_result":
          return {
            type: "tool_result" as const,
            tool_use_id: block.toolCallId,
            content: block.content,
            is_error: block.isError,
          };
        default: {
          const _exhaustive: never = block;
          throw new Error(`Unknown content block type: ${(_exhaustive as { type: string }).type}`);
        }
      }
    });

    return {
      role: msg.role,
      content: blocks,
    } as Anthropic.Messages.MessageParam;
  });
}

/** Response shape we extract from the Anthropic API response for parseAnthropicResponse.
 *  Uses a broad content type to accept Anthropic SDK's ContentBlock union
 *  (which includes ThinkingBlock, RedactedThinkingBlock, etc.). We filter
 *  to text/tool_use at runtime. */
interface AnthropicResponseLike {
  content: Array<{ type: string; [key: string]: unknown }>;
  stop_reason: string | null;
}

/** Parse Anthropic API response into Friday's ChatResponse */
export function parseAnthropicResponse(response: AnthropicResponseLike): ChatResponse {
  if (response.content.length === 0) {
    throw new Error("Anthropic returned empty response");
  }

  if (response.stop_reason === "tool_use") {
    const toolCalls = response.content
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: block.id as string,
        name: block.name as string,
        input: block.input as Record<string, unknown>,
      }));

    return { type: "tool_use", toolCalls };
  }

  // Text response — join all text blocks
  const textBlocks = response.content.filter((block) => block.type === "text");
  if (textBlocks.length === 0) {
    throw new Error("Anthropic response contained no text blocks");
  }
  const text = textBlocks.map((block) => block.text as string).join("");

  return { type: "text", text };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly defaultModel = "claude-sonnet-4-20250514";
  readonly defaultFastModel = "claude-haiku-4-5-20251001";
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to your .env file to use Anthropic.\n" +
          "Get your API key at https://console.anthropic.com",
      );
    }
    this.client = new Anthropic();
  }

  async chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: options.model,
      max_tokens: options.maxTokens,
      system: systemPrompt,
      messages: toAnthropicMessages(messages),
    };

    if (options.tools && options.tools.length > 0) {
      params.tools = toAnthropicTools(options.tools);
    }

    const response = await this.client.messages.create(params);
    return parseAnthropicResponse(
      response as unknown as AnthropicResponseLike,
    );
  }
}
