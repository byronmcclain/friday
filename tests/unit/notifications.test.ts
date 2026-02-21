import { describe, test, expect } from "bun:test";
import {
  NotificationManager,
  TerminalChannel,
  LogChannel,
} from "../../src/core/notifications.ts";
import type { NotificationChannel } from "../../src/core/notifications.ts";

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

describe("LogChannel", () => {
  test("has name 'log'", () => {
    const channel = new LogChannel("/tmp/friday-test-notifications.log");
    expect(channel.name).toBe("log");
  });
});
