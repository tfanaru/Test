import chalk from "chalk";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRepoRoot, listFiles } from "../utils/git.js";
import { header, divider, truncatePath } from "../utils/format.js";

const execFileAsync = promisify(execFile);

interface TraceOptions {
  depth: number;
  direction: "up" | "down" | "both";
  filter?: string;
}

// Patterns for #include, import, using, require across common languages
const IMPORT_PATTERNS: { ext: RegExp; pattern: RegExp }[] = [
  // C/C++ #include
  { ext: /\.[ch](pp|xx)?$/i, pattern: /^\s*#include\s+["<]([^">]+)[">]/gm },
  // C# using
  { ext: /\.cs$/i, pattern: /^\s*using\s+(?:static\s+)?([A-Za-z0-9_.]+)\s*;/gm },
  // TypeScript/JavaScript import
  {
    ext: /\.[tj]sx?$/i,
    pattern: /(?:import\s+.*?from\s+|require\s*\(\s*)['"]([^'"]+)['"]/gm,
  },
  // Python import
  {
    ext: /\.py$/i,
    pattern: /^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/gm,
  },
  // Go import
  { ext: /\.go$/i, pattern: /^\s*"([^"]+)"/gm },
  // Rust use
  { ext: /\.rs$/i, pattern: /^\s*use\s+([a-zA-Z0-9_:]+)/gm },
];

/**
 * Extract raw import strings from a file's content.
 */
export function extractImports(filePath: string, content: string): string[] {
  const imports: string[] = [];
  for (const { ext, pattern } of IMPORT_PATTERNS) {
    if (!ext.test(filePath)) continue;
    let match: RegExpExecArray | null;
    // Reset lastIndex since we reuse the regex
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(content)) !== null) {
      // Take the first non-undefined capturing group
      const value = match[1] ?? match[2];
      if (value) imports.push(value);
    }
  }
  return imports;
}

/**
 * Resolve an import string to a file path in the repo if possible.
 */
export function resolveImport(
  importStr: string,
  sourceFile: string,
  allFiles: Set<string>,
): string | null {
  // Try direct path resolution for relative imports
  if (importStr.startsWith(".") || importStr.startsWith("/")) {
    const dir = path.dirname(sourceFile);
    const resolved = path.normalize(path.join(dir, importStr));
    // Try with and without common extensions
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

  // For C/C++ includes — search for the header name anywhere
  if (importStr.endsWith(".h") || importStr.endsWith(".hpp")) {
    for (const f of allFiles) {
      if (f.endsWith("/" + importStr) || f === importStr) return f;
    }
  }

  return null;
}

interface TreeNode {
  path: string;
  children: TreeNode[];
}

async function buildTree(
  targetFile: string,
  allFilesSet: Set<string>,
  direction: "down" | "up",
  depth: number,
  cwd: string,
  filter?: string,
  visited: Set<string> = new Set(),
): Promise<TreeNode> {
  const node: TreeNode = { path: targetFile, children: [] };

  if (depth <= 0 || visited.has(targetFile)) return node;
  visited.add(targetFile);

  if (direction === "down") {
    // What does this file depend on?
    try {
      const { stdout } = await execFileAsync(
        "cat",
        [path.join(cwd, targetFile)],
        { maxBuffer: 1024 * 1024 },
      );
      const imports = extractImports(targetFile, stdout);
      for (const imp of imports) {
        const resolved = resolveImport(imp, targetFile, allFilesSet);
        if (!resolved) continue;
        if (filter && !resolved.includes(filter)) continue;
        const child = await buildTree(
          resolved,
          allFilesSet,
          direction,
          depth - 1,
          cwd,
          filter,
          visited,
        );
        node.children.push(child);
      }
    } catch {
      // File might not exist in working tree
    }
  } else {
    // "up" — who depends on this file?
    // This requires scanning all files — expensive. We do a git grep for speed.
    const basename = path.basename(targetFile);
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["grep", "-l", basename, "--"],
        { cwd, maxBuffer: 1024 * 1024 * 10 },
      );
      const candidates = stdout.trim().split("\n").filter(Boolean);
      for (const candidate of candidates) {
        if (candidate === targetFile) continue;
        if (!allFilesSet.has(candidate)) continue;
        if (filter && !candidate.includes(filter)) continue;

        // Verify that this file actually imports the target
        try {
          const { stdout: content } = await execFileAsync(
            "cat",
            [path.join(cwd, candidate)],
            { maxBuffer: 1024 * 1024 },
          );
          const imports = extractImports(candidate, content);
          const resolved = imports
            .map((imp) => resolveImport(imp, candidate, allFilesSet))
            .filter(Boolean);
          if (resolved.includes(targetFile)) {
            const child = await buildTree(
              candidate,
              allFilesSet,
              direction,
              depth - 1,
              cwd,
              filter,
              visited,
            );
            node.children.push(child);
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // git grep failed — no results
    }
  }

  return node;
}

function printTree(
  node: TreeNode,
  prefix: string = "",
  isLast: boolean = true,
  isRoot: boolean = true,
): void {
  const connector = isRoot ? "  " : isLast ? "  └─ " : "  ├─ ";
  const display = truncatePath(node.path, 70);

  if (isRoot) {
    console.log(`  ${chalk.bold.white(display)}`);
  } else {
    console.log(
      `${prefix}${connector}${node.children.length > 0 ? chalk.white(display) : chalk.dim(display)}`,
    );
  }

  const childPrefix = prefix + (isRoot ? "" : isLast ? "     " : "  │  ");
  for (let i = 0; i < node.children.length; i++) {
    printTree(
      node.children[i],
      childPrefix,
      i === node.children.length - 1,
      false,
    );
  }
}

export async function trace(
  target: string,
  opts: TraceOptions,
): Promise<void> {
  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const relativePath = path.relative(repoRoot, path.resolve(cwd, target));

  console.log(
    chalk.bold.cyan(`\n  Pathfinder — tracing `) +
      chalk.bold.white(relativePath),
  );
  console.log(divider());

  const allFiles = await listFiles(".", { cwd: repoRoot });
  const allFilesSet = new Set(allFiles);

  if (!allFilesSet.has(relativePath)) {
    console.log(chalk.red(`  File not found in repo: ${relativePath}`));
    console.log(
      chalk.dim("  Make sure you're pointing at a tracked file."),
    );
    return;
  }

  const directions: ("down" | "up")[] =
    opts.direction === "both"
      ? ["down", "up"]
      : [opts.direction];

  for (const dir of directions) {
    const label = dir === "down" ? "Dependencies (what this file uses)" : "Dependents (what uses this file)";
    console.log(header(label));
    console.log("");

    const tree = await buildTree(
      relativePath,
      allFilesSet,
      dir,
      opts.depth,
      repoRoot,
      opts.filter,
    );

    if (tree.children.length === 0) {
      console.log(chalk.dim(`  No ${dir === "down" ? "dependencies" : "dependents"} found.`));
    } else {
      printTree(tree);
    }
    console.log("");
  }

  console.log(divider());
  console.log(
    chalk.dim(`  Depth: ${opts.depth} · Direction: ${opts.direction}${opts.filter ? ` · Filter: ${opts.filter}` : ""}`),
  );
  console.log("");
}
