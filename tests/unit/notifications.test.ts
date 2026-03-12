import { describe, test, expect } from "bun:test";
import {
  NotificationManager,
  TerminalChannel,
  AuditLogChannel,
} from "../../src/core/notifications.ts";
import type { NotificationChannel } from "../../src/core/notifications.ts";
import { AuditLogger } from "../../src/audit/logger.ts";

describe("NotificationManager", () => {
  test("sends notification to all registered channels", async () => {
    const sent: string[] = [];
    const ch1: NotificationChannel = {
      name: "ch1",
      send: async (n) => { sent.push(`ch1:${n.title}`); },
    };
    const ch2: NotificationChannel = {
      name: "ch2",
      send: async (n) => { sent.push(`ch2:${n.title}`); },
    };
    const manager = new NotificationManager([ch1, ch2]);
    await manager.notify({
      level: "info",
      title: "Test",
      body: "hello",
      source: "test",
    });
    expect(sent).toEqual(["ch1:Test", "ch2:Test"]);
  });

  test("sends to specific channels only", async () => {
    const sent: string[] = [];
    const ch1: NotificationChannel = {
      name: "terminal",
      send: async () => { sent.push("terminal"); },
    };
    const ch2: NotificationChannel = {
      name: "slack",
      send: async () => { sent.push("slack"); },
    };
    const manager = new NotificationManager([ch1, ch2]);
    await manager.notify(
      { level: "info", title: "Test", body: "hello", source: "test" },
      ["terminal"],
    );
    expect(sent).toEqual(["terminal"]);
  });

  test("continues sending if one channel fails", async () => {
    const sent: string[] = [];
    const failing: NotificationChannel = {
      name: "failing",
      send: async () => { throw new Error("boom"); },
    };
    const working: NotificationChannel = {
      name: "working",
      send: async () => { sent.push("ok"); },
    };
    const manager = new NotificationManager([failing, working]);
    await manager.notify({
      level: "alert",
      title: "Test",
      body: "hello",
      source: "test",
    });
    expect(sent).toEqual(["ok"]);
  });
});

describe("TerminalChannel", () => {
  test("has name 'terminal'", () => {
    const channel = new TerminalChannel();
    expect(channel.name).toBe("terminal");
  });
});

describe("AuditLogChannel", () => {
  test("has name 'audit'", () => {
    const audit = new AuditLogger();
    const channel = new AuditLogChannel(audit);
    expect(channel.name).toBe("audit");
  });

  test("send() logs notification as audit entry", async () => {
    const audit = new AuditLogger();
    const channel = new AuditLogChannel(audit);
    await channel.send({
      level: "warning",
      title: "Memory High",
      body: "Memory usage at 92%",
      source: "sensorium",
    });

    const entries = audit.entries({ action: "notification:warning" });
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.action).toBe("notification:warning");
    expect(entry.source).toBe("sensorium");
    expect(entry.detail).toBe("Memory High: Memory usage at 92%");
    expect(entry.success).toBe(true);
  });

  test("send() maps alert level to action string", async () => {
    const audit = new AuditLogger();
    const channel = new AuditLogChannel(audit);
    await channel.send({
      level: "alert",
      title: "Container Down",
      body: "nginx is not running",
      source: "sensorium",
    });

    const entries = audit.entries({ action: "notification:alert" });
    expect(entries).toHaveLength(1);
  });
});
