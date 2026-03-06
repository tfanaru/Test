import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * Tests for --json output across all commands.
 */

let tmpDir: string;
let originalCwd: string;

function gitInTmp(...args: string[]) {
  execFileSync("git", args, { cwd: tmpDir });
}

function runPathfinder(...args: string[]): string {
  const cliPath = path.join(originalCwd, "dist", "index.js");
  try {
    return execFileSync("node", [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      timeout: 10000,
    }).toString();
  } catch (err: any) {
    return (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
  }
}

function runJson(...args: string[]): unknown {
  const output = runPathfinder(...args, "--json");
  return JSON.parse(output);
}

beforeAll(() => {
  originalCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathfinder-json-"));

  gitInTmp("init");
  gitInTmp("config", "user.email", "alice@example.com");
  gitInTmp("config", "user.name", "Alice");
  gitInTmp("config", "commit.gpgsign", "false");

  fs.mkdirSync(path.join(tmpDir, "src", "core"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "utils"), { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, "src", "core", "engine.ts"),
    'import { log } from "../utils/logger";\nexport function run() { log("running"); }\n',
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "utils", "logger.ts"),
    "export function log(msg: string) { console.log(msg); }\n",
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "index.ts"),
    'import { run } from "./core/engine";\nrun();\n',
  );

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Initial commit");

  gitInTmp("config", "user.email", "bob@example.com");
  gitInTmp("config", "user.name", "Bob");

  fs.writeFileSync(
    path.join(tmpDir, "src", "utils", "logger.ts"),
    'export function log(msg: string) { console.log(`[LOG] ${msg}`); }\n',
  );

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Improve logger");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("explore --json", () => {
  it("outputs valid JSON", () => {
    const result = runJson("explore", "src") as any;
    expect(result).toBeDefined();
    expect(result.path).toBe("src");
  });

  it("includes overview section", () => {
    const result = runJson("explore", "src") as any;
    expect(result.overview).toBeDefined();
    expect(result.overview.totalFiles).toBeGreaterThan(0);
    expect(Array.isArray(result.overview.languages)).toBe(true);
  });

  it("includes language breakdown with percentages", () => {
    const result = runJson("explore", "src") as any;
    const ts = result.overview.languages.find((l: any) => l.language === "TypeScript");
    expect(ts).toBeDefined();
    expect(ts.files).toBeGreaterThan(0);
    expect(ts.percentage).toBeGreaterThan(0);
  });

  it("includes activity data", () => {
    const result = runJson("explore", "src") as any;
    expect(result.activity).toBeDefined();
    expect(result.activity.lastCommit).toBeTruthy();
    expect(result.activity.commitsAnalyzed).toBeGreaterThan(0);
    expect(["active", "moderate", "slow", "dormant"]).toContain(result.activity.health);
  });

  it("includes most changed files", () => {
    const result = runJson("explore", "src") as any;
    expect(Array.isArray(result.mostChangedFiles)).toBe(true);
    if (result.mostChangedFiles.length > 0) {
      const file = result.mostChangedFiles[0];
      expect(file.path).toBeTruthy();
      expect(typeof file.commits).toBe("number");
      expect(typeof file.authors).toBe("number");
    }
  });

  it("includes top contributors", () => {
    const result = runJson("explore", "src") as any;
    expect(Array.isArray(result.topContributors)).toBe(true);
    expect(result.topContributors.length).toBeGreaterThan(0);
    const alice = result.topContributors.find((c: any) => c.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice.email).toBe("alice@example.com");
    expect(typeof alice.commits).toBe("number");
  });

  it("includes entry points", () => {
    const result = runJson("explore", "src") as any;
    expect(Array.isArray(result.entryPoints)).toBe(true);
  });

  it("respects --limit in JSON output", () => {
    const result = runJson("explore", "src", "--limit", "1") as any;
    expect(result.mostChangedFiles.length).toBeLessThanOrEqual(1);
    expect(result.topContributors.length).toBeLessThanOrEqual(1);
  });
});

describe("who --json", () => {
  it("outputs valid JSON with experts", () => {
    const result = runJson("who", "src") as any;
    expect(result.path).toBe("src");
    expect(Array.isArray(result.experts)).toBe(true);
    expect(result.experts.length).toBeGreaterThan(0);
  });

  it("includes score breakdown", () => {
    const result = runJson("who", "src") as any;
    const expert = result.experts[0];
    expect(expert.name).toBeTruthy();
    expect(expert.email).toBeTruthy();
    expect(typeof expert.score).toBe("number");
    expect(expert.breakdown).toBeDefined();
    expect(typeof expert.breakdown.recency).toBe("number");
    expect(typeof expert.breakdown.volume).toBe("number");
    expect(typeof expert.breakdown.breadth).toBe("number");
  });

  it("includes summary stats", () => {
    const result = runJson("who", "src") as any;
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.totalContributors).toBe("number");
    expect(typeof result.summary.activeInLast90Days).toBe("number");
  });

  it("returns empty experts for nonexistent path", () => {
    const result = runJson("who", "nonexistent-dir") as any;
    expect(result.experts).toEqual([]);
    expect(result.summary.totalContributors).toBe(0);
  });
});

