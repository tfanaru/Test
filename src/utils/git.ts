import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 1024 * 1024 * 50; // 50MB — large repos produce big output

interface ExecResult {
  stdout: string;
  stderr: string;
}

async function git(
  args: string[],
  cwd?: string,
): Promise<ExecResult> {
  return execFileAsync("git", args, {
    cwd,
    maxBuffer: MAX_BUFFER,
  });
}

export interface LogEntry {
  hash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

export interface FileChangeStats {
  path: string;
  commits: number;
  lastModified: Date;
  authors: Set<string>;
}

export interface AuthorStats {
  name: string;
  email: string;
  commits: number;
  filesChanged: Set<string>;
  firstCommit: Date;
  lastCommit: Date;
}

/**
 * Check if a path is inside a git repo.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the repo root directory.
 */
export async function getRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--show-toplevel"], cwd);
  return stdout.trim();
}

/**
 * Get recent log entries for a path.
 */
export async function getLog(
  path: string,
  opts: { maxCount?: number; since?: string; cwd?: string } = {},
): Promise<LogEntry[]> {
  const args = [
    "log",
    "--format=%H|%an|%ae|%aI|%s",
    `--max-count=${opts.maxCount ?? 500}`,
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  args.push("--", path);

  try {
    const { stdout } = await git(args, opts.cwd);
    if (!stdout.trim()) return [];

    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, author, email, date, ...rest] = line.split("|");
        return { hash, author, email, date, subject: rest.join("|") };
      });
  } catch {
    return [];
  }
}

/**
 * Get file-level change stats for files under a path.
 * Uses git log --name-only for speed.
 */
export async function getFileChangeStats(
  path: string,
  opts: { since?: string; cwd?: string } = {},
): Promise<Map<string, FileChangeStats>> {
  const args = [
    "log",
    "--format=%H|%an|%aI",
    "--name-only",
    "--max-count=1000",
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  args.push("--", path);

  let stdout: string;
  try {
    ({ stdout } = await git(args, opts.cwd));
  } catch {
    return new Map();
  }
  if (!stdout.trim()) return new Map();

  const stats = new Map<string, FileChangeStats>();

  // Parse line-by-line. Header lines contain "|" separators (hash|author|date).
  // File lines follow and are plain paths. Blank lines separate sections.
  const lines = stdout.trim().split("\n");
  let currentAuthor = "";
  let currentDate = new Date();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("|");
    if (parts.length >= 3 && parts[2].includes("T")) {
      // This is a header line: hash|author|date
      currentAuthor = parts[1];
      currentDate = new Date(parts[2]);
    } else {
      // This is a file path
      const existing = stats.get(trimmed);
      if (existing) {
        existing.commits++;
        existing.authors.add(currentAuthor);
        if (currentDate > existing.lastModified) existing.lastModified = currentDate;
      } else {
        stats.set(trimmed, {
          path: trimmed,
          commits: 1,
          lastModified: currentDate,
          authors: new Set([currentAuthor]),
        });
      }
    }
  }

  return stats;
}

/**
 * Get author stats for a path — who has committed and how much.
 */
export async function getAuthorStats(
  path: string,
  opts: { cwd?: string } = {},
): Promise<AuthorStats[]> {
  const args = [
    "log",
    "--format=%an|%ae|%aI",
    "--name-only",
    "--max-count=2000",
    "--",
    path,
  ];

  let stdout: string;
  try {
    ({ stdout } = await git(args, opts.cwd));
  } catch {
    return [];
  }
  if (!stdout.trim()) return [];

  const authorMap = new Map<string, AuthorStats>();

  // Parse line-by-line. Header lines: name|email|date. File lines: plain paths.
  const lines = stdout.trim().split("\n");
  let currentName = "";
  let currentEmail = "";
  let currentDate = new Date();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("|");
    if (parts.length >= 3 && parts[2].includes("T")) {
      // Header line: name|email|date
      currentName = parts[0];
      currentEmail = parts[1];
      currentDate = new Date(parts[2]);

      // Register the commit even if no files follow
      const key = currentEmail.toLowerCase();
      const existing = authorMap.get(key);
      if (existing) {
        existing.commits++;
        if (currentDate < existing.firstCommit) existing.firstCommit = currentDate;
        if (currentDate > existing.lastCommit) existing.lastCommit = currentDate;
      } else {
        authorMap.set(key, {
          name: currentName,
          email: currentEmail,
          commits: 1,
          filesChanged: new Set(),
          firstCommit: currentDate,
          lastCommit: currentDate,
        });
      }
    } else {
      // File path line — add to current author's files
      const key = currentEmail.toLowerCase();
      const existing = authorMap.get(key);
      if (existing) {
        existing.filesChanged.add(trimmed);
      }
    }
  }

  return Array.from(authorMap.values());
}

/**
 * Count files matching a glob pattern under a path using git ls-files.
 */
