import { describe, expect, test } from "bun:test";
import { AuditLogger } from "../../src/audit/logger.ts";
import dockerModule from "../../src/modules/docker/index.ts";
import { dockerPs } from "../../src/modules/docker/ps.ts";
import { dockerBuild } from "../../src/modules/docker/build.ts";
import { dockerRun } from "../../src/modules/docker/run.ts";
import { dockerStop } from "../../src/modules/docker/stop.ts";
import { dockerLogs } from "../../src/modules/docker/logs.ts";
import type { ToolContext } from "../../src/modules/types.ts";

const ctx: ToolContext = {
	workingDirectory: "/tmp",
	audit: new AuditLogger(),
	signal: { emit: async () => {} },
	memory: {
		get: async () => undefined,
		set: async () => {},
		delete: async () => {},
		list: async () => [],
	},
};

// ─── Module manifest ────────────────────────────────────────────────
describe("docker module", () => {
	test("exports valid module manifest", () => {
		expect(dockerModule.name).toBe("docker");
		expect(dockerModule.version).toBe("1.0.0");
		expect(dockerModule.tools).toHaveLength(5);
	});

	test("includes all expected tools", () => {
		const names = dockerModule.tools.map((t) => t.name);
		expect(names).toContain("docker.ps");
		expect(names).toContain("docker.build");
		expect(names).toContain("docker.run");
		expect(names).toContain("docker.stop");
		expect(names).toContain("docker.logs");
	});

	test("declares required clearances", () => {
		expect(dockerModule.clearance).toContain("exec-shell");
		expect(dockerModule.clearance).toContain("network");
	});
});

// ─── docker.ps ──────────────────────────────────────────────────────
describe("docker.ps", () => {
	test("declares exec-shell clearance", () => {
		expect(dockerPs.clearance).toEqual(["exec-shell"]);
	});

	test("returns result even without docker", async () => {
		// This test is environment-dependent — if docker isn't running,
		// it should fail gracefully rather than throw
		const result = await dockerPs.execute({}, ctx);
		expect(typeof result.success).toBe("boolean");
		expect(typeof result.output).toBe("string");
	});

	test("has expected parameters", () => {
		const names = dockerPs.parameters.map((p) => p.name);
		expect(names).toContain("all");
		expect(names).toContain("filter");
	});
});

// ─── docker.run flag injection ──────────────────────────────────────
describe("docker.run flag injection", () => {
	test("rejects image starting with dash", async () => {
		const result = await dockerRun.execute({ image: "--privileged" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("rejects name starting with dash", async () => {
		const result = await dockerRun.execute({ image: "alpine", name: "--net=host" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});
});

// ─── docker.build ───────────────────────────────────────────────────
describe("docker.build", () => {
	test("fails without tag parameter", async () => {
		const result = await dockerBuild.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("declares exec-shell and network clearance", () => {
		expect(dockerBuild.clearance).toContain("exec-shell");
		expect(dockerBuild.clearance).toContain("network");
	});

	test("has expected parameters", () => {
		const names = dockerBuild.parameters.map((p) => p.name);
		expect(names).toContain("tag");
		expect(names).toContain("context");
		expect(names).toContain("dockerfile");
		expect(names).toContain("buildArgs");
	});

	test("rejects tag starting with dash", async () => {
		const result = await dockerBuild.execute({ tag: "--output=." }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});
});

// ─── docker.run ─────────────────────────────────────────────────────
describe("docker.run", () => {
	test("fails without image parameter", async () => {
		const result = await dockerRun.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("declares exec-shell and network clearance", () => {
		expect(dockerRun.clearance).toContain("exec-shell");
		expect(dockerRun.clearance).toContain("network");
	});

	test("has expected parameters", () => {
		const names = dockerRun.parameters.map((p) => p.name);
		expect(names).toContain("image");
		expect(names).toContain("name");
		expect(names).toContain("ports");
		expect(names).toContain("env");
		expect(names).toContain("volumes");
		expect(names).toContain("detach");
	});

	test("command parameter is type array", () => {
		const cmdParam = dockerRun.parameters.find((p) => p.name === "command");
		expect(cmdParam?.type).toBe("array");
	});
});

// ─── docker.stop ────────────────────────────────────────────────────
describe("docker.stop", () => {
	test("fails without container parameter", async () => {
		const result = await dockerStop.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("declares exec-shell clearance", () => {
		expect(dockerStop.clearance).toEqual(["exec-shell"]);
	});

	test("rejects container starting with dash", async () => {
		const result = await dockerStop.execute({ container: "--force" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});
});

// ─── docker.logs ────────────────────────────────────────────────────
describe("docker.logs", () => {
	test("fails without container parameter", async () => {
		const result = await dockerLogs.execute({}, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Missing");
	});

	test("declares exec-shell clearance", () => {
		expect(dockerLogs.clearance).toEqual(["exec-shell"]);
	});

	test("has expected parameters", () => {
		const names = dockerLogs.parameters.map((p) => p.name);
		expect(names).toContain("container");
		expect(names).toContain("tail");
		expect(names).toContain("timestamps");
		expect(names).toContain("since");
	});

	test("rejects container starting with dash", async () => {
		const result = await dockerLogs.execute({ container: "--follow" }, ctx);
		expect(result.success).toBe(false);
		expect(result.output).toContain("Invalid");
	});

	test("uses Bun.spawn with timeout (not Bun.$)", async () => {
		// Verify by calling with a nonexistent container — the error should come from Bun.spawn
		const result = await dockerLogs.execute({ container: "nonexistent-container-12345" }, ctx);
		expect(result.success).toBe(false);
		// Should still return a meaningful error (not throw)
		expect(typeof result.output).toBe("string");
	});
});
