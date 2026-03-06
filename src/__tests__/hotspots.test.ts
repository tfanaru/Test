import { describe, it, expect } from "vitest";

/**
 * Unit tests for hotspots command internals.
 */

function scoreHotspot(commits: number, authors: number): number {
  return Math.sqrt(commits * authors);
}

function riskLevel(score: number, maxScore: number): string {
  const ratio = score / maxScore;
  if (ratio > 0.7) return "high";
  if (ratio > 0.4) return "medium";
  return "low";
}

interface Hotspot {
  path: string;
  commits: number;
  authors: number;
  score: number;
}

function rankHotspots(
  files: { path: string; commits: number; authors: number }[],
): Hotspot[] {
  return files
    .map((f) => ({
      ...f,
      score: scoreHotspot(f.commits, f.authors),
    }))
    .sort((a, b) => b.score - a.score);
}

describe("scoreHotspot", () => {
  it("returns 0 when commits is 0", () => {
    expect(scoreHotspot(0, 5)).toBe(0);
  });

  it("returns 0 when authors is 0", () => {
    expect(scoreHotspot(5, 0)).toBe(0);
  });

  it("scores higher for more commits", () => {
    const low = scoreHotspot(2, 3);
    const high = scoreHotspot(20, 3);
    expect(high).toBeGreaterThan(low);
  });

  it("scores higher for more authors", () => {
    const low = scoreHotspot(10, 1);
    const high = scoreHotspot(10, 5);
    expect(high).toBeGreaterThan(low);
  });

  it("uses geometric mean", () => {
    const score = scoreHotspot(4, 9);
    expect(score).toBe(6); // sqrt(4 * 9) = 6
  });

  it("handles single commit single author", () => {
    expect(scoreHotspot(1, 1)).toBe(1);
  });
});

describe("riskLevel", () => {
  it("returns high for scores > 70% of max", () => {
    expect(riskLevel(8, 10)).toBe("high");
    expect(riskLevel(10, 10)).toBe("high");
  });

  it("returns medium for scores between 40-70% of max", () => {
    expect(riskLevel(5, 10)).toBe("medium");
    expect(riskLevel(6, 10)).toBe("medium");
  });

  it("returns low for scores <= 40% of max", () => {
    expect(riskLevel(3, 10)).toBe("low");
    expect(riskLevel(1, 10)).toBe("low");
  });

  it("handles edge cases at boundaries", () => {
    expect(riskLevel(7.1, 10)).toBe("high");
    expect(riskLevel(7, 10)).toBe("medium");
    expect(riskLevel(4, 10)).toBe("low");
  });
});

describe("rankHotspots", () => {
  it("returns empty for empty input", () => {
    expect(rankHotspots([])).toEqual([]);
  });

  it("ranks files by hotspot score descending", () => {
    const files = [
      { path: "a.ts", commits: 2, authors: 1 },
      { path: "b.ts", commits: 10, authors: 5 },
      { path: "c.ts", commits: 5, authors: 3 },
    ];
    const result = rankHotspots(files);
    expect(result[0].path).toBe("b.ts");
    expect(result[1].path).toBe("c.ts");
    expect(result[2].path).toBe("a.ts");
  });

  it("includes score in results", () => {
    const files = [{ path: "a.ts", commits: 4, authors: 9 }];
    const result = rankHotspots(files);
    expect(result[0].score).toBe(6);
  });

  it("handles single file", () => {
    const files = [{ path: "a.ts", commits: 3, authors: 2 }];
    const result = rankHotspots(files);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("a.ts");
  });

  it("handles files with equal scores", () => {
    const files = [
      { path: "a.ts", commits: 4, authors: 4 },
      { path: "b.ts", commits: 4, authors: 4 },
    ];
    const result = rankHotspots(files);
    expect(result).toHaveLength(2);
    expect(result[0].score).toBe(result[1].score);
  });
});
