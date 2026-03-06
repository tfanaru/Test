import { describe, it, expect } from "vitest";
import { scoreHotspot, riskLabel } from "../commands/hotspots.js";
import chalk from "chalk";

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

describe("riskLabel", () => {
  it("returns High for scores > 70% of max", () => {
    expect(riskLabel(8, 10)).toContain("High");
    expect(riskLabel(10, 10)).toContain("High");
  });

  it("returns Medium for scores between 40-70% of max", () => {
    expect(riskLabel(5, 10)).toContain("Medium");
    expect(riskLabel(6, 10)).toContain("Medium");
  });

  it("returns Low for scores <= 40% of max", () => {
    expect(riskLabel(3, 10)).toContain("Low");
    expect(riskLabel(1, 10)).toContain("Low");
  });

  it("handles edge cases at boundaries", () => {
    expect(riskLabel(7.1, 10)).toContain("High");
    expect(riskLabel(7, 10)).toContain("Medium");
    expect(riskLabel(4, 10)).toContain("Low");
  });

  it("returns a string with chalk formatting", () => {
    const result = riskLabel(10, 10);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
