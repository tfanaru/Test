import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  relativeTime,
  bar,
  truncatePath,
  formatNumber,
} from "../utils/format.js";
import { extractImports, resolveImport } from "../commands/trace.js";
import {
  isGitRepo,
  getLog,
  getFileChangeStats,
  getAuthorStats,
  listFiles,
  detectLanguages,
} from "../utils/git.js";

// --- format edge cases ---

describe("bar edge cases", () => {
  it("handles max=0 without NaN", () => {
    const result = bar(5, 0, 10);
    expect(result).toBeTruthy();
    expect(result).not.toContain("NaN");
  });

  it("handles negative value", () => {
    const result = bar(-5, 10, 10);
    expect(result).toBeTruthy();
  });

  it("handles value greater than max", () => {
    const result = bar(20, 10, 10);
    expect(result).toBeTruthy();
  });

  it("handles width=0", () => {
    const result = bar(5, 10, 0);
    expect(result).toBeDefined();
  });

  it("handles both value and max as 0", () => {
    const result = bar(0, 0, 10);
    expect(result).toBeTruthy();
  });
});

describe("relativeTime edge cases", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles future dates", () => {
    expect(relativeTime(new Date("2025-06-20T12:00:00Z"))).toBe("in the future");
  });

  it("handles date exactly at boundary (30 days)", () => {
    const thirtyDaysAgo = new Date("2025-05-16T12:00:00Z");
    const result = relativeTime(thirtyDaysAgo);
    expect(result).toBe("1 month ago");
  });

  it("handles date exactly at boundary (365 days)", () => {
    const oneYearAgo = new Date("2024-06-15T12:00:00Z");
    const result = relativeTime(oneYearAgo);
    expect(result).toBe("1 year ago");
  });
});

describe("truncatePath edge cases", () => {
  it("handles empty string", () => {
    expect(truncatePath("")).toBe("");
  });

  it("handles single filename with no slashes", () => {
    expect(truncatePath("file.ts")).toBe("file.ts");
  });

  it("handles path with many segments", () => {
    const result = truncatePath("a/b/c/d/e/f.ts", 10);
    expect(result).toContain("/.../");
    expect(result).toContain("a");
    expect(result).toContain("f.ts");
  });
});

describe("formatNumber edge cases", () => {
  it("handles negative numbers", () => {
    const result = formatNumber(-42);
    expect(result).toContain("42");
  });

  it("handles very large numbers", () => {
    const result = formatNumber(1000000000);
    expect(result).toBeTruthy();
  });
});

// --- extractImports edge cases ---

describe("extractImports edge cases", () => {
  it("handles file with multiple import styles mixed", () => {
    const content = `import { foo } from "./a";\nconst b = require("./b");\n`;
    const result = extractImports("index.ts", content);
    expect(result).toContain("./a");
    expect(result).toContain("./b");
  });

  it("handles very long lines", () => {
    const longModule = "a".repeat(500);
    const content = `import { x } from "./${longModule}";\n`;
    const result = extractImports("index.ts", content);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(`./${longModule}`);
  });

  it("handles binary-like content gracefully", () => {
    const content = "\x00\x01\x02\x03\x04";
    const result = extractImports("file.ts", content);
    expect(result).toEqual([]);
  });

  it("handles file with only comments", () => {
    const content = "// import { foo } from './bar';\n/* nothing */\n";
    const result = extractImports("file.ts", content);
    expect(Array.isArray(result)).toBe(true);
  });

  it("handles empty file for each language", () => {
    expect(extractImports("file.c", "")).toEqual([]);
    expect(extractImports("file.cs", "")).toEqual([]);
    expect(extractImports("file.py", "")).toEqual([]);
    expect(extractImports("file.go", "")).toEqual([]);
    expect(extractImports("file.rs", "")).toEqual([]);
  });
});

// --- resolveImport edge cases ---

describe("resolveImport edge cases", () => {
  const allFiles = new Set(["src/index.ts", "src/utils/helper.ts"]);

  it("handles empty import string", () => {
    expect(resolveImport("", "src/index.ts", allFiles)).toBeNull();
  });

  it("handles empty allFiles set", () => {
    expect(resolveImport("./utils/helper", "src/index.ts", new Set())).toBeNull();
  });

  it("handles deeply nested relative imports", () => {
    const files = new Set(["deep/nested/file.ts"]);
    expect(resolveImport("../../deep/nested/file", "src/a/b.ts", files)).toBe("deep/nested/file.ts");
  });
});

// --- git utils edge cases ---

let tmpDir: string;

function gitInTmp(...args: string[]) {
  execFileSync("git", args, { cwd: tmpDir });
}

describe("git utils with empty repo", () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathfinder-edge-"));
    gitInTmp("init");
    gitInTmp("config", "user.email", "test@test.com");
    gitInTmp("config", "user.name", "Test");
    gitInTmp("config", "commit.gpgsign", "false");

    // Create a single empty commit so we have a valid repo
    gitInTmp("commit", "--allow-empty", "-m", "empty initial commit");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("listFiles returns empty for repo with no tracked files", async () => {
    const files = await listFiles(".", { cwd: tmpDir });
    expect(files).toEqual([]);
  });

  it("getLog returns empty for path with no matching commits", async () => {
    // git log -- . on an empty commit doesn't match since no files changed
    const logs = await getLog(".", { cwd: tmpDir });
    expect(logs).toEqual([]);
  });

  it("getFileChangeStats returns empty for no file changes", async () => {
    const stats = await getFileChangeStats(".", { cwd: tmpDir });
    expect(stats.size).toBe(0);
  });

  it("getAuthorStats returns empty when no files were changed", async () => {
    // Empty commits don't touch any files under "."
    const stats = await getAuthorStats(".", { cwd: tmpDir });
    expect(stats).toEqual([]);
  });

  it("detectLanguages handles empty array", () => {
    expect(detectLanguages([]).size).toBe(0);
  });
});

// --- CLI input validation (integration) ---

describe("CLI input validation", () => {
  const originalCwd = process.cwd();
  const cliPath = path.join(originalCwd, "dist", "index.js");
  let cliTmpDir: string;

  beforeAll(() => {
    cliTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathfinder-cli-val-"));
    execFileSync("git", ["init"], { cwd: cliTmpDir });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: cliTmpDir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: cliTmpDir });
    execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: cliTmpDir });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: cliTmpDir });
  });

  afterAll(() => {
    fs.rmSync(cliTmpDir, { recursive: true, force: true });
  });

  function runCli(...args: string[]): string {
    try {
      return execFileSync("node", [cliPath, ...args], {
        cwd: cliTmpDir,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        encoding: "utf-8",
        timeout: 10000,
      });
    } catch (err: any) {
      const stdout = typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString() ?? "");
      const stderr = typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? "");
      return stdout + stderr;
    }
  }

  it("rejects non-numeric --limit", () => {
    const output = runCli("explore", ".", "--limit", "abc");
    expect(output).toContain("must be a positive integer");
  });

  it("rejects zero --limit", () => {
    const output = runCli("explore", ".", "--limit", "0");
    expect(output).toContain("must be a positive integer");
  });

  it("rejects negative --depth", () => {
    const output = runCli("bridge", "a", "b", "--depth", "-1");
    expect(output).toContain("must be a positive integer");
  });

  it("rejects non-numeric --depth", () => {
    const output = runCli("trace", "file.ts", "--depth", "foo");
    expect(output).toContain("must be a positive integer");
  });

  it("rejects invalid --direction", () => {
    const output = runCli("trace", "file.ts", "--direction", "sideways");
    expect(output).toContain('must be "up", "down", or "both"');
  });
});
