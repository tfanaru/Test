import { describe, it, expect } from "vitest";
import { bfs } from "../commands/bridge.js";

describe("bfs", () => {
  it("finds a direct connection", () => {
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set(["b.ts"])],
      ["b.ts", new Set(["c.ts"])],
      ["c.ts", new Set()],
    ]);

    const result = bfs(graph, ["a.ts"], new Set(["c.ts"]), 5);
    expect(result).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("finds the shortest path", () => {
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set(["b.ts", "d.ts"])],
      ["b.ts", new Set(["c.ts"])],
      ["c.ts", new Set(["target.ts"])],
      ["d.ts", new Set(["target.ts"])],
      ["target.ts", new Set()],
    ]);

    const result = bfs(graph, ["a.ts"], new Set(["target.ts"]), 5);
    // Should find a.ts -> d.ts -> target.ts (length 2) rather than a.ts -> b.ts -> c.ts -> target.ts (length 3)
    expect(result).toEqual(["a.ts", "d.ts", "target.ts"]);
  });

  it("returns null when no path exists within depth", () => {
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set(["b.ts"])],
      ["b.ts", new Set(["c.ts"])],
      ["c.ts", new Set(["d.ts"])],
      ["d.ts", new Set(["target.ts"])],
      ["target.ts", new Set()],
    ]);

    const result = bfs(graph, ["a.ts"], new Set(["target.ts"]), 2);
    expect(result).toBeNull();
  });

  it("returns the start file if it is also the target", () => {
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set(["b.ts"])],
    ]);

    const result = bfs(graph, ["a.ts"], new Set(["a.ts"]), 5);
    expect(result).toEqual(["a.ts"]);
  });

  it("follows reverse edges", () => {
    // a.ts imports nothing, but b.ts imports a.ts
    // We should be able to traverse from a.ts to b.ts via reverse edge
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set()],
      ["b.ts", new Set(["a.ts"])],
      ["c.ts", new Set(["b.ts"])],
    ]);

    const result = bfs(graph, ["a.ts"], new Set(["c.ts"]), 5);
    expect(result).not.toBeNull();
    expect(result![0]).toBe("a.ts");
    expect(result![result!.length - 1]).toBe("c.ts");
  });

  it("handles multiple start files", () => {
    const graph = new Map<string, Set<string>>([
      ["a1.ts", new Set()],
      ["a2.ts", new Set(["target.ts"])],
      ["target.ts", new Set()],
    ]);

    const result = bfs(graph, ["a1.ts", "a2.ts"], new Set(["target.ts"]), 5);
    expect(result).toEqual(["a2.ts", "target.ts"]);
  });

  it("handles multiple target files", () => {
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set(["b.ts"])],
      ["b.ts", new Set()],
      ["target1.ts", new Set()],
      ["target2.ts", new Set(["b.ts"])],
    ]);

    // b.ts is reachable from a.ts, and target2.ts imports b.ts (reverse edge)
    const result = bfs(
      graph,
      ["a.ts"],
      new Set(["target1.ts", "target2.ts"]),
      5,
    );
    // Should find some path to either target
    if (result) {
      const lastFile = result[result.length - 1];
      expect(["target1.ts", "target2.ts"]).toContain(lastFile);
    }
  });

  it("returns null for empty graph", () => {
    const graph = new Map<string, Set<string>>();
    const result = bfs(graph, ["a.ts"], new Set(["b.ts"]), 5);
    expect(result).toBeNull();
  });

  it("returns null when max depth is 0 and start is not target", () => {
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set(["b.ts"])],
      ["b.ts", new Set()],
    ]);

    const result = bfs(graph, ["a.ts"], new Set(["b.ts"]), 0);
    expect(result).toBeNull();
  });

  it("handles cycles without infinite loops", () => {
    const graph = new Map<string, Set<string>>([
      ["a.ts", new Set(["b.ts"])],
      ["b.ts", new Set(["c.ts"])],
      ["c.ts", new Set(["a.ts"])],
      ["target.ts", new Set()],
    ]);

    // No path to target, but should not hang
    const result = bfs(graph, ["a.ts"], new Set(["target.ts"]), 10);
    expect(result).toBeNull();
  });
});
