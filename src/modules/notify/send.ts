import type { FridayTool, ToolContext, ToolResult } from "../types.ts";
import { assertAllowedProtocol, assertNotPrivateIP } from "../validation.ts";
import { SLACK_LEVEL_EMOJI } from "../../core/notifications.ts";

const WEBHOOK_TIMEOUT_MS = 10_000;

export const notifySend: FridayTool = {
	name: "notify.send",
	description:
		"Send a notification to all connected clients (TUI toast, web UI) and optionally to external channels (Slack, webhook, email). Always delivers locally; external delivery requires a configured URL.",
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
				'External channel: "slack", "webhook", "email", or omit for local-only (default: none)',
			required: false,
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

		const channel = args.channel as string | undefined;
		const explicitUrl = args.url as string | undefined;

		// Always fire through NotificationManager (→ TUI toast, web UI, etc.)
		const localDelivered = !!context.notifications;
		if (context.notifications) {
			await context.notifications.notify({
				level: level as "info" | "warning" | "alert",
				title,
				body,
				source: "notify.send",
			});
		}

		// If no external channel requested, we're done
		if (!channel) {
			await context.audit.log({
				action: "tool:notify.send",
				source: "notify.send",
				detail: `Sent local notification: ${title}`,
				success: true,
			});
			return {
				success: true,
				output: localDelivered
					? `Notification sent locally: ${title}`
					: "No notification channels available",
				artifacts: { level, title, delivered: localDelivered ? ["local"] : [] },
			};
		}

		// External channel dispatch
		const suffix = localDelivered ? " — delivered locally" : "";
		try {
			switch (channel) {
				case "slack": {
					const webhookUrl =
						explicitUrl ?? process.env.FRIDAY_SLACK_WEBHOOK_URL;
					if (!webhookUrl) {
						return {
							success: localDelivered,
							output: localDelivered
								? `Notification sent locally but no Slack webhook URL configured. Provide 'url' parameter or set FRIDAY_SLACK_WEBHOOK_URL env var.`
								: "No Slack webhook URL. Provide 'url' parameter or set FRIDAY_SLACK_WEBHOOK_URL env var.",
						};
					}
					const slackProtocolCheck = assertAllowedProtocol(webhookUrl);
					if (slackProtocolCheck) return slackProtocolCheck;
					const slackIpCheck = assertNotPrivateIP(webhookUrl);
					if (slackIpCheck) return slackIpCheck;

					const payload = {
						text: `${SLACK_LEVEL_EMOJI[level]} *${title}*\n${body}`,
					};

					return dispatchNotification("Slack", webhookUrl, payload, title, level, localDelivered, context);
				}

				case "webhook": {
					const webhookUrl =
						explicitUrl ?? process.env.FRIDAY_WEBHOOK_URL;
					if (!webhookUrl) {
						return {
							success: localDelivered,
							output: localDelivered
								? `Notification sent locally but no webhook URL configured. Provide 'url' parameter or set FRIDAY_WEBHOOK_URL env var.`
								: "No webhook URL. Provide 'url' parameter or set FRIDAY_WEBHOOK_URL env var.",
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

					return dispatchNotification("Webhook", webhookUrl, payload, title, level, localDelivered, context);
				}

				case "email": {
					const emailWebhookUrl =
						explicitUrl ?? process.env.FRIDAY_EMAIL_WEBHOOK_URL;
					if (!emailWebhookUrl) {
						return {
							success: localDelivered,
							output: localDelivered
								? `Notification sent locally but no email webhook URL configured. Provide 'url' parameter or set FRIDAY_EMAIL_WEBHOOK_URL env var.`
								: "No email webhook URL. Provide 'url' parameter or set FRIDAY_EMAIL_WEBHOOK_URL env var.",
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

					return dispatchNotification("Email", emailWebhookUrl, payload, title, level, localDelivered, context);
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
					success: localDelivered,
					output: `Notification timed out (${channel})${suffix}`,
				};
			}
			const msg = err instanceof Error ? err.message : String(err);
			return {
				success: localDelivered,
				output: `External notification failed: ${msg}${suffix}`,
			};
		}
	},
};

async function dispatchNotification(
	channelLabel: string,
	webhookUrl: string,
	payload: Record<string, unknown>,
	title: string,
	level: string,
	localDelivered: boolean,
	context: ToolContext,
): Promise<ToolResult> {
	const result = await sendWebhook(webhookUrl, payload);
	const suffix = localDelivered ? " — delivered locally" : "";
	if (!result.ok) {
		return {
			success: localDelivered,
			output: `${channelLabel} webhook failed: ${result.status} ${result.statusText}${suffix}`,
		};
	}

	const channelKey = channelLabel.toLowerCase();
	const delivered = localDelivered ? ["local", channelKey] : [channelKey];

	await context.audit.log({
		action: "tool:notify.send",
		source: "notify.send",
		detail: `Sent notification: ${title} (${delivered.join(", ")})`,
		success: true,
	});

	return {
		success: true,
		output: `Notification sent (${delivered.join(", ")}): ${title}`,
		artifacts: { channel: channelLabel, level, title, delivered },
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
