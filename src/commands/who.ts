import chalk from "chalk";
import path from "node:path";
import {
  getAuthorStats,
  getRepoRoot,
  type AuthorStats,
} from "../utils/git.js";
import {
  header,
  labelValue,
  bar,
  relativeTime,
  formatNumber,
  divider,
} from "../utils/format.js";

interface WhoOptions {
  limit: number;
  since?: string;
  json?: boolean;
}

interface ScoredAuthor {
  stats: AuthorStats;
  score: number;
  breakdown: {
    recency: number;
    volume: number;
    breadth: number;
  };
}

/**
 * Score an author's expertise. Higher is better.
 * Factors:
 *   - Recency: How recently they committed (exponential decay)
 *   - Volume: Number of commits (log-scaled)
 *   - Breadth: Number of distinct files touched (log-scaled)
 */
function scoreAuthor(
  author: AuthorStats,
  maxCommits: number,
  maxFiles: number,
): ScoredAuthor {
  const now = new Date();
  const daysSinceLastCommit = Math.max(
    1,
    (now.getTime() - author.lastCommit.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Recency: exponential decay with 180-day half-life
  const recency = Math.exp(-daysSinceLastCommit / 180);

  // Volume: log-scaled relative to the top contributor
  const volume =
    maxCommits > 1
      ? Math.log(author.commits + 1) / Math.log(maxCommits + 1)
      : 1;

  // Breadth: log-scaled relative to the widest contributor
  const breadth =
    maxFiles > 1
      ? Math.log(author.filesChanged.size + 1) / Math.log(maxFiles + 1)
      : 1;

  // Weighted combination: recency matters most, then volume, then breadth
  const score = recency * 0.4 + volume * 0.35 + breadth * 0.25;

  return {
    stats: author,
    score,
    breakdown: { recency, volume, breadth },
  };
}

function describeTenure(author: AuthorStats): string {
  const spanMs = author.lastCommit.getTime() - author.firstCommit.getTime();
  const spanDays = Math.floor(spanMs / (1000 * 60 * 60 * 24));

  if (spanDays < 7) return "brief involvement";
  if (spanDays < 90) return `active over ${Math.floor(spanDays / 7)} weeks`;
  if (spanDays < 365) return `active over ${Math.floor(spanDays / 30)} months`;
  return `active over ${Math.floor(spanDays / 365)}+ years`;
}

export async function who(
  targetPath: string,
  opts: WhoOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const relativePath = path.relative(repoRoot, path.resolve(cwd, targetPath));
  const displayPath = relativePath || ".";

  const authorStats = await getAuthorStats(relativePath || ".", { cwd: repoRoot });

  if (authorStats.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ path: displayPath, experts: [], summary: { totalContributors: 0, activeInLast90Days: 0 } }, null, 2));
    } else {
      console.log(
        chalk.bold.cyan(`\n  Pathfinder — who knows `) +
          chalk.bold.white(displayPath) +
          chalk.bold.cyan(` best?`),
      );
      console.log(divider());
      console.log(chalk.dim("  No commit history found for this path."));
      console.log("");
    }
    return;
  }

  const maxCommits = Math.max(...authorStats.map((a) => a.commits));
  const maxFiles = Math.max(...authorStats.map((a) => a.filesChanged.size));

  const scored = authorStats
    .map((a) => scoreAuthor(a, maxCommits, maxFiles))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit);

  const activeRecently = authorStats.filter((a) => {
    const days =
      (Date.now() - a.lastCommit.getTime()) / (1000 * 60 * 60 * 24);
    return days < 90;
  });

  // --- JSON output ---
  if (opts.json) {
    const result = {
      path: displayPath,
      experts: scored.map(({ stats, score, breakdown }) => ({
        name: stats.name,
        email: stats.email,
        score: Math.round(score * 1000) / 1000,
        breakdown: {
          recency: Math.round(breakdown.recency * 100),
          volume: Math.round(breakdown.volume * 100),
          breadth: Math.round(breakdown.breadth * 100),
        },
        commits: stats.commits,
        filesChanged: stats.filesChanged.size,
        firstCommit: stats.firstCommit.toISOString(),
        lastCommit: stats.lastCommit.toISOString(),
        tenure: describeTenure(stats),
      })),
      summary: {
        totalContributors: authorStats.length,
        activeInLast90Days: activeRecently.length,
      },
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // --- Formatted output ---
  console.log(
    chalk.bold.cyan(`\n  Pathfinder — who knows `) +
      chalk.bold.white(displayPath) +
      chalk.bold.cyan(` best?`),
  );
  console.log(divider());

  console.log(header("Expertise Ranking"));
  console.log("");

  const topScore = scored[0]?.score ?? 1;

  for (let i = 0; i < scored.length; i++) {
    const { stats, score, breakdown } = scored[i];
    const rank = (i + 1).toString().padStart(2);
    const relScore = score / topScore;

    // Main line
    console.log(
      `  ${chalk.dim(`${rank}.`)} ${bar(relScore, 1, 15)} ${chalk.bold.white(stats.name)}`,
    );

    // Summary line
    const parts: string[] = [];
    parts.push(`${formatNumber(stats.commits)} commits`);
    parts.push(`${stats.filesChanged.size} files`);
    parts.push(`last active ${relativeTime(stats.lastCommit)}`);
    parts.push(describeTenure(stats));
    console.log(`      ${chalk.dim(parts.join(" · "))}`);

    // Score breakdown for top 3
    if (i < 3) {
      const r = chalk.green(`recency ${(breakdown.recency * 100).toFixed(0)}%`);
      const v = chalk.blue(`volume ${(breakdown.volume * 100).toFixed(0)}%`);
      const b = chalk.magenta(`breadth ${(breakdown.breadth * 100).toFixed(0)}%`);
      console.log(`      ${chalk.dim("score:")} ${r} ${v} ${b}`);
    }
    console.log("");
  }

  console.log(divider());
  console.log(
    labelValue("Total contributors", formatNumber(authorStats.length)),
  );
  console.log(
    labelValue("Active in last 90 days", formatNumber(activeRecently.length)),
  );

  if (activeRecently.length === 0) {
    console.log(
      chalk.yellow(
        "\n  ⚠ No recent activity. The original authors may have moved on.",
      ),
    );
  }

  console.log("");
}
