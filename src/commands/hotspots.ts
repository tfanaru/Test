import chalk from "chalk";
import path from "node:path";
import {
  getFileChangeStats,
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

interface HotspotsOptions {
  limit: number;
  since?: string;
}

interface Hotspot {
  path: string;
  commits: number;
  authors: number;
  score: number;
}

/**
 * Score a file's "hotspot" risk.
 * Files that are frequently changed by many authors are likely to contain bugs.
 */
function scoreHotspot(commits: number, authors: number): number {
  // Geometric mean of commits and authors — rewards both dimensions
  return Math.sqrt(commits * authors);
}

function riskLabel(score: number, maxScore: number): string {
  const ratio = score / maxScore;
  if (ratio > 0.7) return chalk.red("● High");
  if (ratio > 0.4) return chalk.yellow("● Medium");
  return chalk.green("● Low");
}

export async function hotspots(
  directory: string,
  opts: HotspotsOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const targetDir = path.relative(repoRoot, path.resolve(cwd, directory));
  const displayPath = targetDir || ".";

  console.log(
    chalk.bold.cyan(`\n  Pathfinder — hotspots in `) +
      chalk.bold.white(displayPath),
  );
  console.log(divider());

  const fileStats = await getFileChangeStats(targetDir || ".", {
    since: opts.since,
    cwd: repoRoot,
  });

  if (fileStats.size === 0) {
    console.log(chalk.dim("  No file change history found."));
    console.log("");
    return;
  }

  // Build hotspot list
  const hotspotList: Hotspot[] = [];
  for (const [filePath, stats] of fileStats) {
    const score = scoreHotspot(stats.commits, stats.authors.size);
    hotspotList.push({
      path: filePath,
      commits: stats.commits,
      authors: stats.authors.size,
      score,
    });
  }

  // Sort by score descending
  hotspotList.sort((a, b) => b.score - a.score);
  const top = hotspotList.slice(0, opts.limit);

  if (top.length === 0) {
    console.log(chalk.dim("  No hotspots detected."));
    console.log("");
    return;
  }

  const maxScore = top[0].score;

  // --- Hotspot Ranking ---
  console.log(header("Hotspot Ranking"));
  console.log(
    chalk.dim("  Files with high churn + many authors are likely bug magnets.\n"),
  );

  for (let i = 0; i < top.length; i++) {
    const h = top[i];
    const display = truncatePath(h.path, 45);
    const risk = riskLabel(h.score, maxScore);
    console.log(
      `  ${chalk.dim(`${(i + 1).toString().padStart(2)}.`)} ${bar(h.score, maxScore, 15)} ${display}`,
    );
    console.log(
      `      ${risk} ${chalk.dim(`${h.commits} commits · ${h.authors} author${h.authors !== 1 ? "s" : ""} · score ${h.score.toFixed(1)}`)}`,
    );
  }

  // --- Summary Stats ---
  console.log(header("Summary"));
  const totalFiles = fileStats.size;
  const highRisk = hotspotList.filter(
    (h) => h.score / maxScore > 0.7,
  ).length;
  const medRisk = hotspotList.filter(
    (h) => h.score / maxScore > 0.4 && h.score / maxScore <= 0.7,
  ).length;

  console.log(labelValue("Files analyzed", formatNumber(totalFiles)));
  console.log(
    labelValue("High risk", chalk.red(formatNumber(highRisk))),
  );
  console.log(
    labelValue("Medium risk", chalk.yellow(formatNumber(medRisk))),
  );
  console.log(
    labelValue("Low risk", chalk.green(formatNumber(totalFiles - highRisk - medRisk))),
  );

  console.log(divider());
  console.log("");
}
