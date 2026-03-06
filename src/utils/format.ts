import chalk from "chalk";

/**
 * Format a section header.
 */
export function header(text: string): string {
  return chalk.bold.cyan(`\n  ${text}`);
}

/**
 * Format a sub-header.
 */
export function subheader(text: string): string {
  return chalk.bold(`  ${text}`);
}

/**
 * Format a labeled value.
 */
export function labelValue(label: string, value: string | number): string {
  return `  ${chalk.dim(label + ":")} ${value}`;
}

/**
 * Format a list item with a rank/bullet.
 */
export function listItem(
  index: number,
  text: string,
  detail?: string,
): string {
  const num = chalk.dim(`  ${(index + 1).toString().padStart(2)}. `);
  const main = text;
  const extra = detail ? chalk.dim(` — ${detail}`) : "";
  return `${num}${main}${extra}`;
}

/**
 * Format a bar chart inline.
 */
export function bar(value: number, max: number, width: number = 20): string {
  const filled = Math.round((value / max) * width);
  return chalk.cyan("█".repeat(filled)) + chalk.dim("░".repeat(width - filled));
}

/**
 * Format a relative time string.
 */
export function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months > 1 ? "s" : ""} ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

/**
 * Format a number with commas.
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/**
 * Print a divider line.
 */
export function divider(): string {
  return chalk.dim("  " + "─".repeat(60));
}

/**
 * Truncate a path for display, keeping the meaningful parts.
 */
export function truncatePath(path: string, maxLen: number = 60): string {
  if (path.length <= maxLen) return path;
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return parts[0] + "/.../" + parts.slice(-2).join("/");
}