describe("trace --json", () => {
  it("outputs valid JSON for downstream dependencies", () => {
    const result = runJson("trace", "src/core/engine.ts", "--direction", "down") as any;
    expect(result.file).toBe("src/core/engine.ts");
    expect(result.direction).toBe("down");
    expect(Array.isArray(result.dependencies)).toBe(true);
  });

  it("includes dependency paths", () => {
    const result = runJson("trace", "src/core/engine.ts", "--direction", "down") as any;
    const deps = result.dependencies.map((d: any) => d.path);
    expect(deps).toContain("src/utils/logger.ts");
  });

  it("outputs valid JSON for upstream dependents", () => {
    const result = runJson("trace", "src/utils/logger.ts", "--direction", "up") as any;
    expect(result.file).toBe("src/utils/logger.ts");
    expect(Array.isArray(result.dependents)).toBe(true);
  });

  it("outputs both directions when direction=both", () => {
    const result = runJson("trace", "src/core/engine.ts") as any;
    expect(result.direction).toBe("both");
    expect(Array.isArray(result.dependencies)).toBe(true);
    expect(Array.isArray(result.dependents)).toBe(true);
  });

  it("returns error JSON for nonexistent file", () => {
    const result = runJson("trace", "nonexistent.ts") as any;
    expect(result.error).toBeDefined();
    expect(result.error).toContain("not found");
  });

  it("includes depth and filter in output", () => {
    const result = runJson("trace", "src/core/engine.ts", "--depth", "1") as any;
    expect(result.depth).toBe(1);
  });
});

describe("bridge --json", () => {
  it("outputs valid JSON", () => {
    const result = runJson("bridge", "src/core", "src/utils") as any;
    expect(result.from).toBe("src/core");
    expect(result.to).toBe("src/utils");
    expect(typeof result.depth).toBe("number");
  });

  it("includes files scanned counts", () => {
    const result = runJson("bridge", "src/core", "src/utils") as any;
    expect(result.filesScanned).toBeDefined();
    expect(typeof result.filesScanned.from).toBe("number");
    expect(typeof result.filesScanned.to).toBe("number");
  });

  it("includes connection path when found", () => {
    const result = runJson("bridge", "src/core", "src/utils") as any;
    if (result.connection) {
      expect(Array.isArray(result.connection.path)).toBe(true);
      expect(typeof result.connection.hops).toBe("number");
      expect(result.connection.path.length).toBe(result.connection.hops + 1);
    }
  });

  it("returns error JSON for nonexistent path", () => {
    const result = runJson("bridge", "nope", "src/utils") as any;
    expect(result.error).toBeDefined();
    expect(result.error).toContain("No files found");
  });

  it("returns null connection when no path exists", () => {
    // Create isolated directories with no imports between them
    const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathfinder-iso-"));
    try {
      execFileSync("git", ["init"], { cwd: isolatedDir });
      execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: isolatedDir });
      execFileSync("git", ["config", "user.name", "T"], { cwd: isolatedDir });
      execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: isolatedDir });

      fs.mkdirSync(path.join(isolatedDir, "a"), { recursive: true });
      fs.mkdirSync(path.join(isolatedDir, "b"), { recursive: true });
      fs.writeFileSync(path.join(isolatedDir, "a", "x.ts"), "export const x = 1;\n");
      fs.writeFileSync(path.join(isolatedDir, "b", "y.ts"), "export const y = 2;\n");
      execFileSync("git", ["add", "-A"], { cwd: isolatedDir });
      execFileSync("git", ["commit", "-m", "init"], { cwd: isolatedDir });

      const cliPath = path.join(originalCwd, "dist", "index.js");
      const output = execFileSync("node", [cliPath, "bridge", "a", "b", "--json"], {
        cwd: isolatedDir,
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
        timeout: 10000,
      }).toString();
      const result = JSON.parse(output);
      expect(result.connection).toBeNull();
    } finally {
      fs.rmSync(isolatedDir, { recursive: true, force: true });
    }
  });
});
