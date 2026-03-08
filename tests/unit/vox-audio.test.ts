import { describe, test, expect } from "bun:test";
import { detectPlayer } from "../../src/core/voice/audio.ts";

describe("detectPlayer", () => {
	test("returns player config for current platform", () => {
		const player = detectPlayer();
		expect(player.cmd).toBeDefined();
		expect(player.cmd.length).toBeGreaterThan(0);
		expect(typeof player.volumeArgs).toBe("function");
	});

	test("darwin returns afplay with --volume flag", () => {
		const player = detectPlayer("darwin");
		expect(player.cmd).toEqual(["afplay"]);
		const args = player.volumeArgs(0.3);
		expect(args).toEqual(["--volume", "0.3"]);
	});

	test("linux returns paplay with --volume flag", () => {
		const player = detectPlayer("linux");
		expect(player.cmd).toEqual(["paplay"]);
		const args = player.volumeArgs(0.3);
		expect(args).toEqual([`--volume=${Math.round(0.3 * 65536)}`]);
	});

	test("win32 returns powershell player", () => {
		const player = detectPlayer("win32");
		expect(player.cmd[0]).toBe("powershell");
	});

	test("unsupported platform throws", () => {
		expect(() => detectPlayer("freebsd" as any)).toThrow("Unsupported platform");
	});
});
