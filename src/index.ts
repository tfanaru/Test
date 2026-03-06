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

// --- explore ---
program
  .command("explore <directory>")
  .description(
    "Get a quick lay of the land for an unfamiliar part of the repo",
  )
  .option("-n, --limit <number>", "Number of items to show per section", "10")
  .option("--since <date>", "Only consider commits since this date (e.g. '6 months ago')")
  .action(async (directory: string, opts: { limit: string; since?: string }) => {
    await requireGitRepo();
    await explore(directory, {
      limit: parseInt(opts.limit, 10),
      since: opts.since,
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
  .action(async (targetPath: string, opts: { limit: string; since?: string }) => {
    await requireGitRepo();
    await who(targetPath, {
      limit: parseInt(opts.limit, 10),
      since: opts.since,
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
  .action(
    async (
      file: string,
      opts: { depth: string; direction: string; filter?: string },
    ) => {
      await requireGitRepo();
      await trace(file, {
        depth: parseInt(opts.depth, 10),
        direction: opts.direction as "up" | "down" | "both",
        filter: opts.filter,
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
  .action(async (pathA: string, pathB: string, opts: { depth: string }) => {
    await requireGitRepo();
    await bridge(pathA, pathB, {
      depth: parseInt(opts.depth, 10),
    });
  });

program.parse();
