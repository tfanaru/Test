import chalk from "chalk";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRepoRoot, listFiles } from "../utils/git.js";
import { header, divider, truncatePath } from "../utils/format.js";

const execFileAsync = promisify(execFile);

interface BridgeOptions {
  depth: number;
}

// Reuse the import extraction logic from trace
const IMPORT_PATTERNS: { ext: RegExp; pattern: RegExp }[] = [
  { ext: /\.[ch](pp|xx)?$/i, pattern: /^\s*#include\s+["<]([^">]+)[">]/gm },
  { ext: /\.cs$/i, pattern: /^\s*using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm },
  {
    ext: /\.[tj]sx?$/i,
    pattern: /(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]/gm,
  },
  { ext: /\.py$/i, pattern: /^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm },
  { ext: /\.go$/i, pattern: /^\s*"([^"]+)"/gm },
  { ext: /\.rs$/i, pattern: /^\s*use\s+([a-zA-Z0-9_:]+)/gm },
];

function extractImports(filePath: string, content: string): string[] {
  const imports: string[] = [];
  for (const { ext, pattern } of IMPORT_PATTERNS) {
    if (!ext.test(filePath)) continue;
    const re = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const value = match[1] ?? match[2];
      if (value) imports.push(value);
    }
  }
  return imports;
}

function resolveImport(
  importStr: string,
  sourceFile: string,
  allFiles: Set<string>,
): string | null {
  if (importStr.startsWith(".") || importStr.startsWith("/")) {
    const dir = path.dirname(sourceFile);
    const resolved = path.normalize(path.join(dir, importStr));
    const candidates = [
      resolved,
      ...["", ".ts", ".tsx", ".js", ".jsx", ".c", ".cpp", ".h", ".hpp", ".cs", ".py", ".go", ".rs"].map(
        (ext) => resolved + ext,
      ),
      path.join(resolved, "index.ts"),
      path.join(resolved, "index.js"),
    ];
    for (const c of candidates) {
      if (allFiles.has(c)) return c;
    }
  }
  if (importStr.endsWith(".h") || importStr.endsWith(".hpp")) {
    for (const f of allFiles) {
      if (f.endsWith("/" + importStr) || f === importStr) return f;
    }
  }
  return null;
}

/**
 * Build an adjacency list for files under the given paths.
 * This is scoped to avoid scanning the entire repo.
 */
async function buildLocalGraph(
  filesInScope: string[],
  allFilesSet: Set<string>,
  repoRoot: string,
): Promise<Map<string, Set<string>>> {
  const graph = new Map<string, Set<string>>();

  for (const file of filesInScope) {
    try {
      const { stdout } = await execFileAsync(
        "cat",
        [path.join(repoRoot, file)],
        { maxBuffer: 1024 * 1024 },
      );
      const imports = extractImports(file, stdout);
      const neighbors = new Set<string>();
      for (const imp of imports) {
        const resolved = resolveImport(imp, file, allFilesSet);
        if (resolved) neighbors.add(resolved);
      }
      graph.set(file, neighbors);
    } catch {
      graph.set(file, new Set());
    }
  }

  return graph;
}

/**
 * BFS to find shortest path between two sets of files.
 */
export function bfs(
  graph: Map<string, Set<string>>,
  startFiles: string[],
  targetFiles: Set<string>,
  maxDepth: number,
): string[] | null {
  const visited = new Set<string>();
  const parent = new Map<string, string | null>();

  const queue: { file: string; depth: number }[] = [];
  for (const f of startFiles) {
    queue.push({ file: f, depth: 0 });
    parent.set(f, null);
    visited.add(f);
  }

  while (queue.length > 0) {
    const { file, depth } = queue.shift()!;

    if (targetFiles.has(file)) {
      // Reconstruct path
      const result: string[] = [];
      let current: string | null = file;
      while (current !== null) {
        result.unshift(current);
        current = parent.get(current) ?? null;
      }
      return result;
    }

    if (depth >= maxDepth) continue;

    const neighbors = graph.get(file) ?? new Set<string>();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, file);
        queue.push({ file: neighbor, depth: depth + 1 });
      }
    }

    // Also check reverse edges (who imports this file)
    for (const [source, targets] of graph) {
      if (targets.has(file) && !visited.has(source)) {
        visited.add(source);
        parent.set(source, file);
        queue.push({ file: source, depth: depth + 1 });
      }
    }
  }

  return null;
}

