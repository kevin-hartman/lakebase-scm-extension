import * as vscode from 'vscode';
import { GitService, GitBranchInfo } from '../services/gitService';
import { LakebaseService, LakebaseBranch } from '../services/lakebaseService';
import { FlywayService } from '../services/flywayService';
import { getConfig } from '../utils/config';

export class BranchItem extends vscode.TreeItem {
  constructor(
    public readonly gitBranch: GitBranchInfo | undefined,
    public readonly lakebaseBranch: LakebaseBranch | undefined,
    public readonly itemType: 'branch' | 'currentBranch' | 'detail' | 'migration',
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
  }
}

export class BranchTreeProvider implements vscode.TreeDataProvider<BranchItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BranchItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private gitService: GitService;
  private lakebaseService: LakebaseService;
  private flywayService: FlywayService;
  private cachedData: BranchItem[] = [];
  private _suppressRefresh = false;

  constructor(
    gitService: GitService,
    lakebaseService: LakebaseService,
    flywayService: FlywayService
  ) {
    this.gitService = gitService;
    this.lakebaseService = lakebaseService;
    this.flywayService = flywayService;

    this.gitService.onBranchChanged(() => this.refresh());
  }

  /** Suppress automatic refreshes (e.g. during branch switch workflow) */
  set suppressRefresh(value: boolean) {
    this._suppressRefresh = value;
  }

  refresh(): void {
    if (this._suppressRefresh) {
      return;
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: BranchItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BranchItem): Promise<BranchItem[]> {
    if (!element) {
      return this.getRootItems();
    }
    return await this.getBranchDetails(element);
  }

  private async getRootItems(): Promise<BranchItem[]> {
    const items: BranchItem[] = [];

    try {
      const gitBranches = await this.gitService.listLocalBranches();
      let lakebaseBranches: LakebaseBranch[] = [];

      try {
        lakebaseBranches = await this.lakebaseService.listBranches();
      } catch {
        // Lakebase not available
      }

      const currentGitBranch = await this.gitService.getCurrentBranch();

      for (const gb of gitBranches) {
        const isMain = gb.name === 'main' || gb.name === 'master';
        const sanitized = this.lakebaseService.sanitizeBranchName(gb.name);

        const lb = isMain
          ? lakebaseBranches.find(b => b.isDefault)
          : lakebaseBranches.find(b =>
              b.branchId === sanitized ||
              b.uid === sanitized ||
              b.name.endsWith(`/branches/${sanitized}`)
            );

        const currentMarker = gb.name === currentGitBranch ? ' (current)' : '';
        const label = `${gb.name}${currentMarker}`;

        const isCurrent = gb.name === currentGitBranch;
        const item = new BranchItem(
          gb,
          lb,
          isCurrent ? 'currentBranch' : 'branch',
          label,
          vscode.TreeItemCollapsibleState.Collapsed
        );

        // Use ThemeIcon for proper icon rendering
        item.iconPath = this.getStateThemeIcon(lb);

        if (isCurrent) {
          item.description = lb?.state || 'no db branch';
        }

        items.push(item);
      }

      // Show Lakebase-only branches (ci-pr-*, orphaned branches)
      const matchedNames = new Set(
        items
          .filter(i => i.lakebaseBranch)
          .map(i => i.lakebaseBranch!.name)
      );

      for (const lb of lakebaseBranches) {
        if (!matchedNames.has(lb.name) && !lb.isDefault) {
          const item = new BranchItem(
            undefined,
            lb,
            'branch',
            `${lb.branchId} (db only)`,
            vscode.TreeItemCollapsibleState.Collapsed
          );
          item.iconPath = new vscode.ThemeIcon('cloud', new vscode.ThemeColor('charts.blue'));
          item.description = lb.state;
          items.push(item);
        }
      }
    } catch (err: any) {
      const errorItem = new BranchItem(
        undefined,
        undefined,
        'detail',
        err.message
      );
      errorItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      items.push(errorItem);
    }

    this.cachedData = items;
    return items;
  }

  private async getBranchDetails(parent: BranchItem): Promise<BranchItem[]> {
    const details: BranchItem[] = [];
    const gb = parent.gitBranch;
    const lb = parent.lakebaseBranch;

    if (gb) {
      const tracking = gb.tracking ? `-> ${gb.tracking}` : '(no remote)';
      const gitItem = new BranchItem(undefined, undefined, 'detail', `${gb.name} ${tracking}`);
      gitItem.iconPath = new vscode.ThemeIcon('git-branch');
      details.push(gitItem);

      if (gb.ahead || gb.behind) {
        const parts = [];
        if (gb.ahead) {parts.push(`${gb.ahead} ahead`);}
        if (gb.behind) {parts.push(`${gb.behind} behind`);}
        const syncItem = new BranchItem(undefined, undefined, 'detail', parts.join(', '));
        syncItem.iconPath = new vscode.ThemeIcon('git-compare');
        details.push(syncItem);
      }
    }

    if (lb) {
      const dbLabel = lb.isDefault ? `default (${lb.state})` : `${lb.branchId} (${lb.state})`;
      const dbItem = new BranchItem(undefined, undefined, 'detail', dbLabel);
      dbItem.iconPath = new vscode.ThemeIcon('database');
      details.push(dbItem);

      if (lb.endpointHost) {
        const epItem = new BranchItem(undefined, undefined, 'detail', `${lb.endpointState || 'unknown'}`);
        epItem.iconPath = new vscode.ThemeIcon('plug');
        details.push(epItem);
      }
    } else {
      const noDbItem = new BranchItem(undefined, undefined, 'detail', 'No Lakebase branch');
      noDbItem.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
      details.push(noDbItem);
    }

    // Show migration info for this specific branch (not the current working tree)
    if (gb) {
      const config = getConfig();
      const migFiles = await this.gitService.listMigrationsOnBranch(gb.name, config.migrationPath);
      if (migFiles.length > 0) {
        const lastFile = migFiles[migFiles.length - 1];
        const versionMatch = lastFile.match(/^V(\d+(?:\.\d+)*)/i);
        const version = versionMatch ? versionMatch[1] : '?';
        const migItem = new BranchItem(
          undefined, undefined, 'migration',
          `V${version} (${migFiles.length} file${migFiles.length !== 1 ? 's' : ''})`
        );
        migItem.iconPath = new vscode.ThemeIcon('versions');
        details.push(migItem);
      }
    }

    return details;
  }

  private getStateThemeIcon(lb: LakebaseBranch | undefined): vscode.ThemeIcon {
    if (!lb) {
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    }
    if (lb.state === 'READY') {
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    }
    if (lb.state === 'CREATING' || lb.state === 'PROVISIONING') {
      return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'));
    }
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
