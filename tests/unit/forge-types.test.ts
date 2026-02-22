import { describe, test, expect } from "bun:test";
import type {
  ForgeProposal,
  ForgeManifest,
  ForgeModuleEntry,
  ForgeHealthReport,
  ForgeValidationResult,
  ForgeHistoryEntry,
} from "../../src/modules/forge/types.ts";

describe("Forge Types", () => {
  test("ForgeProposal satisfies shape", () => {
    const proposal: ForgeProposal = {
      id: "abc-123",
      action: "create",
      moduleName: "weather",
      description: "Weather module",
      files: [{ path: "index.ts", content: "export default {}" }],
      createdAt: new Date().toISOString(),
    };
    expect(proposal.id).toBe("abc-123");
    expect(proposal.action).toBe("create");
    expect(proposal.files).toHaveLength(1);
  });

  test("ForgeManifest satisfies shape", () => {
    const manifest: ForgeManifest = {
      version: 1,
      modules: {},
    };
    expect(manifest.version).toBe(1);
  });

  test("ForgeModuleEntry tracks history", () => {
    const entry: ForgeModuleEntry = {
      description: "A module",
      version: "1.0.0",
      created: "2026-02-22T00:00:00Z",
      lastModified: "2026-02-22T00:00:00Z",
      status: "loaded",
      protected: false,
      history: [
        {
          version: "1.0.0",
          date: "2026-02-22T00:00:00Z",
          action: "created",
          reason: "Initial creation",
        },
      ],
    };
    expect(entry.history).toHaveLength(1);
    expect(entry.protected).toBe(false);
  });

  test("ForgeHealthReport captures load results", () => {
    const report: ForgeHealthReport = {
      loaded: ["weather"],
      failed: [{ name: "broken", error: "SyntaxError", lastWorkingVersion: "1.0.0" }],
      pending: [],
    };
    expect(report.loaded).toContain("weather");
    expect(report.failed[0]!.name).toBe("broken");
  });

  test("ForgeValidationResult captures step results", () => {
    const result: ForgeValidationResult = {
      moduleName: "weather",
      passed: true,
      steps: [
        { name: "import", passed: true },
        { name: "manifest", passed: true },
        { name: "typecheck", passed: true },
        { name: "lint", passed: true },
      ],
    };
    expect(result.passed).toBe(true);
    expect(result.steps).toHaveLength(4);
  });
});
