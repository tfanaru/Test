# Pathfinder

A CLI tool for exploring and understanding large codebases. You know your corner of the codebase — Pathfinder helps you explore outward from what you know.

## Install

```bash
npm install
npm run build
```

To make it available globally:

```bash
npm link
```

## Commands

### `pathfinder explore <directory>`

Get a quick lay of the land for an unfamiliar part of the repo. Shows file counts, language breakdown, activity health, most changed files, top contributors, and likely entry points.

```bash
pathfinder explore src/
pathfinder explore src/api --limit 5
pathfinder explore . --since "6 months ago"
```

### `pathfinder who <path>`

Find out who knows a file or directory best, ranked by an expertise score based on recency, commit volume, and breadth of changes.

```bash
pathfinder who src/utils/
pathfinder who src/core/engine.ts --limit 3
```

### `pathfinder trace <file>`

Trace what a file depends on and what depends on it. Supports multiple languages (TypeScript, JavaScript, Python, Go, Rust, C/C++, C#).

```bash
pathfinder trace src/core/engine.ts
pathfinder trace src/index.ts --direction down --depth 5
pathfinder trace src/utils/logger.ts --direction up
pathfinder trace src/core/engine.ts --filter utils
```

Options:
- `--direction <up|down|both>` — `down` = what this file imports, `up` = what imports this file (default: `both`)
- `--depth <n>` — how deep to trace the graph (default: `3`)
- `--filter <pattern>` — only show paths matching this string

### `pathfinder bridge <path-a> <path-b>`

Find how two parts of the codebase connect to each other via import/dependency chains.

```bash
pathfinder bridge src/api src/database
pathfinder bridge src/frontend src/backend --depth 10
```

## JSON Output

All commands support `--json` for machine-readable output, useful for scripting and piping into other tools.

```bash
pathfinder explore src/ --json
pathfinder who src/utils/ --json | jq '.experts[0].name'
pathfinder trace src/index.ts --json
pathfinder bridge src/api src/core --json
```

Example JSON output for `explore`:

```json
{
  "path": "src",
  "overview": {
    "totalFiles": 12,
    "languages": [
      { "language": "TypeScript", "files": 10, "percentage": 83 }
    ]
  },
  "activity": {
    "lastCommit": "2025-06-15T10:00:00+00:00",
    "commitsAnalyzed": 45,
    "health": "active"
  },
  "mostChangedFiles": [
    { "path": "src/core/engine.ts", "commits": 15, "authors": 3 }
  ],
  "topContributors": [
    { "name": "Alice", "email": "alice@example.com", "commits": 25, "filesChanged": 8 }
  ],
  "entryPoints": [
    { "file": "src/index.ts", "importedBy": 5 }
  ]
}
```

## Common Options

| Option | Commands | Description |
|--------|----------|-------------|
| `--limit <n>` | explore, who | Number of items to show (default: 10) |
| `--since <date>` | explore, who | Only consider commits since this date |
| `--depth <n>` | trace, bridge | Graph traversal depth (default: 3/5) |
| `--json` | all | Output as JSON |

## Development

```bash
npm install
npm run build    # compile TypeScript
npm run dev      # watch mode
npm test         # run tests
npm run lint     # type-check without emitting
```

## Requirements

- Node.js 18+
- Git (must be run inside a git repository)
