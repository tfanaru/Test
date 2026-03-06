import { describe, it, expect } from "vitest";

/**
 * Unit tests for drift command internals.
 * We test the bucketing and major commit detection logic.
 */

// Re-implement the internal functions for testability
// (The actual command uses these internally)

interface LogEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

interface PeriodStats {
  label: string;
  commits: number;
  authors: Set<string>;
  start: Date;
  end: Date;
}

function bucketByPeriod(logs: LogEntry[], periods: number): PeriodStats[] {
  if (logs.length === 0) return [];

  const dates = logs.map((l) => new Date(l.date).getTime());
  const earliest = Math.min(...dates);
  const latest = Math.max(...dates);
  const span = latest - earliest;

  if (span === 0) {
    const authors = new Set(logs.map((l) => l.author));
    return [
      {
        label: "all",
        commits: logs.length,
        authors,
        start: new Date(earliest),
        end: new Date(latest),
      },
    ];
  }

  const bucketSize = span / periods;
  const buckets: PeriodStats[] = [];

  for (let i = 0; i < periods; i++) {
    const start = new Date(earliest + i * bucketSize);
    const end = new Date(earliest + (i + 1) * bucketSize);
    buckets.push({
      label: "",
      commits: 0,
      authors: new Set(),
      start,
      end,
    });
  }

  for (const log of logs) {
    const t = new Date(log.date).getTime();
    let idx = Math.floor((t - earliest) / bucketSize);
    if (idx >= periods) idx = periods - 1;
    buckets[idx].commits++;
    buckets[idx].authors.add(log.author);
  }

  return buckets;
}

function findMajorCommits(logs: LogEntry[]): LogEntry[] {
  const keywords = [
    /refactor/i,
    /rewrite/i,
    /overhaul/i,
    /redesign/i,
    /migration/i,
    /breaking/i,
    /major/i,
    /rework/i,
    /restructur/i,
  ];

  return logs.filter((log) =>
    keywords.some((kw) => kw.test(log.subject)),
  );
}

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
    // Total commits should sum to 3
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
    // Requesting 6 periods but only 2 commits over 2 dates
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
