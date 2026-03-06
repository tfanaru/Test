import { describe, it, expect } from "vitest";

/**
 * Unit tests for journey command internals.
 */

interface LogEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

interface OwnershipPeriod {
  author: string;
  startDate: Date;
  endDate: Date;
  commits: number;
}

function buildOwnershipTimeline(logs: LogEntry[]): OwnershipPeriod[] {
  if (logs.length === 0) return [];

  const chronological = [...logs].reverse();
  const periods: OwnershipPeriod[] = [];

  let current: OwnershipPeriod = {
    author: chronological[0].author,
    startDate: new Date(chronological[0].date),
    endDate: new Date(chronological[0].date),
    commits: 1,
  };

  for (let i = 1; i < chronological.length; i++) {
    const log = chronological[i];
    if (log.author === current.author) {
      current.endDate = new Date(log.date);
      current.commits++;
    } else {
      periods.push(current);
      current = {
        author: log.author,
        startDate: new Date(log.date),
        endDate: new Date(log.date),
        commits: 1,
      };
    }
  }
  periods.push(current);

  return periods;
}

function findMilestones(
  logs: LogEntry[],
  limit: number,
): { log: LogEntry; reason: string }[] {
  if (logs.length === 0) return [];

  const milestones: { log: LogEntry; reason: string }[] = [];
  const oldest = logs[logs.length - 1];
  milestones.push({ log: oldest, reason: "Created" });

  const milestoneKeywords = [
    { pattern: /refactor/i, label: "Refactored" },
    { pattern: /rewrite/i, label: "Rewritten" },
    { pattern: /fix|bug/i, label: "Bug fix" },
    { pattern: /feat|feature|add/i, label: "Feature added" },
    { pattern: /breaking/i, label: "Breaking change" },
    { pattern: /migrat/i, label: "Migration" },
    { pattern: /deprecat/i, label: "Deprecation" },
    { pattern: /rename/i, label: "Renamed" },
    { pattern: /move/i, label: "Moved" },
    { pattern: /test/i, label: "Tests added" },
  ];

  for (const log of logs) {
    if (log === oldest) continue;
    for (const { pattern, label } of milestoneKeywords) {
      if (pattern.test(log.subject)) {
        milestones.push({ log, reason: label });
        break;
      }
    }
  }

  if (logs.length > 1) {
    const newest = logs[0];
    const alreadyIncluded = milestones.some((m) => m.log.hash === newest.hash);
    if (!alreadyIncluded) {
      milestones.push({ log: newest, reason: "Latest change" });
    }
  }

  milestones.sort(
    (a, b) => new Date(a.log.date).getTime() - new Date(b.log.date).getTime(),
  );
  return milestones.slice(0, limit);
}

function makeLog(hash: string, subject: string, author: string, date: string): LogEntry {
  return { hash, author, email: `${author.toLowerCase()}@test.com`, date, subject };
}

