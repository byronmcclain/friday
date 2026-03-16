import { Bot } from "grammy";

export class TelegramClient {
	private bot: Bot;
	private ownerChatId: number | null = null;
	private cachedMe: { id: number; username: string } | null = null;

	constructor(token: string) {
		this.bot = new Bot(token);
	}

	getBot(): Bot {
		return this.bot;
	}

	async sendMessage(chatId: number, text: string): Promise<void> {
		await this.bot.api.sendMessage(chatId, text, {
			parse_mode: "Markdown",
		});
	}

	async getMe(): Promise<{ id: number; username: string }> {
		if (this.cachedMe) return this.cachedMe;
		const me = await this.bot.api.getMe();
		this.cachedMe = { id: me.id, username: me.username ?? "" };
		return this.cachedMe;
	}

	setOwnerChatId(chatId: number): void {
		this.ownerChatId = chatId;
	}

	getOwnerChatId(): number | null {
		return this.ownerChatId;
	}
}