export async function bridge(
  pathA: string,
  pathB: string,
  opts: BridgeOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const relA = path.relative(repoRoot, path.resolve(cwd, pathA));
  const relB = path.relative(repoRoot, path.resolve(cwd, pathB));

  console.log(
    chalk.bold.cyan(`\n  Pathfinder — bridging `) +
      chalk.bold.white(relA) +
      chalk.bold.cyan(` ↔ `) +
      chalk.bold.white(relB),
  );
  console.log(divider());

  const allFiles = await listFiles(".", { cwd: repoRoot });
  const allFilesSet = new Set(allFiles);

  // Gather files under both paths
  const filesA = allFiles.filter(
    (f) => f === relA || f.startsWith(relA + "/"),
  );
  const filesB = allFiles.filter(
    (f) => f === relB || f.startsWith(relB + "/"),
  );

  if (filesA.length === 0) {
    console.log(chalk.red(`  No files found under: ${relA}`));
    return;
  }
  if (filesB.length === 0) {
    console.log(chalk.red(`  No files found under: ${relB}`));
    return;
  }

  console.log(
    chalk.dim(
      `  Scanning ${filesA.length} files in ${relA} and ${filesB.length} files in ${relB}...`,
    ),
  );

  // Build a graph of the files in scope (both dirs + their immediate dependencies)
  const scopeFiles = [...new Set([...filesA, ...filesB])];
  const graph = await buildLocalGraph(scopeFiles, allFilesSet, repoRoot);

  // Also add reverse edges into the graph for files that import scope files
  // (look for files that bridge the two directories)
  const allScopeImports = new Set<string>();
  for (const [, targets] of graph) {
    for (const t of targets) {
      if (!graph.has(t)) allScopeImports.add(t);
    }
  }

  // Build graph for intermediate files too
  const intermediateFiles = [...allScopeImports].slice(0, 200); // limit for performance
  const intermediateGraph = await buildLocalGraph(
    intermediateFiles,
    allFilesSet,
    repoRoot,
  );
  for (const [file, neighbors] of intermediateGraph) {
    graph.set(file, neighbors);
  }

  // BFS from A to B
  const targetSet = new Set(filesB);
  const bridgePath = bfs(graph, filesA, targetSet, opts.depth);

  console.log(header("Connection Path"));

  if (bridgePath) {
    console.log("");
    for (let i = 0; i < bridgePath.length; i++) {
      const file = bridgePath[i];
      const isEndpoint =
        filesA.includes(file) || filesB.includes(file);
      const display = truncatePath(file, 65);

      if (i === 0) {
        console.log(`  ${chalk.green("●")} ${chalk.bold.white(display)}`);
      } else if (i === bridgePath.length - 1) {
        console.log(`  ${chalk.blue("●")} ${chalk.bold.white(display)}`);
      } else {
        console.log(
          `  ${chalk.dim("│")}`,
        );
        console.log(
          `  ${isEndpoint ? chalk.yellow("○") : chalk.dim("○")} ${isEndpoint ? chalk.white(display) : chalk.dim(display)}`,
        );
      }

      if (i < bridgePath.length - 1) {
        console.log(`  ${chalk.dim("│")}`);
      }
    }
    console.log("");
    console.log(
      chalk.dim(`  Path length: ${bridgePath.length - 1} hop${bridgePath.length > 2 ? "s" : ""}`),
    );
  } else {
    console.log(
      chalk.yellow(
        "\n  No direct dependency path found between these locations.",
      ),
    );
    console.log(
      chalk.dim(
        "  They may communicate through shared interfaces, runtime calls, or service boundaries.",
      ),
    );
    console.log(
      chalk.dim(
        `  (Searched up to depth ${opts.depth} — try increasing with --depth)`,
      ),
    );
  }

  console.log(divider());
  console.log("");
}
