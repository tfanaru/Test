import chalk from "chalk";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getRepoRoot,
} from "../utils/git.js";
import {
  header,
  labelValue,
  bar,
  formatNumber,
  divider,
  truncatePath,
} from "../utils/format.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 50;

interface ReviewOptions {
  limit: number;
}

interface ReviewFileStats {
  path: string;
  additions: number;
  deletions: number;
}

interface ReviewAuthorStats {
  name: string;
  commits: number;
  additions: number;
  deletions: number;
}

async function git(args: string[], cwd?: string) {
  return execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
}

export function parseNumstat(output: string): ReviewFileStats[] {
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

export function groupByDirectory(
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

export function assessBlastRadius(fileStats: ReviewFileStats[]): string {
  const uniqueDirs = new Set(fileStats.map((f) => path.dirname(f.path)));
  if (uniqueDirs.size > 10 || fileStats.length > 50) return "high";
  if (uniqueDirs.size > 3 || fileStats.length > 15) return "medium";
  return "low";
}

export async function review(
  commitRange: string,
  opts: ReviewOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);

  console.log(
    chalk.bold.cyan(`\n  Pathfinder — reviewing `) +
      chalk.bold.white(commitRange),
  );
  console.log(divider());

  // Get commits in range
  let logStdout: string;
  try {
    const result = await git(
      ["log", "--format=%H|%an|%ae|%aI|%s", commitRange],
      repoRoot,
    );
    logStdout = result.stdout;
  } catch {
    console.log(chalk.red(`  Invalid commit range: ${commitRange}`));
    console.log(chalk.dim("  Use formats like: HEAD~5..HEAD, main..feature, abc123..def456"));
    console.log("");
    return;
  }

  if (!logStdout.trim()) {
    console.log(chalk.dim("  No commits found in this range."));
    console.log("");
    return;
  }

  const commits = logStdout.trim().split("\n").map((line) => {
    const [hash, author, email, date, ...rest] = line.split("|");
    return { hash, author, email, date, subject: rest.join("|") };
  });

  // Get file-level diff stats
  let diffStdout: string;
  try {
    const result = await git(
      ["diff", "--stat", "--numstat", commitRange],
      repoRoot,
    );
    diffStdout = result.stdout;
  } catch {
    diffStdout = "";
  }

  const fileStats = parseNumstat(diffStdout);

  // Get per-author stats from the commits
  const authorMap = new Map<string, ReviewAuthorStats>();
  for (const c of commits) {
    const existing = authorMap.get(c.author);
    if (existing) {
      existing.commits++;
    } else {
      authorMap.set(c.author, {
        name: c.author,
        commits: 1,
        additions: 0,
        deletions: 0,
      });
    }
  }

  // Get per-author diff stats
  try {
    const result = await git(
      ["log", "--format=%an", "--numstat", commitRange],
      repoRoot,
    );
    let currentAuthor = "";
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const numMatch = trimmed.match(/^(\d+|-)\t(\d+|-)\t/);
      if (numMatch) {
        const add = numMatch[1] === "-" ? 0 : parseInt(numMatch[1], 10);
        const del = numMatch[2] === "-" ? 0 : parseInt(numMatch[2], 10);
        const author = authorMap.get(currentAuthor);
        if (author) {
          author.additions += add;
          author.deletions += del;
        }
      } else {
        currentAuthor = trimmed;
      }
    }
  } catch {
    // Skip author diff stats on error
  }

  // --- Overview ---
  console.log(header("Overview"));
  console.log(labelValue("Commits", formatNumber(commits.length)));
  console.log(labelValue("Authors", formatNumber(authorMap.size)));
  console.log(labelValue("Files changed", formatNumber(fileStats.length)));

  const totalAdd = fileStats.reduce((s, f) => s + f.additions, 0);
  const totalDel = fileStats.reduce((s, f) => s + f.deletions, 0);
  console.log(
    labelValue("Lines changed", `${chalk.green(`+${formatNumber(totalAdd)}`)} ${chalk.red(`-${formatNumber(totalDel)}`)}`),
  );

  // --- Directories affected ---
  console.log(header("Areas Affected"));
  const dirMap = groupByDirectory(fileStats);

  const sortedDirs = [...dirMap.entries()]
    .sort((a, b) => b[1].files - a[1].files)
    .slice(0, opts.limit);

  if (sortedDirs.length > 0) {
    const maxFiles = sortedDirs[0][1].files;
    for (const [dir, stats] of sortedDirs) {
      console.log(
        `  ${bar(stats.files, maxFiles, 12)} ${chalk.white(dir)} ${chalk.dim(`(${stats.files} files, ${chalk.green(`+${stats.additions}`)} ${chalk.red(`-${stats.deletions}`)})`)}`,
      );
    }
  }

  // --- Most changed files ---
  console.log(header("Most Changed Files"));
  const sortedFiles = [...fileStats]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, opts.limit);

  if (sortedFiles.length > 0) {
    const maxChanges = sortedFiles[0].additions + sortedFiles[0].deletions;
    for (let i = 0; i < sortedFiles.length; i++) {
      const f = sortedFiles[i];
      const total = f.additions + f.deletions;
      const display = truncatePath(f.path, 45);
      console.log(
        `  ${chalk.dim(`${(i + 1).toString().padStart(2)}.`)} ${bar(total, maxChanges, 12)} ${display} ${chalk.dim(`(${chalk.green(`+${f.additions}`)} ${chalk.red(`-${f.deletions}`)})`)}`,
      );
    }
  }

  // --- Contributors ---
  console.log(header("Contributors"));
  const sortedAuthors = [...authorMap.values()]
    .sort((a, b) => b.commits - a.commits);

  if (sortedAuthors.length > 0) {
    const maxCommits = sortedAuthors[0].commits;
    for (const a of sortedAuthors) {
      console.log(
        `  ${bar(a.commits, maxCommits, 12)} ${chalk.white(a.name)} ${chalk.dim(`(${a.commits} commits, ${chalk.green(`+${a.additions}`)} ${chalk.red(`-${a.deletions}`)})`)}`,
      );
    }
  }

  // --- Commit Log ---
  console.log(header("Commits"));
  const showCommits = commits.slice(0, opts.limit);
  for (let i = 0; i < showCommits.length; i++) {
    const c = showCommits[i];
    console.log(
      `  ${chalk.dim(c.hash.slice(0, 8))} ${chalk.white(c.subject)}`,
    );
    console.log(
      `           ${chalk.dim(c.author)}`,
    );
  }

  // Blast radius assessment
  console.log(header("Blast Radius"));
  const uniqueDirs = new Set(fileStats.map((f) => path.dirname(f.path)));
  const blastLevel = assessBlastRadius(fileStats);
  let risk: string;
  if (blastLevel === "high") {
    risk = chalk.red("● High — changes span many directories and files");
  } else if (blastLevel === "medium") {
    risk = chalk.yellow("● Medium — changes touch several areas");
  } else {
    risk = chalk.green("● Low — changes are well-scoped");
  }
  console.log(`  ${risk}`);
  console.log(labelValue("Directories touched", formatNumber(uniqueDirs.size)));
  console.log(labelValue("Files touched", formatNumber(fileStats.length)));

  console.log(divider());
  console.log("");
}
