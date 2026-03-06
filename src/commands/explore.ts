import chalk from "chalk";
import path from "node:path";
import {
  getLog,
  getFileChangeStats,
  getAuthorStats,
  listFiles,
  detectLanguages,
  findEntryPoints,
  getRepoRoot,
} from "../utils/git.js";
import {
  header,
  labelValue,
  listItem,
  bar,
  relativeTime,
  formatNumber,
  divider,
  truncatePath,
} from "../utils/format.js";

interface ExploreOptions {
  limit: number;
  since?: string;
  json?: boolean;
}

export async function explore(
  directory: string,
  opts: ExploreOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const targetDir = path.relative(repoRoot, path.resolve(cwd, directory));
  const displayPath = targetDir || ".";

  // Run file listing and git log in parallel
  const [files, logs, fileStats, authorStats] = await Promise.all([
    listFiles(targetDir || ".", { cwd: repoRoot }),
    getLog(targetDir || ".", { maxCount: 200, since: opts.since, cwd: repoRoot }),
    getFileChangeStats(targetDir || ".", { since: opts.since, cwd: repoRoot }),
    getAuthorStats(targetDir || ".", { cwd: repoRoot }),
  ]);

  const languages = detectLanguages(files);
  const sortedLangs = [...languages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const sortedFiles = [...fileStats.entries()]
    .sort((a, b) => b[1].commits - a[1].commits)
    .slice(0, opts.limit);

  const sortedAuthors = authorStats
    .sort((a, b) => b.commits - a.commits)
    .slice(0, opts.limit);

  const entryPoints = await findEntryPoints(targetDir || ".", files, {
    cwd: repoRoot,
    limit: 5,
  });

  // --- JSON output ---
  if (opts.json) {
    const daysSinceLastCommit = logs.length > 0
      ? Math.floor((Date.now() - new Date(logs[0].date).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const result = {
      path: displayPath,
      overview: {
        totalFiles: files.length,
        languages: sortedLangs.map(([lang, count]) => ({
          language: lang,
          files: count,
          percentage: Math.round((count / files.length) * 100),
        })),
      },
      activity: logs.length > 0
        ? {
            lastCommit: logs[0].date,
            oldestCommit: logs[logs.length - 1].date,
            commitsAnalyzed: logs.length,
            health: daysSinceLastCommit! < 7 ? "active"
              : daysSinceLastCommit! < 30 ? "moderate"
              : daysSinceLastCommit! < 90 ? "slow"
              : "dormant",
          }
        : null,
      mostChangedFiles: sortedFiles.map(([filePath, stats]) => ({
        path: filePath,
        commits: stats.commits,
        authors: stats.authors.size,
      })),
      topContributors: sortedAuthors.map((a) => ({
        name: a.name,
        email: a.email,
        commits: a.commits,
        filesChanged: a.filesChanged.size,
        lastActive: a.lastCommit.toISOString(),
      })),
      entryPoints: entryPoints.map((ep) => ({
        file: ep.file,
        importedBy: ep.importedBy,
      })),
    };

    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // --- Formatted output ---
  console.log(
    chalk.bold.cyan(`\n  Pathfinder — exploring `) +
      chalk.bold.white(displayPath),
  );
  console.log(divider());

  // --- Overview ---
  console.log(header("Overview"));
  console.log(labelValue("Files", formatNumber(files.length)));

  if (sortedLangs.length > 0) {
    const maxLangCount = sortedLangs[0][1];
    console.log(labelValue("Languages", ""));
    for (const [lang, count] of sortedLangs) {
      const pct = ((count / files.length) * 100).toFixed(0);
      console.log(
        `    ${bar(count, maxLangCount, 15)} ${chalk.white(lang)} ${chalk.dim(`(${count} files, ${pct}%)`)}`,
      );
    }
  }

  // --- Activity ---
  console.log(header("Activity"));
  if (logs.length > 0) {
    const latest = new Date(logs[0].date);
    const oldest = new Date(logs[logs.length - 1].date);
    console.log(labelValue("Last commit", relativeTime(latest)));
    console.log(
      labelValue("Commit range", `${relativeTime(oldest)} → ${relativeTime(latest)}`),
    );
    console.log(labelValue("Commits analyzed", formatNumber(logs.length)));

    // Activity health indicator
    const daysSinceLastCommit = Math.floor(
      (Date.now() - latest.getTime()) / (1000 * 60 * 60 * 24),
    );
    let health: string;
    if (daysSinceLastCommit < 7) health = chalk.green("● Active");
    else if (daysSinceLastCommit < 30) health = chalk.yellow("● Moderate");
    else if (daysSinceLastCommit < 90) health = chalk.red("● Slow");
    else health = chalk.dim("○ Dormant");
    console.log(labelValue("Health", health));
  } else {
    console.log(chalk.dim("  No commit history found."));
  }

  // --- Most Changed Files ---
  console.log(header("Most Changed Files"));
  if (sortedFiles.length > 0) {
    const maxCommits = sortedFiles[0][1].commits;
    for (let i = 0; i < sortedFiles.length; i++) {
      const [filePath, stats] = sortedFiles[i];
      const display = truncatePath(filePath, 50);
      const detail = `${stats.commits} commits, ${stats.authors.size} author${stats.authors.size > 1 ? "s" : ""}`;
      console.log(
        `  ${chalk.dim(`${(i + 1).toString().padStart(2)}.`)} ${bar(stats.commits, maxCommits, 12)} ${display} ${chalk.dim(`(${detail})`)}`,
      );
    }
  } else {
    console.log(chalk.dim("  No file changes found."));
  }

  // --- Top Contributors ---
  console.log(header("Top Contributors"));
  if (sortedAuthors.length > 0) {
    const maxAuthorCommits = sortedAuthors[0].commits;
    for (let i = 0; i < sortedAuthors.length; i++) {
      const a = sortedAuthors[i];
      const detail = `${a.commits} commits, ${a.filesChanged.size} files, last active ${relativeTime(a.lastCommit)}`;
      console.log(
        `  ${chalk.dim(`${(i + 1).toString().padStart(2)}.`)} ${bar(a.commits, maxAuthorCommits, 12)} ${chalk.white(a.name)} ${chalk.dim(`(${detail})`)}`,
      );
    }
  } else {
    console.log(chalk.dim("  No contributors found."));
  }

  // --- Entry Points ---
  console.log(header("Likely Entry Points"));
  if (entryPoints.length > 0) {
    for (let i = 0; i < entryPoints.length; i++) {
      const ep = entryPoints[i];
      console.log(
        listItem(i, truncatePath(ep.file), `referenced from ~${ep.importedBy} external files`),
      );
    }
  } else {
    console.log(
      chalk.dim("  Could not determine entry points (directory may be self-contained)."),
    );
  }

  console.log(divider());
  console.log("");
}
