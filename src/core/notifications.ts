import chalk from "chalk";
import type { AuditLogger } from "../audit/logger.ts";

export interface FridayNotification {
  level: "info" | "warning" | "alert";
  title: string;
  body: string;
  source: string;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  protocol: string;
  args?: Record<string, unknown>;
}

export interface NotificationChannel {
  name: string;
  send(notification: FridayNotification): Promise<void>;
}

export class NotificationManager {
  private channels: Map<string, NotificationChannel>;

  constructor(channels: NotificationChannel[] = []) {
    this.channels = new Map(channels.map((c) => [c.name, c]));
  }

  addChannel(channel: NotificationChannel): void {
    this.channels.set(channel.name, channel);
  }

  removeChannel(name: string): void {
    this.channels.delete(name);
  }

  async notify(
    notification: FridayNotification,
    channelNames?: string[],
  ): Promise<void> {
    const targets = channelNames
      ? (channelNames
          .map((n) => this.channels.get(n))
          .filter(Boolean) as NotificationChannel[])
      : [...this.channels.values()];

    for (const channel of targets) {
      try {
        await channel.send(notification);
      } catch (err) {
        console.error(`Notification channel '${channel.name}' failed:`, err);
      }
    }
  }
}

export class TerminalChannel implements NotificationChannel {
  name = "terminal";

  async send(notification: FridayNotification): Promise<void> {
    const prefix = {
      info: chalk.blue("[INFO]"),
      warning: chalk.yellow("[WARN]"),
      alert: chalk.red.bold("[ALERT]"),
    }[notification.level];
    console.log(
      `\n${prefix} ${chalk.bold(notification.title)}\n${notification.body}\n`,
    );
  }
}

export class AuditLogChannel implements NotificationChannel {
  name = "audit";
  private audit: AuditLogger;

  constructor(audit: AuditLogger) {
    this.audit = audit;
  }

  async send(notification: FridayNotification): Promise<void> {
    this.audit.log({
      action: `notification:${notification.level}`,
      source: notification.source,
      detail: `${notification.title}: ${notification.body}`,
      success: true,
    });
  }
}

export class WebhookChannel implements NotificationChannel {
  name = "webhook";
  private url: string;
  private headers: Record<string, string>;

  constructor(config: { url: string; headers?: Record<string, string> }) {
    this.url = config.url;
    this.headers = config.headers ?? {};
  }

  async send(notification: FridayNotification): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify(notification),
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const SLACK_LEVEL_EMOJI: Record<string, string> = {
  info: ":information_source:",
  warning: ":warning:",
  alert: ":rotating_light:",
};

export class SlackChannel implements NotificationChannel {
  name = "slack";
  private webhookUrl: string;

  constructor(config: { webhookUrl: string }) {
    this.webhookUrl = config.webhookUrl;
  }

  async send(notification: FridayNotification): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `${SLACK_LEVEL_EMOJI[notification.level]} *${notification.title}*\n${notification.body}`,
        }),
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
