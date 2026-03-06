import { describe, it, expect } from "vitest";
import path from "node:path";

/**
 * Unit tests for review command internals.
 */

interface ReviewFileStats {
  path: string;
  additions: number;
  deletions: number;
}

function parseNumstat(output: string): ReviewFileStats[] {
  const stats: ReviewFileStats[] = [];
  for (const line of output.trim().split("\n")) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (match) {
      stats.push({
        path: match[3],
        additions: match[1] === "-" ? 0 : parseInt(match[1], 10),
        deletions: match[2] === "-" ? 0 : parseInt(match[2], 10),
      });
    }
  }
  return stats;
}

function groupByDirectory(
  files: ReviewFileStats[],
): Map<string, { files: number; additions: number; deletions: number }> {
  const dirMap = new Map<string, { files: number; additions: number; deletions: number }>();
  for (const f of files) {
    const dir = path.dirname(f.path) || ".";
    const topDir = dir.split("/").slice(0, 2).join("/");
    const existing = dirMap.get(topDir);
    if (existing) {
      existing.files++;
      existing.additions += f.additions;
      existing.deletions += f.deletions;
    } else {
      dirMap.set(topDir, {
        files: 1,
        additions: f.additions,
        deletions: f.deletions,
      });
    }
  }
  return dirMap;
}

function assessBlastRadius(fileStats: ReviewFileStats[]): string {
  const uniqueDirs = new Set(fileStats.map((f) => path.dirname(f.path)));
  if (uniqueDirs.size > 10 || fileStats.length > 50) return "high";
  if (uniqueDirs.size > 3 || fileStats.length > 15) return "medium";
  return "low";
}

describe("parseNumstat", () => {
  it("parses standard numstat output", () => {
    const output = "10\t5\tsrc/index.ts\n3\t1\tsrc/utils.ts\n";
    const result = parseNumstat(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "src/index.ts", additions: 10, deletions: 5 });
    expect(result[1]).toEqual({ path: "src/utils.ts", additions: 3, deletions: 1 });
  });

  it("handles binary files (dash notation)", () => {
    const output = "-\t-\timage.png\n5\t2\treadme.md\n";
    const result = parseNumstat(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "image.png", additions: 0, deletions: 0 });
  });

  it("returns empty for empty input", () => {
    expect(parseNumstat("")).toEqual([]);
    expect(parseNumstat("  ")).toEqual([]);
  });

  it("skips non-numstat lines", () => {
    const output = "some random text\n10\t5\tsrc/index.ts\nanother line\n";
    const result = parseNumstat(output);
    expect(result).toHaveLength(1);
  });

  it("handles paths with spaces", () => {
    const output = "3\t1\tsrc/my file.ts\n";
    const result = parseNumstat(output);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("src/my file.ts");
  });
});

describe("groupByDirectory", () => {
  it("groups files by top-level directory", () => {
    const files: ReviewFileStats[] = [
      { path: "src/core/engine.ts", additions: 10, deletions: 5 },
      { path: "src/core/parser.ts", additions: 3, deletions: 1 },
      { path: "src/utils/helper.ts", additions: 7, deletions: 2 },
      { path: "tests/engine.test.ts", additions: 20, deletions: 0 },
    ];
    const result = groupByDirectory(files);
    expect(result.get("src/core")!.files).toBe(2);
    expect(result.get("src/core")!.additions).toBe(13);
    expect(result.get("src/utils")!.files).toBe(1);
    expect(result.get("tests")!.files).toBe(1);
  });

  it("handles root-level files", () => {
    const files: ReviewFileStats[] = [
      { path: "package.json", additions: 1, deletions: 1 },
    ];
    const result = groupByDirectory(files);
    expect(result.has(".")).toBe(true);
  });

  it("returns empty map for empty input", () => {
    expect(groupByDirectory([]).size).toBe(0);
  });

  it("aggregates additions and deletions", () => {
    const files: ReviewFileStats[] = [
      { path: "src/a.ts", additions: 10, deletions: 5 },
      { path: "src/b.ts", additions: 20, deletions: 3 },
    ];
    const result = groupByDirectory(files);
    expect(result.get("src")!.additions).toBe(30);
    expect(result.get("src")!.deletions).toBe(8);
  });
});

describe("assessBlastRadius", () => {
  it("returns low for small changes", () => {
    const files: ReviewFileStats[] = [
      { path: "src/index.ts", additions: 5, deletions: 2 },
      { path: "src/utils.ts", additions: 3, deletions: 1 },
    ];
    expect(assessBlastRadius(files)).toBe("low");
  });

  it("returns medium for moderate changes", () => {
    const files: ReviewFileStats[] = [];
    for (let i = 0; i < 16; i++) {
      files.push({ path: `src/file${i}.ts`, additions: 1, deletions: 0 });
    }
    expect(assessBlastRadius(files)).toBe("medium");
  });

  it("returns high for many directories", () => {
    const files: ReviewFileStats[] = [];
    for (let i = 0; i < 12; i++) {
      files.push({ path: `dir${i}/file.ts`, additions: 1, deletions: 0 });
    }
    expect(assessBlastRadius(files)).toBe("high");
  });

  it("returns high for many files", () => {
    const files: ReviewFileStats[] = [];
    for (let i = 0; i < 51; i++) {
      files.push({ path: `src/file${i}.ts`, additions: 1, deletions: 0 });
    }
    expect(assessBlastRadius(files)).toBe("high");
  });

  it("returns low for empty input", () => {
    expect(assessBlastRadius([])).toBe("low");
  });
});
