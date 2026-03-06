import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  isGitRepo,
  getRepoRoot,
  getLog,
  getFileChangeStats,
  getAuthorStats,
  listFiles,
  detectLanguages,
} from "../utils/git.js";

// Create a temporary git repo for testing
let tmpDir: string;

function gitInTmp(...args: string[]) {
  execFileSync("git", args, { cwd: tmpDir });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pathfinder-test-"));

  gitInTmp("init");
  gitInTmp("config", "user.email", "alice@test.com");
  gitInTmp("config", "user.name", "Alice");
  gitInTmp("config", "commit.gpgsign", "false");

  // Create some files and commits
  fs.mkdirSync(path.join(tmpDir, "src", "utils"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "commands"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "lib"), { recursive: true });

  fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), 'import "./utils/helper";\n');
  fs.writeFileSync(path.join(tmpDir, "src", "utils", "helper.ts"), "export const x = 1;\n");
  fs.writeFileSync(path.join(tmpDir, "src", "commands", "run.ts"), 'import "../utils/helper";\n');

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Initial commit by Alice");

  // Second commit by a different author
  gitInTmp("config", "user.email", "bob@test.com");
  gitInTmp("config", "user.name", "Bob");

  fs.writeFileSync(path.join(tmpDir, "src", "utils", "helper.ts"), "export const x = 2;\nexport const y = 3;\n");
  fs.writeFileSync(path.join(tmpDir, "lib", "extra.py"), "import os\n");

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Update helper and add Python file");

  // Third commit — Alice again
  gitInTmp("config", "user.email", "alice@test.com");
  gitInTmp("config", "user.name", "Alice");

  fs.writeFileSync(path.join(tmpDir, "src", "commands", "run.ts"), 'import "../utils/helper";\nconsole.log("hi");\n');

  gitInTmp("add", "-A");
  gitInTmp("commit", "-m", "Update run command");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("isGitRepo", () => {
  it("returns true for a git repo", async () => {
    expect(await isGitRepo(tmpDir)).toBe(true);
  });

  it("returns false for a non-repo directory", async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-repo-"));
    try {
      expect(await isGitRepo(nonRepo)).toBe(false);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe("getRepoRoot", () => {
  it("returns the repo root directory", async () => {
    const root = await getRepoRoot(tmpDir);
    expect(root).toBe(fs.realpathSync(tmpDir));
  });

  it("works from a subdirectory", async () => {
    const root = await getRepoRoot(path.join(tmpDir, "src"));
    expect(root).toBe(fs.realpathSync(tmpDir));
  });
});

describe("getLog", () => {
  it("returns log entries", async () => {
    const entries = await getLog(".", { cwd: tmpDir });
    expect(entries.length).toBe(3);
    expect(entries[0].subject).toBe("Update run command");
    expect(entries[0].author).toBe("Alice");
  });

  it("respects maxCount", async () => {
    const entries = await getLog(".", { maxCount: 1, cwd: tmpDir });
    expect(entries.length).toBe(1);
  });

  it("returns empty array for path with no history", async () => {
    const entries = await getLog("nonexistent-dir", { cwd: tmpDir });
    expect(entries).toEqual([]);
  });

  it("filters by path", async () => {
    const entries = await getLog("lib", { cwd: tmpDir });
    expect(entries.length).toBe(1);
    expect(entries[0].author).toBe("Bob");
  });
});

describe("getFileChangeStats", () => {
  it("returns stats for changed files", async () => {
    const stats = await getFileChangeStats(".", { cwd: tmpDir });
    expect(stats.size).toBeGreaterThan(0);

    // helper.ts was changed in 2 commits
    const helperStats = stats.get("src/utils/helper.ts");
    expect(helperStats).toBeDefined();
    expect(helperStats!.commits).toBe(2);
    expect(helperStats!.authors.size).toBe(2);
    expect(helperStats!.authors.has("Alice")).toBe(true);
    expect(helperStats!.authors.has("Bob")).toBe(true);
  });

  it("returns empty map for path with no changes", async () => {
    const stats = await getFileChangeStats("nonexistent", { cwd: tmpDir });
    expect(stats.size).toBe(0);
  });
});

describe("getAuthorStats", () => {
  it("returns author statistics", async () => {
    const stats = await getAuthorStats(".", { cwd: tmpDir });
    expect(stats.length).toBe(2);

    const alice = stats.find((s) => s.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice!.commits).toBe(2);
    expect(alice!.email).toBe("alice@test.com");

    const bob = stats.find((s) => s.name === "Bob");
    expect(bob).toBeDefined();
    expect(bob!.commits).toBe(1);
  });

  it("tracks files changed per author", async () => {
    const stats = await getAuthorStats(".", { cwd: tmpDir });
    const alice = stats.find((s) => s.name === "Alice")!;
    expect(alice.filesChanged.size).toBeGreaterThanOrEqual(2);
  });

  it("returns empty for nonexistent path", async () => {
    const stats = await getAuthorStats("nope", { cwd: tmpDir });
    expect(stats).toEqual([]);
  });
});

describe("listFiles", () => {
  it("lists tracked files", async () => {
    const files = await listFiles(".", { cwd: tmpDir });
    expect(files).toContain("src/index.ts");
    expect(files).toContain("src/utils/helper.ts");
    expect(files).toContain("lib/extra.py");
  });

  it("lists files under a subdirectory", async () => {
    const files = await listFiles("src/utils", { cwd: tmpDir });
    expect(files).toEqual(["src/utils/helper.ts"]);
  });
});

describe("detectLanguages", () => {
  it("detects TypeScript files", () => {
    const langs = detectLanguages(["a.ts", "b.tsx", "c.ts"]);
    expect(langs.get("TypeScript")).toBe(3);
  });

  it("detects multiple languages", () => {
    const langs = detectLanguages(["a.ts", "b.py", "c.go", "d.rs"]);
    expect(langs.get("TypeScript")).toBe(1);
    expect(langs.get("Python")).toBe(1);
    expect(langs.get("Go")).toBe(1);
    expect(langs.get("Rust")).toBe(1);
  });

  it("handles C/C++ variants", () => {
    const langs = detectLanguages(["a.c", "b.cpp", "c.cc", "d.cxx", "e.h", "f.hpp"]);
    expect(langs.get("C")).toBe(1);
    expect(langs.get("C++")).toBe(3);
    expect(langs.get("C/C++ Header")).toBe(1);
    expect(langs.get("C++ Header")).toBe(1);
  });

  it("groups .ts and .tsx as TypeScript", () => {
    const langs = detectLanguages(["a.ts", "b.tsx"]);
    expect(langs.get("TypeScript")).toBe(2);
  });

  it("groups .yml and .yaml as YAML", () => {
    const langs = detectLanguages(["a.yml", "b.yaml"]);
    expect(langs.get("YAML")).toBe(2);
  });

  it("skips files without extensions", () => {
    const langs = detectLanguages(["Makefile", "Dockerfile", "a.ts"]);
    expect(langs.size).toBe(1);
  });

  it("skips unknown extensions", () => {
    const langs = detectLanguages(["a.xyz", "b.abc"]);
    expect(langs.size).toBe(0);
  });

  it("is case-insensitive for extensions", () => {
    const langs = detectLanguages(["a.TS", "b.Py"]);
    expect(langs.get("TypeScript")).toBe(1);
    expect(langs.get("Python")).toBe(1);
  });
});
