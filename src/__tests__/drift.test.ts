import { describe, it, expect } from "vitest";
import { bucketByPeriod, findMajorCommits } from "../commands/drift.js";
import type { LogEntry } from "../utils/git.js";

function makeLog(subject: string, author: string, date: string): LogEntry {
  return {
    hash: "abc123",
    author,
    email: `${author.toLowerCase()}@test.com`,
    date,
    subject,
  };
}

describe("bucketByPeriod", () => {
  it("returns empty array for empty logs", () => {
    expect(bucketByPeriod([], 6)).toEqual([]);
  });

  it("handles single commit", () => {
    const logs = [makeLog("init", "Alice", "2024-01-15T10:00:00Z")];
    const result = bucketByPeriod(logs, 6);
    expect(result).toHaveLength(1);
    expect(result[0].commits).toBe(1);
    expect(result[0].authors.has("Alice")).toBe(true);
  });

  it("distributes commits across periods", () => {
    const logs = [
      makeLog("late change", "Bob", "2024-06-15T10:00:00Z"),
      makeLog("mid change", "Alice", "2024-04-15T10:00:00Z"),
      makeLog("early change", "Alice", "2024-01-15T10:00:00Z"),
    ];
    const result = bucketByPeriod(logs, 3);
    expect(result).toHaveLength(3);
    const totalCommits = result.reduce((s, p) => s + p.commits, 0);
    expect(totalCommits).toBe(3);
  });

  it("tracks authors per period", () => {
    const logs = [
      makeLog("change 1", "Alice", "2024-01-15T10:00:00Z"),
      makeLog("change 2", "Bob", "2024-01-16T10:00:00Z"),
      makeLog("change 3", "Alice", "2024-06-15T10:00:00Z"),
    ];
    const result = bucketByPeriod(logs, 2);
    expect(result).toHaveLength(2);
  });

  it("handles all commits on same date", () => {
    const logs = [
      makeLog("change 1", "Alice", "2024-01-15T10:00:00Z"),
      makeLog("change 2", "Bob", "2024-01-15T10:00:00Z"),
    ];
    const result = bucketByPeriod(logs, 6);
    expect(result).toHaveLength(1);
    expect(result[0].commits).toBe(2);
    expect(result[0].authors.size).toBe(2);
  });

  it("clamps period count to log count", () => {
    const logs = [
      makeLog("change 1", "Alice", "2024-01-15T10:00:00Z"),
      makeLog("change 2", "Bob", "2024-06-15T10:00:00Z"),
    ];
    const result = bucketByPeriod(logs, 6);
    expect(result).toHaveLength(6);
    const totalCommits = result.reduce((s, p) => s + p.commits, 0);
    expect(totalCommits).toBe(2);
  });
});

describe("findMajorCommits", () => {
  it("returns empty for no matching commits", () => {
    const logs = [
      makeLog("fix typo", "Alice", "2024-01-15T10:00:00Z"),
      makeLog("update readme", "Bob", "2024-01-16T10:00:00Z"),
    ];
    expect(findMajorCommits(logs)).toEqual([]);
  });

  it("detects refactor commits", () => {
    const logs = [
      makeLog("Refactor auth module", "Alice", "2024-01-15T10:00:00Z"),
      makeLog("fix typo", "Bob", "2024-01-16T10:00:00Z"),
    ];
    const result = findMajorCommits(logs);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("Refactor auth module");
  });

  it("detects rewrite commits", () => {
    const logs = [
      makeLog("Rewrite parser from scratch", "Alice", "2024-01-15T10:00:00Z"),
    ];
    expect(findMajorCommits(logs)).toHaveLength(1);
  });

  it("detects breaking changes", () => {
    const logs = [
      makeLog("Breaking: remove deprecated API", "Alice", "2024-01-15T10:00:00Z"),
    ];
    expect(findMajorCommits(logs)).toHaveLength(1);
  });

  it("detects migration commits", () => {
    const logs = [
      makeLog("migration to new schema", "Alice", "2024-01-15T10:00:00Z"),
    ];
    expect(findMajorCommits(logs)).toHaveLength(1);
  });

  it("detects multiple major commits", () => {
    const logs = [
      makeLog("Refactor auth", "Alice", "2024-01-15T10:00:00Z"),
      makeLog("fix tests", "Bob", "2024-01-16T10:00:00Z"),
      makeLog("Major overhaul of the build system", "Charlie", "2024-02-01T10:00:00Z"),
      makeLog("Restructure project layout", "Alice", "2024-03-01T10:00:00Z"),
    ];
    expect(findMajorCommits(logs)).toHaveLength(3);
  });

  it("is case insensitive", () => {
    const logs = [
      makeLog("REFACTOR everything", "Alice", "2024-01-15T10:00:00Z"),
      makeLog("rework the pipeline", "Bob", "2024-01-16T10:00:00Z"),
    ];
    expect(findMajorCommits(logs)).toHaveLength(2);
  });
});
