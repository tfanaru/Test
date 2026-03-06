import chalk from "chalk";
import path from "node:path";
import {
  getLog,
  getRepoRoot,
  type LogEntry,
} from "../utils/git.js";
import {
  header,
  labelValue,
  bar,
  relativeTime,
  formatNumber,
  divider,
} from "../utils/format.js";

interface DriftOptions {
  since?: string;
  periods: number;
}

interface PeriodStats {
  label: string;
  commits: number;
  authors: Set<string>;
  start: Date;
  end: Date;
}

/**
 * Bucket log entries into equal time periods for activity analysis.
 */
function bucketByPeriod(
  logs: LogEntry[],
  periods: number,
): PeriodStats[] {
  if (logs.length === 0) return [];

  const dates = logs.map((l) => new Date(l.date).getTime());
  const earliest = Math.min(...dates);
  const latest = Math.max(...dates);
  const span = latest - earliest;

  if (span === 0) {
    // All commits on the same date
    const authors = new Set(logs.map((l) => l.author));
    return [
      {
        label: "all",
        commits: logs.length,
        authors,
        start: new Date(earliest),
        end: new Date(latest),
      },
    ];
  }

  const bucketSize = span / periods;
  const buckets: PeriodStats[] = [];

  for (let i = 0; i < periods; i++) {
    const start = new Date(earliest + i * bucketSize);
    const end = new Date(earliest + (i + 1) * bucketSize);
    buckets.push({
      label: "",
      commits: 0,
      authors: new Set(),
      start,
      end,
    });
  }

  for (const log of logs) {
    const t = new Date(log.date).getTime();
    let idx = Math.floor((t - earliest) / bucketSize);
    if (idx >= periods) idx = periods - 1;
    buckets[idx].commits++;
    buckets[idx].authors.add(log.author);
  }

  // Generate labels
  for (const b of buckets) {
    b.label = `${b.start.toLocaleDateString("en-US", { month: "short", year: "2-digit" })} → ${b.end.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}`;
  }

  return buckets;
}

/**
 * Detect major changes — commits that touch many lines.
 */
function findMajorCommits(logs: LogEntry[]): LogEntry[] {
  // Heuristic: commits with keywords that suggest big changes
  const keywords = [
    /refactor/i,
    /rewrite/i,
    /overhaul/i,
    /redesign/i,
    /migration/i,
    /breaking/i,
    /major/i,
    /rework/i,
    /restructur/i,
  ];

  return logs.filter((log) =>
    keywords.some((kw) => kw.test(log.subject)),
  );
}

export async function drift(
  target: string,
  opts: DriftOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const relativePath = path.relative(repoRoot, path.resolve(cwd, target));
  const displayPath = relativePath || ".";

  console.log(
    chalk.bold.cyan(`\n  Pathfinder — drift analysis for `) +
      chalk.bold.white(displayPath),
  );
  console.log(divider());

  const logs = await getLog(relativePath || ".", {
    maxCount: 2000,
    since: opts.since,
    cwd: repoRoot,
  });

  if (logs.length === 0) {
    console.log(chalk.dim("  No commit history found for this path."));
    console.log("");
    return;
  }

  // --- Summary ---
  console.log(header("Summary"));
  const totalAuthors = new Set(logs.map((l) => l.author));
  const firstDate = new Date(logs[logs.length - 1].date);
  const lastDate = new Date(logs[0].date);
  const spanDays = Math.max(
    1,
    Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)),
  );

  console.log(labelValue("Total commits", formatNumber(logs.length)));
  console.log(labelValue("Contributors", formatNumber(totalAuthors.size)));
  console.log(
    labelValue("Time span", `${formatNumber(spanDays)} days (${relativeTime(firstDate)} → ${relativeTime(lastDate)})`),
  );

  const commitsPerDay = logs.length / spanDays;
  let churnLevel: string;
  if (commitsPerDay > 1) churnLevel = chalk.red("High churn");
  else if (commitsPerDay > 0.2) churnLevel = chalk.yellow("Moderate churn");
  else if (commitsPerDay > 0.05) churnLevel = chalk.green("Stable");
  else churnLevel = chalk.dim("Low activity");
  console.log(labelValue("Churn rate", `${commitsPerDay.toFixed(2)}/day — ${churnLevel}`));

  // --- Activity Over Time ---
  console.log(header("Activity Over Time"));
  const periods = bucketByPeriod(logs, Math.min(opts.periods, logs.length));
  const maxCommits = Math.max(...periods.map((p) => p.commits));

  for (const period of periods) {
    const authCount = period.authors.size;
    console.log(
      `  ${bar(period.commits, maxCommits, 20)} ${chalk.dim(period.label)} ${chalk.white(`${period.commits} commits`)} ${chalk.dim(`(${authCount} author${authCount !== 1 ? "s" : ""})`)}`,
    );
  }

  // --- Trend ---
  console.log(header("Trend"));
  if (periods.length >= 2) {
    const firstHalf = periods.slice(0, Math.floor(periods.length / 2));
    const secondHalf = periods.slice(Math.floor(periods.length / 2));
    const firstTotal = firstHalf.reduce((s, p) => s + p.commits, 0);
    const secondTotal = secondHalf.reduce((s, p) => s + p.commits, 0);

    if (secondTotal > firstTotal * 1.5) {
      console.log(chalk.yellow("  ↑ Activity is increasing — this area is heating up."));
    } else if (firstTotal > secondTotal * 1.5) {
      console.log(chalk.blue("  ↓ Activity is decreasing — this area is stabilizing."));
    } else {
      console.log(chalk.green("  → Activity is steady."));
    }
  } else {
    console.log(chalk.dim("  Not enough data to determine trend."));
  }

  // --- Major Changes ---
  console.log(header("Notable Commits"));
  const major = findMajorCommits(logs);
  if (major.length > 0) {
    for (let i = 0; i < Math.min(major.length, 10); i++) {
      const m = major[i];
      const date = relativeTime(new Date(m.date));
      console.log(
        `  ${chalk.dim(`${(i + 1).toString().padStart(2)}.`)} ${chalk.white(m.subject)}`,
      );
      console.log(
        `      ${chalk.dim(`${m.author} · ${date} · ${m.hash.slice(0, 8)}`)}`,
      );
    }
  } else {
    console.log(chalk.dim("  No major refactors/rewrites detected in commit messages."));
  }

  console.log(divider());
  console.log("");
}
