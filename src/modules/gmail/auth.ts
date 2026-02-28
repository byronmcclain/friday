import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { SecretStore } from "../../core/secrets.ts";

export const GMAIL_SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.modify",
	"https://www.googleapis.com/auth/gmail.labels",
];

const REDIRECT_URI = "http://localhost:3847/oauth2callback";

export class GmailAuth {
	private oauth2Client: OAuth2Client;
	private secrets: SecretStore;
	private authenticated = false;

	constructor(secrets: SecretStore, clientId: string, clientSecret: string) {
		this.secrets = secrets;
		this.oauth2Client = new google.auth.OAuth2(
			clientId,
			clientSecret,
			REDIRECT_URI,
		);

		// Auto-persist refreshed tokens
		this.oauth2Client.on("tokens", async (tokens) => {
			if (tokens.access_token) {
				await this.secrets.encrypt(
					"gmail:access_token",
					tokens.access_token,
				);
			}
			if (tokens.refresh_token) {
				await this.secrets.encrypt(
					"gmail:refresh_token",
					tokens.refresh_token,
				);
			}
			if (tokens.expiry_date) {
				await this.secrets.encrypt(
					"gmail:token_expiry",
					new Date(tokens.expiry_date).toISOString(),
				);
			}
		});
	}

	generateAuthUrl(): string {
		return this.oauth2Client.generateAuthUrl({
			access_type: "offline",
			scope: GMAIL_SCOPES,
			prompt: "consent",
		});
	}

	async exchangeCode(code: string): Promise<void> {
		const { tokens } = await this.oauth2Client.getToken(code);
		this.oauth2Client.setCredentials(tokens);

		if (tokens.access_token) {
			await this.secrets.encrypt(
				"gmail:access_token",
				tokens.access_token,
			);
		}
		if (tokens.refresh_token) {
			await this.secrets.encrypt(
				"gmail:refresh_token",
				tokens.refresh_token,
			);
		}
		if (tokens.expiry_date) {
			await this.secrets.encrypt(
				"gmail:token_expiry",
				new Date(tokens.expiry_date).toISOString(),
			);
		}

		this.authenticated = true;
	}

	async startLocalCallback(): Promise<string> {
		return new Promise((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				server.stop();
				reject(new Error("OAuth callback timed out after 5 minutes"));
			}, 300_000);

			const server = Bun.serve({
				port: 3847,
				fetch(req) {
					const url = new URL(req.url);
					const code = url.searchParams.get("code");
					if (code) {
						if (!settled) {
							settled = true;
							clearTimeout(timer);
							resolve(code);
						}
						setTimeout(() => server.stop(), 100);
						return new Response(
							"<html><body><h1>Authorization successful!</h1><p>You can close this tab.</p></body></html>",
							{ headers: { "Content-Type": "text/html" } },
						);
					}
					const error = url.searchParams.get("error");
					if (!settled) {
						settled = true;
						clearTimeout(timer);
						reject(
							new Error(error ?? "No authorization code received"),
						);
					}
					setTimeout(() => server.stop(), 100);
					return new Response("Authorization failed", {
						status: 400,
					});
				},
			});
		});
	}

	async loadTokens(): Promise<boolean> {
		const accessToken = await this.secrets.decrypt("gmail:access_token");
		const refreshToken = await this.secrets.decrypt("gmail:refresh_token");

		if (!accessToken || !refreshToken) {
			return false;
		}

		const expiryStr = await this.secrets.decrypt("gmail:token_expiry");
		const expiry = expiryStr ? new Date(expiryStr).getTime() : undefined;

		this.oauth2Client.setCredentials({
			access_token: accessToken,
			refresh_token: refreshToken,
			expiry_date: expiry,
		});

		this.authenticated = true;
		return true;
	}

	isAuthenticated(): boolean {
		return this.authenticated;
	}

	getClient(): OAuth2Client {
		return this.oauth2Client;
	}
}
