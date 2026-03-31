/**
 * Shared status icon and color mappings.
 * Used by schemaScmProvider, branchTreeProvider, pullRequestTree, changesTreeProvider.
 */

/** Maps file/schema status to VS Code codicon names */
export const STATUS_ICONS: Record<string, string> = {
  added: 'diff-added',
  modified: 'diff-modified',
  deleted: 'diff-removed',
  renamed: 'diff-renamed',
  created: 'diff-added',
  removed: 'diff-removed',
};

/** Maps file/schema status to VS Code ThemeColor identifiers */
export const STATUS_COLORS: Record<string, string> = {
  added: 'charts.green',
  modified: 'charts.yellow',
  deleted: 'charts.red',
  renamed: 'charts.blue',
  created: 'charts.green',
  removed: 'charts.red',
};

/** Check if a branch name is the main/default branch */
export function isMainBranch(name: string): boolean {
  return name === 'main' || name === 'master';
}
