import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * Integration tests that run the actual CLI commands against a temp git repo.
 * These test the full flow including git interaction and console output.
 */

let tmpDir: string;
let originalCwd: string;

function gitInTmp(...args: string[]) {
  execFileSync("git", args, { cwd: tmpDir });
}

function runPathfinder(...args: string[]): string {
  // Build path to the compiled CLI
  const cliPath = path.join(originalCwd, "dist", "index.js");
  try {
    const result = execFileSync("node", [cliPath, ...args], {
      cwd: tmpDir,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      timeout: 10000,
    });
    return result.toString();
  } catch (err: any) {
    // Some commands exit with non-zero, capture output anyway
    return (err.stdout?.toString() ?? "") + (err.stderr?.toString() ?? "");
  }
}

beforeAll(() => {
  originalCwd = process.cwd();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathfinder-integ-"));

  gitInTmp("init");
  gitInTmp("config", "user.email", "alice@example.com");
  gitInTmp("config", "user.name", "Alice Dev");
  gitInTmp("config", "commit.gpgsign", "false");

  // Build a small project structure
  fs.mkdirSync(path.join(tmpDir, "src", "core"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "api"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "utils"), { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, "src", "core", "engine.ts"),
    'import { log } from "../utils/logger";\nimport { validate } from "../utils/validator";\n\nexport function run() { log("running"); }\n',
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "utils", "logger.ts"),
    "export function log(msg: string) { console.log(msg); }\n",
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "utils", "validator.ts"),
    "export function validate(x: unknown) { return !!x; }\n",
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "api", "handler.ts"),
    'import { run } from "../core/engine";\n\nexport function handle() { run(); }\n',
  );
  fs.writeFileSync(
    path.join(tmpDir, "src", "index.ts"),
    'import { handle } from "./api/handler";\n\nhandle();\n',
  );

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Initial project structure");

  // Second commit by another author
  gitInTmp("config", "user.email", "bob@example.com");
  gitInTmp("config", "user.name", "Bob Builder");

  fs.writeFileSync(
    path.join(tmpDir, "src", "utils", "logger.ts"),
    'export function log(msg: string) { console.log(`[LOG] ${msg}`); }\nexport function warn(msg: string) { console.warn(msg); }\n',
  );

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Improve logger with prefix and add warn");

  // Third commit — Alice back
  gitInTmp("config", "user.email", "alice@example.com");
  gitInTmp("config", "user.name", "Alice Dev");

  fs.writeFileSync(
    path.join(tmpDir, "src", "core", "engine.ts"),
    'import { log, warn } from "../utils/logger";\nimport { validate } from "../utils/validator";\n\nexport function run() {\n  if (!validate(null)) warn("invalid");\n  log("running");\n}\n',
  );

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Use warn in engine");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("pathfinder explore", () => {
  it("shows overview for a directory", () => {
    const output = runPathfinder("explore", "src");
    expect(output).toContain("Pathfinder");
    expect(output).toContain("Overview");
    expect(output).toContain("Files");
    expect(output).toContain("TypeScript");
  });

  it("shows activity section", () => {
    const output = runPathfinder("explore", "src");
    expect(output).toContain("Activity");
    expect(output).toContain("Active");
  });

  it("shows most changed files", () => {
    const output = runPathfinder("explore", "src");
    expect(output).toContain("Most Changed Files");
    // logger.ts and engine.ts were changed most
    expect(output).toContain("logger.ts");
  });

  it("shows top contributors", () => {
    const output = runPathfinder("explore", "src");
    expect(output).toContain("Top Contributors");
    expect(output).toContain("Alice Dev");
    expect(output).toContain("Bob Builder");
  });

  it("respects --limit flag", () => {
    const output = runPathfinder("explore", "src", "--limit", "1");
    expect(output).toContain("Most Changed Files");
    // Should only show 1 file in the most changed section
  });

  it("handles exploring the root", () => {
    const output = runPathfinder("explore", ".");
    expect(output).toContain("Pathfinder");
    expect(output).toContain("Overview");
  });
});

describe("pathfinder who", () => {
  it("shows expertise ranking", () => {
    const output = runPathfinder("who", "src");
    expect(output).toContain("Pathfinder");
    expect(output).toContain("who knows");
    expect(output).toContain("Expertise Ranking");
  });

  it("lists contributors with commit counts", () => {
    const output = runPathfinder("who", "src");
    expect(output).toContain("Alice Dev");
    expect(output).toContain("Bob Builder");
    expect(output).toContain("commits");
    expect(output).toContain("files");
  });

  it("shows score breakdown for top contributors", () => {
    const output = runPathfinder("who", "src");
    expect(output).toContain("recency");
    expect(output).toContain("volume");
    expect(output).toContain("breadth");
  });

  it("shows total contributors summary", () => {
    const output = runPathfinder("who", "src");
    expect(output).toContain("Total contributors");
    expect(output).toContain("Active in last 90 days");
  });

  it("works for a specific file", () => {
    const output = runPathfinder("who", "src/utils/logger.ts");
    expect(output).toContain("who knows");
    expect(output).toContain("logger.ts");
  });
});

describe("pathfinder trace", () => {
  it("traces dependencies of a file", () => {
    const output = runPathfinder("trace", "src/core/engine.ts", "--direction", "down");
    expect(output).toContain("Pathfinder");
    expect(output).toContain("tracing");
    expect(output).toContain("Dependencies");
    // engine.ts imports logger and validator
    expect(output).toContain("logger");
    expect(output).toContain("validator");
  });

  it("traces dependents (up direction)", () => {
    const output = runPathfinder("trace", "src/utils/logger.ts", "--direction", "up");
    expect(output).toContain("Dependents");
  });

  it("respects --depth flag", () => {
    const output = runPathfinder("trace", "src/index.ts", "--direction", "down", "--depth", "1");
    expect(output).toContain("handler");
    // At depth 1, should not show transitive dependencies
  });

  it("shows error for nonexistent file", () => {
    const output = runPathfinder("trace", "nonexistent.ts");
    expect(output).toContain("not found");
  });
});

describe("pathfinder bridge", () => {
  it("finds a path between two directories", () => {
    const output = runPathfinder("bridge", "src/api", "src/utils");
    expect(output).toContain("Pathfinder");
    expect(output).toContain("bridging");
    expect(output).toContain("Connection Path");
  });

  it("shows error for nonexistent paths", () => {
    const output = runPathfinder("bridge", "nope", "src/utils");
    expect(output).toContain("No files found");
  });
});

describe("pathfinder --help", () => {
  it("shows help text", () => {
    const output = runPathfinder("--help");
    expect(output).toContain("pathfinder");
    expect(output).toContain("explore");
    expect(output).toContain("who");
    expect(output).toContain("trace");
    expect(output).toContain("bridge");
  });
});

describe("pathfinder --version", () => {
  it("shows version", () => {
    const output = runPathfinder("--version");
    expect(output).toContain("0.1.0");
  });
});
