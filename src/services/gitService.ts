import * as vscode from 'vscode';
import * as cp from 'child_process';
import { getWorkspaceRoot } from '../utils/config';

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  ciStatus: 'pending' | 'success' | 'failure' | 'unknown';
  ciConclusion?: string;
  headBranch: string;
  baseBranch: string;
  body?: string;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  tracking?: string;
  ahead?: number;
  behind?: number;
}

export interface GitFileChange {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  path: string;
  oldPath?: string;
}

function exec(command: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cp.exec(command, { cwd, timeout: 10000 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export class GitService {
  private _onBranchChanged = new vscode.EventEmitter<string>();
  readonly onBranchChanged = this._onBranchChanged.event;

  private currentBranch: string = '';
  private watcher: vscode.FileSystemWatcher | undefined;
  private pollInterval: NodeJS.Timeout | undefined;

  async initialize(): Promise<void> {
    this.currentBranch = await this.getCurrentBranch();

    // Watch .git/HEAD for branch changes
    const root = getWorkspaceRoot();
    if (root) {
      const headPattern = new vscode.RelativePattern(root, '.git/HEAD');
      this.watcher = vscode.workspace.createFileSystemWatcher(headPattern);
      this.watcher.onDidChange(() => this.checkBranchChange());
      this.watcher.onDidCreate(() => this.checkBranchChange());
    }

    // Poll as a fallback (some git operations don't trigger file watchers)
    this.pollInterval = setInterval(() => this.checkBranchChange(), 5000);
  }

  private async checkBranchChange(): Promise<void> {
    try {
      const branch = await this.getCurrentBranch();
      if (branch !== this.currentBranch && branch) {
        const previous = this.currentBranch;
        this.currentBranch = branch;
        this._onBranchChanged.fire(branch);
      }
    } catch {
      // Git not available or not in a repo
    }
  }

  async getCurrentBranch(): Promise<string> {
    const root = getWorkspaceRoot();
    if (!root) {
      return '';
    }
    try {
      return await exec('git rev-parse --abbrev-ref HEAD', root);
    } catch {
      return '';
    }
  }

  async listLocalBranches(): Promise<GitBranchInfo[]> {
    const root = getWorkspaceRoot();
    if (!root) {
      return [];
    }

    const current = await this.getCurrentBranch();
    const raw = await exec('git branch --format="%(refname:short)|%(upstream:short)|%(upstream:track)"', root);

    if (!raw) {
      return [];
    }

    return raw.split('\n').filter(Boolean).map(line => {
      const [name, tracking, trackInfo] = line.split('|');
      let ahead = 0;
      let behind = 0;

      if (trackInfo) {
        const aheadMatch = trackInfo.match(/ahead (\d+)/);
        const behindMatch = trackInfo.match(/behind (\d+)/);
        if (aheadMatch) {ahead = parseInt(aheadMatch[1], 10);}
        if (behindMatch) {behind = parseInt(behindMatch[1], 10);}
      }

      return {
        name,
        isCurrent: name === current,
        isRemote: false,
        tracking: tracking || undefined,
        ahead,
        behind,
      };
    });
  }

  /** List remote branches (excluding those already checked out locally) */
  async listRemoteBranches(): Promise<GitBranchInfo[]> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }

    try {
      const localBranches = await this.listLocalBranches();
      const localNames = new Set(localBranches.map(b => b.name));

      const raw = await exec('git branch -r --format="%(refname:short)"', root);
      if (!raw) { return []; }

      return raw.split('\n').filter(Boolean)
        .filter(name => !name.includes('HEAD'))
        .map(name => {
          // Remote branch names are like "origin/feature-x"
          const shortName = name.replace(/^origin\//, '');
          return { name, shortName };
        })
        .filter(({ shortName }) => !localNames.has(shortName))
        .map(({ name, shortName }) => ({
          name: shortName,
          isCurrent: false,
          isRemote: true,
          tracking: name,
        }));
    } catch {
      return [];
    }
  }

  /** Get file contents at a given git ref (e.g. 'main', a commit sha) */
  async getFileAtRef(ref: string, filePath: string): Promise<string> {
    const root = getWorkspaceRoot();
    if (!root) { return ''; }
    try {
      return await exec(`git show "${ref}:${filePath}"`, root);
    } catch {
      return ''; // File doesn't exist at that ref (new file)
    }
  }

  /** Get the merge-base commit between HEAD and main/master */
  async getMergeBase(): Promise<string> {
    const root = getWorkspaceRoot();
    if (!root) { return ''; }
    let baseBranch = 'main';
    try {
      await exec('git rev-parse --verify main', root);
    } catch {
      try {
        await exec('git rev-parse --verify master', root);
        baseBranch = 'master';
      } catch {
        return '';
      }
    }
    try {
      return await exec(`git merge-base ${baseBranch} HEAD`, root);
    } catch {
      return '';
    }
  }

  async checkoutBranch(branchName: string, create: boolean = false): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) {
      throw new Error('No workspace root');
    }
    const flag = create ? '-b ' : '';
    await exec(`git checkout ${flag}"${branchName}"`, root);
  }

  /** Get files changed between current branch and main/master */
  async getChangedFiles(): Promise<GitFileChange[]> {
    const root = getWorkspaceRoot();
    if (!root) {
      return [];
    }

    // Find the base branch (main or master)
    let baseBranch = 'main';
    try {
      await exec('git rev-parse --verify main', root);
    } catch {
      try {
        await exec('git rev-parse --verify master', root);
        baseBranch = 'master';
      } catch {
        return [];
      }
    }

    try {
      const mergeBase = await exec(`git merge-base ${baseBranch} HEAD`, root);
      const raw = await exec(`git diff --name-status ${mergeBase}`, root);

      const statusMap: Record<string, GitFileChange['status']> = {
        'A': 'added', 'M': 'modified', 'D': 'deleted',
      };

      const changes: GitFileChange[] = raw
        ? raw.split('\n').filter(Boolean).map(line => {
            const parts = line.split('\t');
            const code = parts[0][0];
            if (code === 'R') {
              return { status: 'renamed' as const, path: parts[2], oldPath: parts[1] };
            }
            return { status: statusMap[code] || 'modified', path: parts[1] };
          })
        : [];

      // Also include untracked files (new files not yet staged)
      try {
        const untracked = await exec('git ls-files --others --exclude-standard', root);
        if (untracked) {
          const trackedPaths = new Set(changes.map(c => c.path));
          for (const filePath of untracked.split('\n').filter(Boolean)) {
            if (!trackedPaths.has(filePath)) {
              changes.push({ status: 'added', path: filePath });
            }
          }
        }
      } catch {
        // Ignore — untracked listing is optional
      }

      return changes;
    } catch {
      return [];
    }
  }

  /** List V*.sql migration filenames on a given branch (without checking it out) */
  async listMigrationsOnBranch(branchName: string, migrationPath: string): Promise<string[]> {
    const root = getWorkspaceRoot();
    if (!root) {
      return [];
    }
    try {
      const raw = await exec(
        `git ls-tree --name-only "${branchName}" -- "${migrationPath}/"`,
        root
      );
      if (!raw) {
        return [];
      }
      return raw.split('\n')
        .map(f => f.split('/').pop() || f)
        .filter(f => /^V\d+.*\.sql$/i.test(f))
        .sort();
    } catch {
      return [];
    }
  }

  /** Get currently staged files */
  async getStagedFiles(): Promise<string[]> {
    const root = getWorkspaceRoot();
    if (!root) {
      return [];
    }
    try {
      const raw = await exec('git diff --cached --name-only', root);
      return raw ? raw.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  /** Get staged files with their change status */
  async getStagedChanges(): Promise<GitFileChange[]> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }
    try {
      const raw = await exec('git diff --cached --name-status', root);
      if (!raw) { return []; }
      const statusMap: Record<string, GitFileChange['status']> = {
        'A': 'added', 'M': 'modified', 'D': 'deleted',
      };
      return raw.split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        const code = parts[0][0];
        if (code === 'R') {
          return { status: 'renamed' as const, path: parts[2], oldPath: parts[1] };
        }
        return { status: statusMap[code] || 'modified', path: parts[1] };
      });
    } catch {
      return [];
    }
  }

  /** Get unstaged changes (modified/deleted tracked files + untracked files) */
  async getUnstagedChanges(): Promise<GitFileChange[]> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }
    try {
      const changes: GitFileChange[] = [];
      const statusMap: Record<string, GitFileChange['status']> = {
        'M': 'modified', 'D': 'deleted',
      };

      // Modified/deleted tracked files not yet staged
      const raw = await exec('git diff --name-status', root);
      if (raw) {
        for (const line of raw.split('\n').filter(Boolean)) {
          const parts = line.split('\t');
          const code = parts[0][0];
          changes.push({ status: statusMap[code] || 'modified', path: parts[1] });
        }
      }

      // Untracked files
      try {
        const untracked = await exec('git ls-files --others --exclude-standard', root);
        if (untracked) {
          for (const filePath of untracked.split('\n').filter(Boolean)) {
            changes.push({ status: 'added', path: filePath });
          }
        }
      } catch { /* ignore */ }

      return changes;
    } catch {
      return [];
    }
  }

  async stageFile(filePath: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git add "${filePath}"`, root);
  }

  async unstageFile(filePath: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git reset HEAD "${filePath}"`, root);
  }

  async discardFile(filePath: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    // Check if file is untracked
    try {
      await exec(`git ls-files --error-unmatch "${filePath}"`, root);
      // Tracked file — restore from HEAD
      await exec(`git checkout -- "${filePath}"`, root);
    } catch {
      // Untracked file — delete it
      const fs = require('fs');
      const path = require('path');
      const fullPath = path.join(root, filePath);
      if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); }
    }
  }

  async commit(message: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    if (!message.trim()) { throw new Error('Commit message is required'); }
    await exec(`git commit -m "${message.replace(/"/g, '\\"')}"`, root);
  }

  /** Check if current branch has a remote upstream */
  async hasUpstream(): Promise<boolean> {
    const root = getWorkspaceRoot();
    if (!root) { return false; }
    try {
      await exec('git rev-parse --abbrev-ref @{u}', root);
      return true;
    } catch {
      return false;
    }
  }

  /** Get ahead/behind counts relative to upstream */
  async getAheadBehind(): Promise<{ ahead: number; behind: number; upstream: string }> {
    const root = getWorkspaceRoot();
    if (!root) { return { ahead: 0, behind: 0, upstream: '' }; }
    try {
      const upstream = (await exec('git rev-parse --abbrev-ref @{u}', root)).trim();
      const raw = await exec(`git rev-list --left-right --count HEAD...@{u}`, root);
      const parts = raw.trim().split(/\s+/);
      return {
        ahead: parseInt(parts[0], 10) || 0,
        behind: parseInt(parts[1], 10) || 0,
        upstream,
      };
    } catch {
      return { ahead: 0, behind: 0, upstream: '' };
    }
  }

  async push(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git push', root);
  }

  /** Push local branch to remote for the first time */
  async publishBranch(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    const branch = await this.getCurrentBranch();
    if (!branch) { throw new Error('No current branch'); }
    await exec(`git push -u origin "${branch}"`, root);
  }

  async pull(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git pull', root);
  }

  /** Create a pull request via gh CLI. Returns the PR URL. */
  async createPullRequest(title: string, body: string): Promise<string> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    // Ensure branch is pushed
    const hasRemote = await this.hasUpstream();
    if (!hasRemote) {
      await this.publishBranch();
    }
    const result = await exec(
      `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`,
      root
    );
    // gh pr create outputs the PR URL
    const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/);
    return urlMatch ? urlMatch[0] : result.trim();
  }

  async commitAll(message: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    if (!message.trim()) { throw new Error('Commit message is required'); }
    await exec('git add -A', root);
    await exec(`git commit -m "${message.replace(/"/g, '\\"')}"`, root);
  }

  async commitAmend(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git commit --amend --no-edit', root);
  }

  async commitAmendMessage(message: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    if (!message.trim()) { throw new Error('Commit message is required'); }
    await exec(`git commit --amend -m "${message.replace(/"/g, '\\"')}"`, root);
  }

  async undoLastCommit(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git reset --soft HEAD~1', root);
  }

  async discardAllChanges(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git checkout -- .', root);
    await exec('git clean -fd', root);
  }

  async deleteBranch(branchName: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git branch -d "${branchName}"`, root);
  }

  async renameBranch(newName: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git branch -m "${newName}"`, root);
  }

  async mergeBranch(branchName: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git merge "${branchName}"`, root);
  }

  async createTag(name: string, message?: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    const msg = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
    await exec(`git tag${msg ? ' -a' : ''} "${name}"${msg}`, root);
  }

  async deleteTag(name: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git tag -d "${name}"`, root);
  }

  async deleteRemoteTag(name: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git push origin --delete "refs/tags/${name}"`, root);
  }

  async commitSignedOff(message: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    if (!message.trim()) { throw new Error('Commit message is required'); }
    await exec(`git commit -s -m "${message.replace(/"/g, '\\"')}"`, root);
  }

  async commitAllSignedOff(message: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    if (!message.trim()) { throw new Error('Commit message is required'); }
    await exec('git add -A', root);
    await exec(`git commit -s -m "${message.replace(/"/g, '\\"')}"`, root);
  }

  async stashStaged(message?: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    const msg = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
    await exec(`git stash push --staged${msg}`, root);
  }

  async stashIncludeUntracked(message?: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    const msg = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
    await exec(`git stash push --include-untracked${msg}`, root);
  }

  async stashList(): Promise<string[]> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }
    try {
      const raw = await exec('git stash list', root);
      return raw ? raw.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async stashApply(index: number = 0): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git stash apply stash@{${index}}`, root);
  }

  async stashDrop(index: number = 0): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git stash drop stash@{${index}}`, root);
  }

  async stashDropAll(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git stash clear', root);
  }

  async listTags(): Promise<string[]> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }
    try {
      const raw = await exec('git tag -l', root);
      return raw ? raw.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async abortRebase(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git rebase --abort', root);
  }

  async isRebasing(): Promise<boolean> {
    const root = getWorkspaceRoot();
    if (!root) { return false; }
    const fs = require('fs');
    const path = require('path');
    return fs.existsSync(path.join(root, '.git/rebase-merge')) ||
           fs.existsSync(path.join(root, '.git/rebase-apply'));
  }

  async rebaseBranch(branchName: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git rebase "${branchName}"`, root);
  }

  async deleteRemoteBranch(branchName: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git push origin --delete "${branchName}"`, root);
  }

  async addRemote(name: string, url: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git remote add "${name}" "${url}"`, root);
  }

  async removeRemote(name: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git remote remove "${name}"`, root);
  }

  async createWorktree(path: string, branchName: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git worktree add "${path}" -b "${branchName}"`, root);
  }

  async listWorktrees(): Promise<string[]> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }
    try {
      const raw = await exec('git worktree list', root);
      return raw ? raw.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async removeWorktree(path: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git worktree remove "${path}"`, root);
  }

  async fetch(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git fetch', root);
  }

  async fetchPrune(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git fetch --prune', root);
  }

  async fetchAll(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git fetch --all', root);
  }

  async pullRebase(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git pull --rebase', root);
  }

  async pullFrom(remote: string, branch: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git pull "${remote}" "${branch}"`, root);
  }

  async pushTo(remote: string, branch: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec(`git push "${remote}" "${branch}"`, root);
  }

  async listRemotes(): Promise<string[]> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }
    try {
      const raw = await exec('git remote', root);
      return raw ? raw.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async stash(message?: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    const msg = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
    await exec(`git stash push${msg}`, root);
  }

  async stashPop(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git stash pop', root);
  }

  /** Pull then push */
  async sync(): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    await exec('git pull', root);
    await exec('git push', root);
  }

  /** Get PR info for the current branch via gh CLI */
  async getPullRequest(): Promise<PullRequestInfo | undefined> {
    const root = getWorkspaceRoot();
    if (!root) { return undefined; }
    try {
      const raw = await exec(
        'gh pr view --json number,title,url,state,headRefName,baseRefName,body,statusCheckRollup',
        root
      );
      const pr = JSON.parse(raw);

      // Only return open PRs
      if (pr.state && pr.state !== 'OPEN') { return undefined; }

      // Parse CI status from statusCheckRollup
      let ciStatus: PullRequestInfo['ciStatus'] = 'unknown';
      const checks = pr.statusCheckRollup || [];
      if (checks.length === 0) {
        ciStatus = 'pending';
      } else {
        const states = checks.map((c: any) => (c.conclusion || c.status || '').toUpperCase());
        if (states.some((s: string) => s === 'FAILURE' || s === 'ERROR' || s === 'ACTION_REQUIRED')) {
          ciStatus = 'failure';
        } else if (states.every((s: string) => s === 'SUCCESS' || s === 'NEUTRAL' || s === 'SKIPPED')) {
          ciStatus = 'success';
        } else {
          ciStatus = 'pending';
        }
      }

      return {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        ciStatus,
        headBranch: pr.headRefName,
        baseBranch: pr.baseRefName,
        body: pr.body,
      };
    } catch {
      return undefined;
    }
  }

  /** Get PR comments (for finding CI schema diff comment) */
  async getPullRequestComments(): Promise<Array<{ author: string; body: string }>> {
    const root = getWorkspaceRoot();
    if (!root) { return []; }
    try {
      const raw = await exec('gh pr view --json comments', root);
      const data = JSON.parse(raw);
      return (data.comments || []).map((c: any) => ({
        author: c.author?.login || 'unknown',
        body: c.body || '',
      }));
    } catch {
      return [];
    }
  }

  /** Merge the current branch's PR via gh CLI. Returns the merge URL. */
  async mergePullRequest(method: 'merge' | 'squash' | 'rebase' = 'merge', deleteRemoteBranch: boolean = true): Promise<string> {
    const root = getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root'); }
    const deleteFlag = deleteRemoteBranch ? ' --delete-branch' : '';
    const result = await exec(`gh pr merge --${method}${deleteFlag}`, root);
    return result.trim();
  }

  getCachedBranch(): string {
    return this.currentBranch;
  }

  dispose(): void {
    this.watcher?.dispose();
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this._onBranchChanged.dispose();
  }
}