describe("buildOwnershipTimeline", () => {
  it("returns empty for empty logs", () => {
    expect(buildOwnershipTimeline([])).toEqual([]);
  });

  it("creates single period for single author", () => {
    const logs = [
      makeLog("c3", "third", "Alice", "2024-03-01T10:00:00Z"),
      makeLog("c2", "second", "Alice", "2024-02-01T10:00:00Z"),
      makeLog("c1", "first", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = buildOwnershipTimeline(logs);
    expect(result).toHaveLength(1);
    expect(result[0].author).toBe("Alice");
    expect(result[0].commits).toBe(3);
  });

  it("creates multiple periods for alternating authors", () => {
    const logs = [
      makeLog("c3", "third", "Bob", "2024-03-01T10:00:00Z"),
      makeLog("c2", "second", "Alice", "2024-02-01T10:00:00Z"),
      makeLog("c1", "first", "Bob", "2024-01-01T10:00:00Z"),
    ];
    const result = buildOwnershipTimeline(logs);
    expect(result).toHaveLength(3);
    expect(result[0].author).toBe("Bob");
    expect(result[1].author).toBe("Alice");
    expect(result[2].author).toBe("Bob");
  });

  it("groups consecutive commits by same author", () => {
    const logs = [
      makeLog("c4", "fourth", "Bob", "2024-04-01T10:00:00Z"),
      makeLog("c3", "third", "Alice", "2024-03-01T10:00:00Z"),
      makeLog("c2", "second", "Alice", "2024-02-01T10:00:00Z"),
      makeLog("c1", "first", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = buildOwnershipTimeline(logs);
    expect(result).toHaveLength(2);
    expect(result[0].author).toBe("Alice");
    expect(result[0].commits).toBe(3);
    expect(result[1].author).toBe("Bob");
    expect(result[1].commits).toBe(1);
  });

  it("handles single commit", () => {
    const logs = [makeLog("c1", "init", "Alice", "2024-01-01T10:00:00Z")];
    const result = buildOwnershipTimeline(logs);
    expect(result).toHaveLength(1);
    expect(result[0].commits).toBe(1);
  });

  it("preserves date ranges", () => {
    const logs = [
      makeLog("c3", "late", "Alice", "2024-06-01T10:00:00Z"),
      makeLog("c2", "mid", "Alice", "2024-03-01T10:00:00Z"),
      makeLog("c1", "early", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = buildOwnershipTimeline(logs);
    expect(result[0].startDate).toEqual(new Date("2024-01-01T10:00:00Z"));
    expect(result[0].endDate).toEqual(new Date("2024-06-01T10:00:00Z"));
  });
});

describe("findMilestones", () => {
  it("returns empty for empty logs", () => {
    expect(findMilestones([], 10)).toEqual([]);
  });

  it("always includes creation commit", () => {
    const logs = [
      makeLog("c2", "update stuff", "Alice", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial commit", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 10);
    expect(result.some((m) => m.reason === "Created")).toBe(true);
    expect(result.find((m) => m.reason === "Created")!.log.hash).toBe("c1");
  });

  it("detects refactor milestones", () => {
    const logs = [
      makeLog("c2", "Refactor auth module", "Alice", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 10);
    expect(result.some((m) => m.reason === "Refactored")).toBe(true);
  });

  it("detects bug fix milestones", () => {
    const logs = [
      makeLog("c2", "Fix memory leak in parser", "Bob", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 10);
    expect(result.some((m) => m.reason === "Bug fix")).toBe(true);
  });

  it("detects feature additions", () => {
    const logs = [
      makeLog("c2", "Add caching support", "Alice", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 10);
    expect(result.some((m) => m.reason === "Feature added")).toBe(true);
  });

  it("adds latest change if not already a milestone", () => {
    const logs = [
      makeLog("c3", "update deps", "Alice", "2024-03-01T10:00:00Z"),
      makeLog("c2", "tweak config", "Bob", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 10);
    expect(result.some((m) => m.reason === "Latest change")).toBe(true);
  });

  it("does not duplicate latest if it's already a milestone", () => {
    const logs = [
      makeLog("c2", "Refactor everything", "Alice", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 10);
    // c2 is detected as "Refactored", should not also appear as "Latest change"
    const latestEntries = result.filter((m) => m.reason === "Latest change");
    expect(latestEntries).toHaveLength(0);
  });

  it("respects limit", () => {
    const logs = [
      makeLog("c5", "fix bug 3", "Alice", "2024-05-01T10:00:00Z"),
      makeLog("c4", "Refactor module", "Bob", "2024-04-01T10:00:00Z"),
      makeLog("c3", "fix bug 2", "Alice", "2024-03-01T10:00:00Z"),
      makeLog("c2", "Add feature X", "Bob", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("sorts milestones chronologically", () => {
    const logs = [
      makeLog("c3", "fix bug", "Alice", "2024-03-01T10:00:00Z"),
      makeLog("c2", "Refactor parser", "Bob", "2024-02-01T10:00:00Z"),
      makeLog("c1", "initial", "Alice", "2024-01-01T10:00:00Z"),
    ];
    const result = findMilestones(logs, 10);
    for (let i = 1; i < result.length; i++) {
      const prev = new Date(result[i - 1].log.date).getTime();
      const curr = new Date(result[i].log.date).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});
