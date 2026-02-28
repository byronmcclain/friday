import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertAllowedProtocol, assertNotPrivateIP } from "../validation.ts";

const WEBHOOK_TIMEOUT_MS = 10_000;

export const notifySend: FridayTool = {
	name: "notify.send",
	description:
		"Send a notification via configured channels. Supports Slack webhooks, generic webhooks, and email (via SMTP relay webhook). Use for alerts, status updates, and automated notifications triggered by directives.",
	parameters: [
		{
			name: "title",
			type: "string",
			description: "Notification title/subject",
			required: true,
		},
		{
			name: "body",
			type: "string",
			description: "Notification body/message",
			required: true,
		},
		{
			name: "level",
			type: "string",
			description:
				'Notification level: "info", "warning", "alert" (default: "info")',
			required: false,
			default: "info",
		},
		{
			name: "channel",
			type: "string",
			description:
				'Target channel: "slack", "webhook", "email" (default: "webhook")',
			required: false,
			default: "webhook",
		},
		{
			name: "url",
			type: "string",
			description:
				"Webhook URL to send to. Falls back to FRIDAY_WEBHOOK_URL or FRIDAY_SLACK_WEBHOOK_URL env var.",
			required: false,
		},
	],
	clearance: ["network"],

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const title = args.title as string;
		if (!title) {
			return { success: false, output: "Missing required parameter: title" };
		}
		const body = args.body as string;
		if (!body) {
			return { success: false, output: "Missing required parameter: body" };
		}

		const level = (args.level as string) ?? "info";
		if (!["info", "warning", "alert"].includes(level)) {
			return {
				success: false,
				output: `Invalid level: ${level}. Use "info", "warning", or "alert".`,
			};
		}

		const channel = (args.channel as string) ?? "webhook";
		const explicitUrl = args.url as string | undefined;

		try {
			switch (channel) {
				case "slack": {
					const webhookUrl =
						explicitUrl ?? process.env.FRIDAY_SLACK_WEBHOOK_URL;
					if (!webhookUrl) {
						return {
							success: false,
							output:
								"No Slack webhook URL. Provide 'url' parameter or set FRIDAY_SLACK_WEBHOOK_URL env var.",
						};
					}
					const slackProtocolCheck = assertAllowedProtocol(webhookUrl);
					if (slackProtocolCheck) return slackProtocolCheck;
					const slackIpCheck = assertNotPrivateIP(webhookUrl);
					if (slackIpCheck) return slackIpCheck;

					const emoji: Record<string, string> = {
						info: ":information_source:",
						warning: ":warning:",
						alert: ":rotating_light:",
					};

					const payload = {
						text: `${emoji[level]} *${title}*\n${body}`,
					};

					return dispatchNotification("Slack", webhookUrl, payload, title, level, context);
				}

				case "webhook": {
					const webhookUrl =
						explicitUrl ?? process.env.FRIDAY_WEBHOOK_URL;
					if (!webhookUrl) {
						return {
							success: false,
							output:
								"No webhook URL. Provide 'url' parameter or set FRIDAY_WEBHOOK_URL env var.",
						};
					}
					const webhookProtocolCheck = assertAllowedProtocol(webhookUrl);
					if (webhookProtocolCheck) return webhookProtocolCheck;
					const webhookIpCheck = assertNotPrivateIP(webhookUrl);
					if (webhookIpCheck) return webhookIpCheck;

					const payload = {
						level,
						title,
						body,
						source: "friday",
						timestamp: new Date().toISOString(),
					};

					return dispatchNotification("Webhook", webhookUrl, payload, title, level, context);
				}

				case "email": {
					const emailWebhookUrl =
						explicitUrl ?? process.env.FRIDAY_EMAIL_WEBHOOK_URL;
					if (!emailWebhookUrl) {
						return {
							success: false,
							output:
								"No email webhook URL. Provide 'url' parameter or set FRIDAY_EMAIL_WEBHOOK_URL env var.",
						};
					}
					const emailProtocolCheck = assertAllowedProtocol(emailWebhookUrl);
					if (emailProtocolCheck) return emailProtocolCheck;
					const emailIpCheck = assertNotPrivateIP(emailWebhookUrl);
					if (emailIpCheck) return emailIpCheck;

					const payload = {
						subject: `[Friday ${level.toUpperCase()}] ${title}`,
						body,
						level,
						source: "friday",
						timestamp: new Date().toISOString(),
					};

					return dispatchNotification("Email", emailWebhookUrl, payload, title, level, context);
				}

				default:
					return {
						success: false,
						output: `Unsupported channel: ${channel}. Use "slack", "webhook", or "email".`,
					};
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === "AbortError") {
				return {
					success: false,
					output: `Notification timed out (${channel})`,
				};
			}
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, output: `Notification failed: ${msg}` };
		}
	},
};

async function dispatchNotification(
	channel: string,
	webhookUrl: string,
	payload: Record<string, unknown>,
	title: string,
	level: string,
	context: ToolContext,
): Promise<ToolResult> {
	const result = await sendWebhook(webhookUrl, payload);
	if (!result.ok) {
		return {
			success: false,
			output: `${channel} webhook failed: ${result.status} ${result.statusText}`,
		};
	}

	await context.audit.log({
		action: "tool:notify.send",
		source: "notify.send",
		detail: `Sent ${channel} notification: ${title}`,
		success: true,
	});

	return {
		success: true,
		output: `${channel} notification sent: ${title}`,
		artifacts: { channel, level, title },
	};
}

async function sendWebhook(
	url: string,
	payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; statusText: string }> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		// Consume response body to free the connection
		await response.text();
		return {
			ok: response.ok,
			status: response.status,
			statusText: response.statusText,
		};
	} finally {
		clearTimeout(timeoutId);
	}
}
