#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { isGitRepo } from "./utils/git.js";
import { explore } from "./commands/explore.js";
import { who } from "./commands/who.js";
import { trace } from "./commands/trace.js";
import { bridge } from "./commands/bridge.js";

const program = new Command();

program
  .name("pathfinder")
  .description(
    "A CLI tool for exploring and understanding large codebases.\n\n" +
      "You know your corner of the codebase. Pathfinder helps you explore\n" +
      "outward from what you know — tracing connections, understanding\n" +
      "history, and figuring out who to talk to.",
  )
  .version("0.1.0");

// Shared pre-check: must be in a git repo
async function requireGitRepo(): Promise<void> {
  if (!(await isGitRepo(process.cwd()))) {
    console.error(
      chalk.red("\n  Error: Not inside a git repository."),
    );
    console.error(
      chalk.dim("  Pathfinder needs git history to work. cd into a repo and try again.\n"),
    );
    process.exit(1);
  }
}

function parsePositiveInt(value: string, name: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) {
    console.error(chalk.red(`\n  Error: --${name} must be a positive integer, got "${value}"\n`));
    process.exit(1);
  }
  return n;
}

function validateDirection(dir: string): "up" | "down" | "both" {
  if (dir !== "up" && dir !== "down" && dir !== "both") {
    console.error(chalk.red(`\n  Error: --direction must be "up", "down", or "both", got "${dir}"\n`));
    process.exit(1);
  }
  return dir;
}

// --- explore ---
program
  .command("explore <directory>")
  .description(
    "Get a quick lay of the land for an unfamiliar part of the repo",
  )
  .option("-n, --limit <number>", "Number of items to show per section", "10")
  .option("--since <date>", "Only consider commits since this date (e.g. '6 months ago')")
  .option("--json", "Output results as JSON")
  .action(async (directory: string, opts: { limit: string; since?: string; json?: boolean }) => {
    await requireGitRepo();
    await explore(directory, {
      limit: parsePositiveInt(opts.limit, "limit"),
      since: opts.since,
      json: opts.json ?? false,
    });
  });

// --- who ---
program
  .command("who <path>")
  .description(
    "Find out who knows a file or directory best, ranked by expertise",
  )
  .option("-n, --limit <number>", "Number of experts to show", "10")
  .option("--since <date>", "Only consider commits since this date")
  .option("--json", "Output results as JSON")
  .action(async (targetPath: string, opts: { limit: string; since?: string; json?: boolean }) => {
    await requireGitRepo();
    await who(targetPath, {
      limit: parsePositiveInt(opts.limit, "limit"),
      since: opts.since,
      json: opts.json ?? false,
    });
  });

// --- trace ---
program
  .command("trace <file>")
  .description(
    "Trace what a file depends on and what depends on it",
  )
  .option("-d, --depth <number>", "How deep to trace the dependency graph", "3")
  .option(
    "--direction <dir>",
    "Direction: 'up' (who uses me), 'down' (what I use), 'both'",
    "both",
  )
  .option("--filter <pattern>", "Only show dependencies matching this pattern")
  .option("--json", "Output results as JSON")
  .action(
    async (
      file: string,
      opts: { depth: string; direction: string; filter?: string; json?: boolean },
    ) => {
      await requireGitRepo();
      await trace(file, {
        depth: parsePositiveInt(opts.depth, "depth"),
        direction: validateDirection(opts.direction),
        filter: opts.filter,
        json: opts.json ?? false,
      });
    },
  );

// --- bridge ---
program
  .command("bridge <path-a> <path-b>")
  .description(
    "Find how two parts of the codebase connect to each other",
  )
  .option("-d, --depth <number>", "Max search depth for connections", "5")
  .option("--json", "Output results as JSON")
  .action(async (pathA: string, pathB: string, opts: { depth: string; json?: boolean }) => {
    await requireGitRepo();
    await bridge(pathA, pathB, {
      depth: parsePositiveInt(opts.depth, "depth"),
      json: opts.json ?? false,
    });
  });

program.parse();
