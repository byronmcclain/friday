import OpenAI from "openai";
import type { ConversationMessage, ContentBlock } from "../core/types.ts";
import type { ChatOptions, ChatResponse, ToolDefinition, LLMProvider } from "./types.ts";
import { toJsonSchema } from "./tool-schema.ts";

/** OpenAI-compatible message types used by the Grok API */
interface GrokMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** Convert Friday ToolDefinition[] to OpenAI function tool format */
export function toGrokTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toJsonSchema(t.parameters),
    },
  }));
}

/** Convert Friday ConversationMessage[] to OpenAI-compatible message format.
 *  Prepends a system message with the given prompt. */
export function toGrokMessages(
  systemPrompt: string,
  messages: ConversationMessage[],
): GrokMessage[] {
  const result: GrokMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
    // String content passes through as-is
    if (typeof msg.content === "string") {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // ContentBlock[] — translate based on role and block types
    const blocks = msg.content as ContentBlock[];

    // Check if this message contains tool_result blocks → expand to separate role:tool messages
    const toolResults = blocks.filter((b) => b.type === "tool_result");
    if (toolResults.length > 0) {
      for (const block of toolResults) {
        if (block.type === "tool_result") {
          result.push({
            role: "tool",
            tool_call_id: block.toolCallId,
            content: block.content,
          });
        }
      }
      continue;
    }

    // Assistant message with text and/or tool_use blocks
    const textBlocks = blocks.filter((b) => b.type === "text");
    const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");

    const textContent = textBlocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");

    const grokMsg: GrokMessage = {
      role: "assistant",
      content: textContent || null,
    };

    if (toolUseBlocks.length > 0) {
      grokMsg.tool_calls = toolUseBlocks
        .filter((b) => b.type === "tool_use")
        .map((b) => {
          if (b.type !== "tool_use") throw new Error("unreachable");
          return {
            id: b.id,
            type: "function" as const,
            function: {
              name: b.name,
              arguments: JSON.stringify(b.input),
            },
          };
        });
    }

    result.push(grokMsg);
  }

  return result;
}

/** Response choice shape from OpenAI-compatible API */
interface GrokChoiceLike {
  finish_reason: string | null;
  message: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>;
  };
}

/** Parse OpenAI-compatible response choice into Friday's ChatResponse */
export function parseGrokResponse(choice: GrokChoiceLike): ChatResponse {
  if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
    const toolCalls = choice.message.tool_calls.map((tc) => {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        console.warn(`Failed to parse tool arguments for ${tc.function.name}, using empty object`);
        input = {};
      }
      return { id: tc.id, name: tc.function.name, input };
    });

    return { type: "tool_use", toolCalls };
  }

  // Text response — must have non-empty content
  const text = choice.message.content;
  if (!text) {
    throw new Error("Grok returned an empty response");
  }

  return { type: "text", text };
}

export class GrokProvider implements LLMProvider {
  readonly name = "grok";
  readonly defaultModel = "grok-4-1-fast-reasoning-latest";
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "XAI_API_KEY is not set. Add it to your .env file to use Grok.\n" +
          "Get your API key at https://console.x.ai",
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.x.ai/v1",
    });
  }

  async chat(
    systemPrompt: string,
    messages: ConversationMessage[],
    options: ChatOptions,
  ): Promise<ChatResponse> {
    const grokMessages = toGrokMessages(systemPrompt, messages);
    const params = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: grokMessages as OpenAI.ChatCompletionMessageParam[],
      ...(options.tools && options.tools.length > 0
        ? { tools: toGrokTools(options.tools) as unknown as OpenAI.ChatCompletionTool[] }
        : {}),
    };

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];
    if (!choice) {
      throw new Error("Grok returned no choices");
    }

    return parseGrokResponse(choice as unknown as GrokChoiceLike);
  }
}
