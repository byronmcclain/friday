import OpenAI from "openai";
import type { ConversationMessage } from "../core/types.ts";
import type { ChatOptions, LLMProvider } from "./types.ts";

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
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [
        { role: "system" as const, content: systemPrompt },
        ...messages,
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`Grok returned an empty response (model: ${options.model})`);
    }
    return content;
  }
}
