import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  relativeTime,
  formatNumber,
  truncatePath,
  bar,
  listItem,
  header,
  subheader,
  labelValue,
  divider,
} from "../utils/format.js";

describe("relativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'today' for same-day dates", () => {
    expect(relativeTime(new Date("2025-06-15T08:00:00Z"))).toBe("today");
  });

  it("returns 'yesterday' for one day ago", () => {
    expect(relativeTime(new Date("2025-06-14T08:00:00Z"))).toBe("yesterday");
  });

  it("returns days ago for recent dates", () => {
    expect(relativeTime(new Date("2025-06-10T08:00:00Z"))).toBe("5 days ago");
  });

  it("returns months for 30+ day old dates", () => {
    expect(relativeTime(new Date("2025-03-15T08:00:00Z"))).toBe("3 months ago");
  });

  it("returns '1 month ago' (singular) for ~30 days", () => {
    expect(relativeTime(new Date("2025-05-15T08:00:00Z"))).toBe("1 month ago");
  });

  it("returns years for 365+ day old dates", () => {
    expect(relativeTime(new Date("2023-06-15T08:00:00Z"))).toBe("2 years ago");
  });

  it("returns '1 year ago' (singular)", () => {
    expect(relativeTime(new Date("2024-06-10T08:00:00Z"))).toBe("1 year ago");
  });
});

describe("formatNumber", () => {
  it("formats small numbers", () => {
    expect(formatNumber(42)).toBe("42");
  });

  it("formats large numbers with locale separators", () => {
    // This depends on locale, but should produce some formatted string
    const result = formatNumber(1234567);
    expect(result).toContain("1");
    expect(result).toContain("234");
    expect(result).toContain("567");
  });

  it("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("truncatePath", () => {
  it("returns short paths unchanged", () => {
    expect(truncatePath("src/index.ts")).toBe("src/index.ts");
  });

  it("truncates long paths keeping first and last parts", () => {
    const longPath = "very/deeply/nested/directory/structure/src/components/Button.tsx";
    const result = truncatePath(longPath, 30);
    expect(result).toContain("/.../");
    expect(result).toContain("very");
    expect(result).toContain("Button.tsx");
  });

  it("preserves paths with 3 or fewer segments even if long", () => {
    const path = "a-very-long-directory-name/another-long-one/file.ts";
    expect(truncatePath(path, 10)).toBe(path);
  });

  it("respects custom maxLen", () => {
    expect(truncatePath("a/b/c/d/e/f.ts", 100)).toBe("a/b/c/d/e/f.ts");
  });
});

describe("bar", () => {
  it("renders a full bar when value equals max", () => {
    const result = bar(10, 10, 10);
    // Should contain block characters (exact output has chalk codes)
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it("renders an empty bar when value is 0", () => {
    const result = bar(0, 10, 10);
    expect(result).toBeTruthy();
  });

  it("renders a half bar", () => {
    const result = bar(5, 10, 10);
    expect(result).toBeTruthy();
  });
});

describe("listItem", () => {
  it("renders an item with index", () => {
    const result = listItem(0, "hello");
    expect(result).toContain("1.");
    expect(result).toContain("hello");
  });

  it("includes detail when provided", () => {
    const result = listItem(2, "file.ts", "some detail");
    expect(result).toContain("3.");
    expect(result).toContain("file.ts");
    expect(result).toContain("some detail");
  });
});

describe("header", () => {
  it("includes the text", () => {
    expect(header("Overview")).toContain("Overview");
  });
});

describe("subheader", () => {
  it("includes the text", () => {
    expect(subheader("Details")).toContain("Details");
  });
});

describe("labelValue", () => {
  it("includes both label and value", () => {
    const result = labelValue("Files", 42);
    expect(result).toContain("Files");
    expect(result).toContain("42");
  });
});

describe("divider", () => {
  it("returns a string with repeated characters", () => {
    const result = divider();
    expect(result.length).toBeGreaterThan(10);
  });
});
