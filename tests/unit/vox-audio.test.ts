import { describe, test, expect } from "bun:test";
import { pcmToWav, detectPlayer } from "../../src/core/voice/audio.ts";

describe("pcmToWav", () => {
	test("produces valid WAV header for empty PCM", () => {
		const wav = pcmToWav(Buffer.alloc(0), 48000);
		expect(wav.length).toBe(44); // header only
		expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
		expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
		expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
		expect(wav.readUInt16LE(20)).toBe(1); // PCM format
		expect(wav.readUInt16LE(22)).toBe(1); // mono
		expect(wav.readUInt32LE(24)).toBe(48000); // sample rate
		expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
	});

	test("appends PCM data after header", () => {
		const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const wav = pcmToWav(pcm, 48000);
		expect(wav.length).toBe(48); // 44 header + 4 data
		expect(wav.readUInt32LE(40)).toBe(4); // data chunk size
		expect(wav[44]).toBe(0x01);
		expect(wav[45]).toBe(0x02);
	});

	test("ChunkSize field is correct", () => {
		const pcm = Buffer.alloc(100);
		const wav = pcmToWav(pcm, 48000);
		expect(wav.readUInt32LE(4)).toBe(36 + 100); // 36 + dataSize
	});
});

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
