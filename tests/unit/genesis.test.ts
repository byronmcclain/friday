import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, chmod, stat } from "node:fs/promises";
import {
	GENESIS_DEFAULT_DIR,
	resolveGenesisPath,
	loadGenesis,
	seedGenesis,
	checkGenesis,
} from "../../src/core/genesis.ts";
import { GENESIS_TEMPLATE } from "../../src/core/prompts.ts";

const TEST_GENESIS_DIR = "/tmp/friday-test-genesis";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("genesis", () => {
	beforeEach(async () => {
		await mkdir(TEST_GENESIS_DIR, { recursive: true });
	});

	afterEach(async () => {
		await rm(TEST_GENESIS_DIR, { recursive: true, force: true });
	});

	test("GENESIS_DEFAULT_DIR points to ~/.friday", () => {
		const home =
			process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
		expect(GENESIS_DEFAULT_DIR).toBe(`${home}/.friday`);
	});

	test("resolveGenesisPath uses env var when set", () => {
		const original = process.env.FRIDAY_GENESIS_PATH;
		try {
			process.env.FRIDAY_GENESIS_PATH = "/custom/path/GENESIS.md";
			expect(resolveGenesisPath()).toBe("/custom/path/GENESIS.md");
		} finally {
			if (original === undefined) delete process.env.FRIDAY_GENESIS_PATH;
			else process.env.FRIDAY_GENESIS_PATH = original;
		}
	});

	test("resolveGenesisPath falls back to default", () => {
		const original = process.env.FRIDAY_GENESIS_PATH;
		try {
			delete process.env.FRIDAY_GENESIS_PATH;
			expect(resolveGenesisPath()).toBe(
				`${GENESIS_DEFAULT_DIR}/GENESIS.md`,
			);
		} finally {
			if (original !== undefined)
				process.env.FRIDAY_GENESIS_PATH = original;
		}
	});

	test("loadGenesis reads file content", async () => {
		await Bun.write(TEST_GENESIS_PATH, "Test identity prompt");
		const content = await loadGenesis(TEST_GENESIS_PATH);
		expect(content).toBe("Test identity prompt");
	});

	test("loadGenesis throws on missing file", async () => {
		await expect(
			loadGenesis(`${TEST_GENESIS_DIR}/nonexistent.md`),
		).rejects.toThrow("GENESIS.md not found");
	});

	test("loadGenesis throws on empty file", async () => {
		await Bun.write(TEST_GENESIS_PATH, "");
		await expect(loadGenesis(TEST_GENESIS_PATH)).rejects.toThrow(
			"GENESIS.md is empty",
		);
	});

	test("seedGenesis creates file with template content", async () => {
		await seedGenesis(TEST_GENESIS_PATH);
		const content = await Bun.file(TEST_GENESIS_PATH).text();
		expect(content).toBe(GENESIS_TEMPLATE);
	});

	test("seedGenesis creates parent directory", async () => {
		const nested = `${TEST_GENESIS_DIR}/sub/GENESIS.md`;
		await seedGenesis(nested);
		const content = await Bun.file(nested).text();
		expect(content).toBe(GENESIS_TEMPLATE);
	});

	test("seedGenesis does not overwrite existing file", async () => {
		await Bun.write(TEST_GENESIS_PATH, "Custom prompt");
		await seedGenesis(TEST_GENESIS_PATH);
		const content = await Bun.file(TEST_GENESIS_PATH).text();
		expect(content).toBe("Custom prompt");
	});

	test("seedGenesis sets file permissions to 600", async () => {
		await seedGenesis(TEST_GENESIS_PATH);
		const info = await stat(TEST_GENESIS_PATH);
		expect(info.mode & 0o777).toBe(0o600);
	});

	test("checkGenesis returns ok for valid file", async () => {
		await Bun.write(TEST_GENESIS_PATH, "Valid prompt");
		await chmod(TEST_GENESIS_PATH, 0o600);
		const result = await checkGenesis(TEST_GENESIS_PATH);
		expect(result.ok).toBe(true);
	});

	test("checkGenesis reports missing file", async () => {
		const result = await checkGenesis(
			`${TEST_GENESIS_DIR}/nope.md`,
		);
		expect(result.ok).toBe(false);
		expect(result.issues).toContain("File not found");
	});

	test("checkGenesis reports empty file", async () => {
		await Bun.write(TEST_GENESIS_PATH, "");
		const result = await checkGenesis(TEST_GENESIS_PATH);
		expect(result.ok).toBe(false);
		expect(result.issues![0]).toContain("empty");
	});
});
