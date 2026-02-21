import { describe, test, expect, beforeEach } from "bun:test";
import { DirectiveStore } from "../../src/directives/store.ts";
import type { FridayDirective } from "../../src/directives/types.ts";

function makeDirective(
  overrides: Partial<FridayDirective> = {},
): FridayDirective {
  return {
    id: crypto.randomUUID(),
    name: "test-directive",
    description: "A test directive",
    enabled: true,
    trigger: { type: "manual" },
    action: { type: "prompt", prompt: "Do something" },
    clearance: [],
    executionCount: 0,
    ...overrides,
  };
}

describe("DirectiveStore", () => {
  let store: DirectiveStore;

  beforeEach(() => {
    store = new DirectiveStore();
  });

  test("adds and retrieves a directive", () => {
    const d = makeDirective({ id: "d1", name: "lint-before-commit" });
    store.add(d);
    expect(store.get("d1")).toEqual(d);
  });

  test("lists all directives", () => {
    store.add(makeDirective({ id: "d1" }));
    store.add(makeDirective({ id: "d2" }));
    expect(store.list()).toHaveLength(2);
  });

  test("lists only enabled directives", () => {
    store.add(makeDirective({ id: "d1", enabled: true }));
    store.add(makeDirective({ id: "d2", enabled: false }));
    expect(store.listEnabled()).toHaveLength(1);
  });

  test("removes a directive", () => {
    store.add(makeDirective({ id: "d1" }));
    store.remove("d1");
    expect(store.get("d1")).toBeUndefined();
  });

  test("updates a directive", () => {
    store.add(makeDirective({ id: "d1", name: "old" }));
    store.update("d1", { name: "new" });
    expect(store.get("d1")?.name).toBe("new");
  });

  test("update fires onChange callback", () => {
    let fired = false;
    store.onStoreChange(() => { fired = true; });
    store.add(makeDirective({ id: "d1" }));
    fired = false;
    store.update("d1", { name: "updated" });
    expect(fired).toBe(true);
  });

  test("update on nonexistent ID does not fire onChange", () => {
    let fired = false;
    store.onStoreChange(() => { fired = true; });
    store.update("nonexistent", { name: "nope" });
    expect(fired).toBe(false);
  });

  test("finds directives by signal trigger", () => {
    store.add(
      makeDirective({
        id: "d1",
        trigger: { type: "signal", signal: "file:changed" },
      }),
    );
    store.add(
      makeDirective({
        id: "d2",
        trigger: { type: "signal", signal: "test:failed" },
      }),
    );
    store.add(makeDirective({ id: "d3", trigger: { type: "manual" } }));
    const matched = store.findBySignal("file:changed");
    expect(matched).toHaveLength(1);
    expect(matched[0]!.id).toBe("d1");
  });
});
