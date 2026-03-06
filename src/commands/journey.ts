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
  relativeTime,
  formatNumber,
  divider,
} from "../utils/format.js";

interface JourneyOptions {
  from?: string;
  limit: number;
}

interface OwnershipPeriod {
  author: string;
  startDate: Date;
  endDate: Date;
  commits: number;
}

/**
 * Group sequential commits by the same author into "ownership periods".
 * Logs should be in reverse chronological order (newest first).
 */
function buildOwnershipTimeline(logs: LogEntry[]): OwnershipPeriod[] {
  if (logs.length === 0) return [];

  // Work from oldest to newest
  const chronological = [...logs].reverse();
  const periods: OwnershipPeriod[] = [];

  let current: OwnershipPeriod = {
    author: chronological[0].author,
    startDate: new Date(chronological[0].date),
    endDate: new Date(chronological[0].date),
    commits: 1,
  };

  for (let i = 1; i < chronological.length; i++) {
    const log = chronological[i];
    if (log.author === current.author) {
      current.endDate = new Date(log.date);
      current.commits++;
    } else {
      periods.push(current);
      current = {
        author: log.author,
        startDate: new Date(log.date),
        endDate: new Date(log.date),
        commits: 1,
      };
    }
  }
  periods.push(current);

  return periods;
}

/**
 * Identify milestone commits — first commit, large message changes, etc.
 */
function findMilestones(
  logs: LogEntry[],
  limit: number,
): { log: LogEntry; reason: string }[] {
  if (logs.length === 0) return [];

  const milestones: { log: LogEntry; reason: string }[] = [];

  // The oldest commit (creation)
  const oldest = logs[logs.length - 1];
  milestones.push({ log: oldest, reason: "Created" });

  // Look for milestone-like commits
  const milestoneKeywords = [
    { pattern: /refactor/i, label: "Refactored" },
    { pattern: /rewrite/i, label: "Rewritten" },
    { pattern: /fix|bug/i, label: "Bug fix" },
    { pattern: /feat|feature|add/i, label: "Feature added" },
    { pattern: /breaking/i, label: "Breaking change" },
    { pattern: /migrat/i, label: "Migration" },
    { pattern: /deprecat/i, label: "Deprecation" },
    { pattern: /rename/i, label: "Renamed" },
    { pattern: /move/i, label: "Moved" },
    { pattern: /test/i, label: "Tests added" },
  ];

  for (const log of logs) {
    if (log === oldest) continue;
    for (const { pattern, label } of milestoneKeywords) {
      if (pattern.test(log.subject)) {
        milestones.push({ log, reason: label });
        break;
      }
    }
  }

  // Most recent commit (if different from creation)
  if (logs.length > 1) {
    const newest = logs[0];
    const alreadyIncluded = milestones.some((m) => m.log.hash === newest.hash);
    if (!alreadyIncluded) {
      milestones.push({ log: newest, reason: "Latest change" });
    }
  }

  // Sort chronologically (oldest first) and limit
  milestones.sort(
    (a, b) => new Date(a.log.date).getTime() - new Date(b.log.date).getTime(),
  );
  return milestones.slice(0, limit);
}

export async function journey(
  target: string,
  opts: JourneyOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const relativePath = path.relative(repoRoot, path.resolve(cwd, target));
  const displayPath = relativePath || ".";

  console.log(
    chalk.bold.cyan(`\n  Pathfinder — journey of `) +
      chalk.bold.white(displayPath),
  );
  console.log(divider());

  const logs = await getLog(relativePath || ".", {
    maxCount: 2000,
    since: opts.from,
    cwd: repoRoot,
  });

  if (logs.length === 0) {
    console.log(chalk.dim("  No commit history found for this path."));
    console.log("");
    return;
  }

  // --- Origin ---
  console.log(header("Origin"));
  const firstCommit = logs[logs.length - 1];
  const lastCommit = logs[0];
  console.log(labelValue("Created", relativeTime(new Date(firstCommit.date))));
  console.log(labelValue("Created by", firstCommit.author));
  console.log(labelValue("First commit", firstCommit.subject));
  console.log(labelValue("Total commits", formatNumber(logs.length)));

  // --- Ownership Timeline ---
  console.log(header("Ownership Timeline"));
  const timeline = buildOwnershipTimeline(logs);
  console.log(
    chalk.dim("  Who maintained this over time:\n"),
  );

  for (let i = 0; i < timeline.length; i++) {
    const period = timeline[i];
    const isLast = i === timeline.length - 1;
    const connector = isLast ? "  └─" : "  ├─";
    const dateRange =
      period.startDate.getTime() === period.endDate.getTime()
        ? relativeTime(period.startDate)
        : `${relativeTime(period.startDate)} → ${relativeTime(period.endDate)}`;

    console.log(
      `${connector} ${chalk.bold.white(period.author)} ${chalk.dim(`(${period.commits} commit${period.commits > 1 ? "s" : ""}, ${dateRange})`)}`,
    );
  }

  // --- Handoff detection ---
  const uniqueAuthors = [...new Set(timeline.map((t) => t.author))];
  if (uniqueAuthors.length > 1) {
    console.log(
      chalk.dim(`\n  ${uniqueAuthors.length} different maintainers over the lifetime.`),
    );
    if (timeline.length > uniqueAuthors.length) {
      console.log(
        chalk.yellow("  ↻ Ownership has bounced between authors."),
      );
    }
  }

  // --- Milestones ---
  console.log(header("Milestones"));
  const milestones = findMilestones(logs, opts.limit);

  for (let i = 0; i < milestones.length; i++) {
    const { log, reason } = milestones[i];
    const date = relativeTime(new Date(log.date));
    const isLast = i === milestones.length - 1;
    const connector = isLast ? "  └─" : "  ├─";

    console.log(
      `${connector} ${chalk.cyan(reason)} ${chalk.dim("·")} ${chalk.white(log.subject)}`,
    );
    console.log(
      `  ${isLast ? " " : "│"}    ${chalk.dim(`${log.author} · ${date} · ${log.hash.slice(0, 8)}`)}`,
    );
  }

  // --- Current State ---
  console.log(header("Current State"));
  console.log(labelValue("Last modified", relativeTime(new Date(lastCommit.date))));
  console.log(labelValue("Last author", lastCommit.author));
  console.log(labelValue("Last change", lastCommit.subject));

  const daysSinceLastCommit = Math.floor(
    (Date.now() - new Date(lastCommit.date).getTime()) / (1000 * 60 * 60 * 24),
  );
  let status: string;
  if (daysSinceLastCommit < 7) status = chalk.green("● Actively maintained");
  else if (daysSinceLastCommit < 30) status = chalk.yellow("● Recently maintained");
  else if (daysSinceLastCommit < 180) status = chalk.red("● Aging");
  else status = chalk.dim("○ Dormant");
  console.log(labelValue("Status", status));

  console.log(divider());
  console.log("");
}