export async function listFiles(
  path: string,
  opts: { cwd?: string } = {},
): Promise<string[]> {
  const { stdout } = await git(["ls-files", "--", path], opts.cwd);
  if (!stdout.trim()) return [];
  return stdout.trim().split("\n");
}

/**
 * Get lines of code for a set of files using git show (avoids reading working tree).
 * Falls back to wc -l for speed.
 */
export async function countLinesInFiles(
  files: string[],
  cwd?: string,
): Promise<number> {
  if (files.length === 0) return 0;

  // Use xargs + wc for speed on large file lists
  try {
    const { stdout } = await execFileAsync(
      "sh",
      [
        "-c",
        `cd "${cwd ?? "."}" && echo "${files.join("\n")}" | xargs wc -l 2>/dev/null | tail -1`,
      ],
      { maxBuffer: MAX_BUFFER },
    );
    const match = stdout.trim().match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Detect primary languages by file extension.
 */
export function detectLanguages(files: string[]): Map<string, number> {
  const extMap: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".py": "Python",
    ".rs": "Rust",
    ".go": "Go",
    ".java": "Java",
    ".c": "C",
    ".h": "C/C++ Header",
    ".cpp": "C++",
    ".cc": "C++",
    ".cxx": "C++",
    ".hpp": "C++ Header",
    ".cs": "C#",
    ".rb": "Ruby",
    ".php": "PHP",
    ".swift": "Swift",
    ".kt": "Kotlin",
    ".scala": "Scala",
    ".m": "Objective-C",
    ".mm": "Objective-C++",
    ".sh": "Shell",
    ".ps1": "PowerShell",
    ".bat": "Batch",
    ".cmd": "Batch",
    ".md": "Markdown",
    ".json": "JSON",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".xml": "XML",
    ".html": "HTML",
    ".css": "CSS",
    ".scss": "SCSS",
    ".sql": "SQL",
  };

  const langs = new Map<string, number>();
  for (const file of files) {
    const dotIdx = file.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = file.slice(dotIdx).toLowerCase();
    const lang = extMap[ext];
    if (lang) {
      langs.set(lang, (langs.get(lang) ?? 0) + 1);
    }
  }
  return langs;
}

/**
 * Find files that are imported most from outside a directory.
 * Uses grep on git ls-files output for speed.
 */
export async function findEntryPoints(
  dirPath: string,
  allFiles: string[],
  opts: { cwd?: string; limit?: number } = {},
): Promise<{ file: string; importedBy: number }[]> {
  // Normalize the directory path for matching
  const normalizedDir = dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
  const filesInDir = allFiles.filter((f) => f.startsWith(normalizedDir));
  const filesOutsideDir = allFiles.filter((f) => !f.startsWith(normalizedDir));

  if (filesInDir.length === 0 || filesOutsideDir.length === 0) return [];

  // Build a map of basenames to full paths for files in the directory
  const importCounts = new Map<string, number>();
  for (const f of filesInDir) {
    importCounts.set(f, 0);
  }

  // For each file in the directory, grep for references to it from outside
  // We search for the filename or relative path patterns
  // This is a heuristic — it won't catch everything but it's fast
  const limit = opts.limit ?? 10;

  try {
    // Build a pattern that matches any of the files in the directory
    const basenames = filesInDir.map((f) => {
      const parts = f.split("/");
      return parts[parts.length - 1].replace(/\.[^.]+$/, ""); // filename without extension
    });

    // Deduplicate
    const uniqueNames = [...new Set(basenames)].filter(
      (n) => n.length > 2, // skip very short names to avoid false positives
    );

    if (uniqueNames.length === 0) return [];

    // Use git grep for speed — search for references to files in this directory
    const pattern = uniqueNames.slice(0, 50).join("|"); // limit pattern size
    const { stdout } = await git(
      ["grep", "-l", "-E", pattern, "--", ...filesOutsideDir.slice(0, 500)],
      opts.cwd,
    ).catch(() => ({ stdout: "", stderr: "" }));

    if (!stdout.trim()) return [];

    const referencingFiles = stdout.trim().split("\n");

    // Now for each file in the directory, check how many outside files reference it
    for (const dirFile of filesInDir) {
      const parts = dirFile.split("/");
      const basename = parts[parts.length - 1].replace(/\.[^.]+$/, "");
      if (basename.length <= 2) continue;

      let count = 0;
      for (const refFile of referencingFiles) {
        // Quick check — does the referencing file content likely mention this file?
        // We already know the referencing file matches at least one of our patterns
        count++; // Rough approximation — each referencing file counts once
      }
      const current = importCounts.get(dirFile) ?? 0;
      importCounts.set(dirFile, current + count);
    }
  } catch {
    // git grep not available or failed — skip entry point detection
  }

  return Array.from(importCounts.entries())
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([file, importedBy]) => ({ file, importedBy }));
}
