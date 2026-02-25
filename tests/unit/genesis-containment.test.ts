import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
	isProtectedPath,
	setProtectedPaths,
} from "../../src/modules/filesystem/containment.ts";

const TEST_GENESIS_DIR = "/tmp/friday-test-containment-genesis";
const TEST_GENESIS_PATH = `${TEST_GENESIS_DIR}/GENESIS.md`;

describe("isProtectedPath", () => {
	beforeEach(() => {
		setProtectedPaths([TEST_GENESIS_PATH]);
	});

	afterEach(() => {
		setProtectedPaths([]);
	});

	test("rejects exact match to protected path", () => {
		expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(true);
	});

	test("allows unrelated paths", () => {
		expect(isProtectedPath("/tmp/some-other-file.txt")).toBe(false);
	});

	test("rejects path that resolves to protected path via trailing slash", () => {
		expect(isProtectedPath(`${TEST_GENESIS_PATH}/`)).toBe(false);
		expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(true);
	});

	test("returns false when no protected paths are set", () => {
		setProtectedPaths([]);
		expect(isProtectedPath(TEST_GENESIS_PATH)).toBe(false);
	});
});
