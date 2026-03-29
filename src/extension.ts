import * as vscode from 'vscode';
import { GitService } from './services/gitService';
import { LakebaseService } from './services/lakebaseService';
import { FlywayService } from './services/flywayService';
import { SchemaDiffService } from './services/schemaDiffService';
import { StatusBarProvider } from './providers/statusBarProvider';
import { BranchTreeProvider, BranchItem } from './providers/branchTreeProvider';
import { SchemaDiffProvider } from './providers/schemaDiffProvider';
import { SchemaScmProvider } from './providers/schemaScmProvider';
import { SchemaContentProvider } from './providers/schemaContentProvider';
import { ChangesTreeProvider } from './providers/changesTreeProvider';
import { MigrationsTreeProvider } from './providers/migrationsTree';
import { PullRequestTreeProvider } from './providers/pullRequestTree';
import { MergesTreeProvider } from './providers/mergesTree';
import { getConfig, getWorkspaceRoot, updateEnvConnection } from './utils/config';

let gitService: GitService;
let lakebaseService: LakebaseService;
let flywayService: FlywayService;
let schemaDiffService: SchemaDiffService;
let statusBarProvider: StatusBarProvider;
let branchTreeProvider: BranchTreeProvider;
let schemaDiffProvider: SchemaDiffProvider;
let schemaScmProvider: SchemaScmProvider;

/** Prompt user to login when auth errors are detected */
async function handleAuthError(lakebaseService: LakebaseService, err: any): Promise<boolean> {
  const isAuth = (err as any).isAuthError === true ||
    err.message?.includes('project id not found') ||
    err.message?.includes('not authenticated') ||
    err.message?.includes('401');

  if (!isAuth) {
    return false;
  }

  const authStatus = await lakebaseService.checkAuth();
  let msg: string;

  if (authStatus.mismatch) {
    msg = `Workspace mismatch: CLI is authenticated to ${authStatus.currentHost}, but this project requires ${authStatus.expectedHost}.`;
  } else if (!authStatus.authenticated) {
    msg = `Not authenticated to Databricks. Login required for ${authStatus.expectedHost}.`;
  } else {
    msg = `Auth error: ${err.message}`;
  }

  const action = await vscode.window.showErrorMessage(msg, 'Login', 'Select Workspace');
  if (action === 'Login') {
    vscode.commands.executeCommand('lakebaseSync.connectWorkspace');
  } else if (action === 'Select Workspace') {
    vscode.commands.executeCommand('lakebaseSync.connectWorkspace');
  }
  return true;
}

export async function activate(context: vscode.ExtensionContext) {
  const config = getConfig();

  if (!config.lakebaseProjectId) {
    vscode.window.showWarningMessage(
      'Lakebase Sync: No LAKEBASE_PROJECT_ID found. Set it in .env or extension settings.'
    );
  }

  // Initialize services
  gitService = new GitService();
  lakebaseService = new LakebaseService();
  flywayService = new FlywayService();
  schemaDiffService = new SchemaDiffService(lakebaseService);
  schemaDiffProvider = new SchemaDiffProvider(schemaDiffService, gitService, flywayService);

  await gitService.initialize();

  const cliAvailable = await lakebaseService.isAvailable();
  if (!cliAvailable) {
    vscode.window.showWarningMessage(
      'Lakebase Sync: Databricks CLI not found. Install it and run "databricks auth login".'
    );
  }

  // Check auth on startup
  if (cliAvailable && config.lakebaseProjectId) {
    const authStatus = await lakebaseService.checkAuth();
    if (!authStatus.authenticated) {
      const action = await vscode.window.showWarningMessage(
        `Lakebase Sync: Not connected to ${authStatus.expectedHost}.`,
        'Connect'
      );
      if (action === 'Connect') {
        vscode.commands.executeCommand('lakebaseSync.connectWorkspace');
      }
    }
  }

  // Initialize providers
  statusBarProvider = new StatusBarProvider(gitService, lakebaseService, flywayService);
  branchTreeProvider = new BranchTreeProvider(gitService, lakebaseService, flywayService, schemaDiffService);

  // Initialize SCM provider — compares actual Lakebase branch schemas
  schemaScmProvider = new SchemaScmProvider(gitService, flywayService, schemaDiffService, lakebaseService);

  // Register schema DDL content provider for multi-diff editor
  const schemaContentProvider = vscode.workspace.registerTextDocumentContentProvider(
    'lakebase-schema-content',
    new SchemaContentProvider(schemaDiffService, flywayService)
  );

  // Register tree view
  const treeView = vscode.window.createTreeView('lakebaseBranches', {
    treeDataProvider: branchTreeProvider,
    showCollapseAll: true,
  });


  // Register sidebar tree views (Phases A-G)
  const changesTreeProvider = new ChangesTreeProvider(schemaScmProvider);
  const migrationsTreeProvider = new MigrationsTreeProvider(schemaScmProvider);
  const pullRequestTreeProvider = new PullRequestTreeProvider(schemaScmProvider, gitService);
  const mergesTreeProvider = new MergesTreeProvider(schemaScmProvider);

  const changesView = vscode.window.createTreeView('lakebaseChanges', {
    treeDataProvider: changesTreeProvider,
    showCollapseAll: true,
  });
  const migrationsView = vscode.window.createTreeView('lakebaseMigrations', {
    treeDataProvider: migrationsTreeProvider,
  });
  const prView = vscode.window.createTreeView('lakebasePR', {
    treeDataProvider: pullRequestTreeProvider,
  });
  const mergesView = vscode.window.createTreeView('lakebaseMerges', {
    treeDataProvider: mergesTreeProvider,
  });

  // Badge count on the activity bar icon (uses the Changes view)
  const updateBadge = () => {
    const count = changesTreeProvider.getChangeCount();
    changesView.badge = count > 0
      ? { value: count, tooltip: `Lakebase SCM Extension — ${count} pending changes` }
      : undefined;
  };
  schemaScmProvider.onDidRefresh(() => {
    updateBadge();
    branchTreeProvider.refresh();
    // Second refresh after a short delay to catch async Lakebase data
    setTimeout(() => branchTreeProvider.refresh(), 2000);
  });
  updateBadge();

  // Watch migration files for status bar + tree updates
  // (SCM provider has its own migration watcher — don't duplicate)
  const migrationWatcher = flywayService.watchMigrations(() => {
    statusBarProvider.refresh();
    branchTreeProvider.refresh();
  });

  // Set initial branch context
  const initialBranch = await gitService.getCurrentBranch();
  const isFeature = !!initialBranch && initialBranch !== 'main' && initialBranch !== 'master';
  vscode.commands.executeCommand('setContext', 'lakebaseSync.onFeatureBranch', isFeature);
  vscode.commands.executeCommand('setContext', 'lakebaseSync.isRebasing', await gitService.isRebasing());

  // Sync .env connection on git branch change, optionally auto-create Lakebase branch
  const autoBranchDisposable = gitService.onBranchChanged(async (newBranch: string) => {
    const onFeature = !!newBranch && newBranch !== 'main' && newBranch !== 'master';
    vscode.commands.executeCommand('setContext', 'lakebaseSync.onFeatureBranch', onFeature);
    vscode.commands.executeCommand('setContext', 'lakebaseSync.isRebasing', await gitService.isRebasing());

    if (!newBranch || newBranch === 'main' || newBranch === 'master') { return; }

    // Clear schema cache — new branch may have different schema
    schemaDiffService.clearCache();

    const cfg = getConfig();

    try {
      // Always check if Lakebase branch exists and sync .env connection
      const existing = await lakebaseService.getBranchByName(newBranch);
      if (existing) {
        // Branch exists — just refresh credentials and update .env
        const ep = await lakebaseService.getEndpoint(existing.branchId);
        if (ep?.host) {
          const cred = await lakebaseService.getCredential(existing.branchId);
          updateEnvConnection({
            host: ep.host,
            branchId: existing.branchId,
            username: cred.email,
            password: cred.token,
          });
        }
        return;
      }

      // No existing branch — only create if autoCreateBranch is enabled
      if (!cfg.autoCreateBranch) { return; }

      // Create new Lakebase branch
      const sanitized = lakebaseService.sanitizeBranchName(newBranch);
      const lb = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating Lakebase branch: ${sanitized}`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Creating branch...' });
          const branch = await lakebaseService.createBranch(newBranch);
          if (!branch) { return undefined; }

          progress.report({ message: 'Getting endpoint...' });
          const ep = await lakebaseService.getEndpoint(branch.branchId);
          if (!ep?.host) { return branch; }

          progress.report({ message: 'Refreshing credentials...' });
          const cred = await lakebaseService.getCredential(branch.branchId);

          progress.report({ message: 'Updating connection config...' });
          updateEnvConnection({
            host: ep.host,
            branchId: branch.branchId,
            username: cred.email,
            password: cred.token,
          });

          return branch;
        }
      );

      if (lb) {
        vscode.window.showInformationMessage(
          `Lakebase branch "${sanitized}" created and connected.`
        );
      }
    } catch (err: any) {
      if (!await handleAuthError(lakebaseService, err)) {
        // Silently log — don't block the user's checkout
        console.warn(`Auto-branch creation failed for ${newBranch}: ${err.message}`);
      }
    }
  });

  // Register commands
  context.subscriptions.push(
    treeView,
    changesView,
    migrationsView,
    prView,
    mergesView,
    migrationWatcher,
    autoBranchDisposable,

    vscode.commands.registerCommand('lakebaseSync.toggleChangesTree', () => {
      if (!changesTreeProvider.viewAsTree) { changesTreeProvider.toggleViewMode(); }
    }),
    vscode.commands.registerCommand('lakebaseSync.toggleChangesList', () => {
      if (changesTreeProvider.viewAsTree) { changesTreeProvider.toggleViewMode(); }
    }),

    vscode.commands.registerCommand('lakebaseSync.showBranchStatus', async () => {
      const gitBranch = await gitService.getCurrentBranch();
      const lb = statusBarProvider.getCurrentLakebaseBranch();

      if (lb) {
        const version = flywayService.getLatestVersion() || '?';
        vscode.window.showInformationMessage(
          `Git: ${gitBranch} | DB: ${lb.branchId} (${lb.state}) | Migrations: V${version}`
        );
      } else {
        const action = await vscode.window.showWarningMessage(
          `Git: ${gitBranch} | No Lakebase branch found`,
          'Create Branch'
        );
        if (action === 'Create Branch') {
          vscode.commands.executeCommand('lakebaseSync.createBranch');
        }
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.refreshBranches', () => {
      schemaDiffService.clearCache();
      statusBarProvider.refresh();
      branchTreeProvider.refresh();
      schemaScmProvider.refresh();
    }),

    vscode.commands.registerCommand('lakebaseSync.createBranch', async () => {
      const gitBranch = await gitService.getCurrentBranch();
      if (!gitBranch || gitBranch === 'main' || gitBranch === 'master') {
        vscode.window.showWarningMessage('Cannot create a Lakebase branch for main/master.');
        return;
      }

      const sanitized = lakebaseService.sanitizeBranchName(gitBranch);
      const confirm = await vscode.window.showInformationMessage(
        `Create Lakebase branch "${sanitized}" from default?`,
        'Create',
        'Cancel'
      );

      if (confirm !== 'Create') {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating Lakebase branch: ${sanitized}`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'Creating branch...' });
          try {
            const branch = await lakebaseService.createBranch(gitBranch);
            if (branch && branch.state === 'READY') {
              vscode.window.showInformationMessage(
                `Lakebase branch "${sanitized}" is ready.`
              );
            } else {
              vscode.window.showWarningMessage(
                `Lakebase branch "${sanitized}" created but not ready yet (state: ${branch?.state || 'unknown'}).`
              );
            }
            statusBarProvider.refresh();
            branchTreeProvider.refresh();
          } catch (err: any) {
            if (!await handleAuthError(lakebaseService, err)) {
              vscode.window.showErrorMessage(`Failed to create branch: ${err.message}`);
            }
          }
        }
      );
    }),

    vscode.commands.registerCommand('lakebaseSync.createUnifiedBranch', async () => {
      const branchName = await vscode.window.showInputBox({
        prompt: 'New branch name',
        placeHolder: 'feature/my-feature',
        validateInput: (val) => {
          if (!val.trim()) { return 'Branch name is required'; }
          if (val === 'main' || val === 'master') { return 'Cannot branch from main/master with this name'; }
          return undefined;
        },
      });

      if (!branchName) { return; }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating branch: ${branchName}`,
          cancellable: false,
        },
        async (progress) => {
          try {
            // 1. Create git branch
            progress.report({ message: 'Creating code branch...' });
            await gitService.checkoutBranch(branchName, true);

            // 2. Create Lakebase branch
            const sanitized = lakebaseService.sanitizeBranchName(branchName);
            progress.report({ message: `Creating database branch: ${sanitized}...` });
            const lb = await lakebaseService.createBranch(branchName);

            if (!lb) {
              vscode.window.showWarningMessage(
                `Git branch "${branchName}" created. Lakebase branch creation failed.`
              );
              return;
            }

            // 3. Get endpoint and credentials
            progress.report({ message: 'Getting database endpoint...' });
            const ep = await lakebaseService.getEndpoint(lb.branchId);

            if (ep?.host) {
              progress.report({ message: 'Refreshing credentials...' });
              const cred = await lakebaseService.getCredential(lb.branchId);

              progress.report({ message: 'Updating connection config...' });
              updateEnvConnection({
                host: ep.host,
                branchId: lb.branchId,
                username: cred.email,
                password: cred.token,
              });
            }

            vscode.window.showInformationMessage(
              `Branch "${branchName}" created — code + database ready.`
            );
          } catch (err: any) {
            if (!await handleAuthError(lakebaseService, err)) {
              vscode.window.showErrorMessage(`Failed to create branch: ${err.message}`);
            }
          } finally {
            statusBarProvider.refresh();
            branchTreeProvider.refresh();
            schemaScmProvider.refresh();
          }
        }
      );
    }),

    vscode.commands.registerCommand('lakebaseSync.deleteBranch', async (item?: any) => {
      let branchName: string;

      if (item?.lakebaseBranch) {
        if (item.lakebaseBranch.isDefault && getConfig().productionReadOnly) {
          vscode.window.showWarningMessage('Cannot delete the production branch (productionReadOnly is enabled).');
          return;
        }
        branchName = item.lakebaseBranch.branchId;
      } else {
        let branches;
        try {
          branches = await lakebaseService.listBranches();
        } catch (err: any) {
          await handleAuthError(lakebaseService, err);
          return;
        }
        const nonDefault = branches.filter(b => !b.isDefault);
        const pick = await vscode.window.showQuickPick(
          nonDefault.map(b => ({ label: b.branchId, description: b.state, branch: b })),
          { placeHolder: 'Select Lakebase branch to delete' }
        );
        if (!pick) {
          return;
        }
        branchName = pick.label;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete Lakebase branch "${branchName}"? This cannot be undone.`,
        { modal: true },
        'Delete'
      );

      if (confirm !== 'Delete') {
        return;
      }

      try {
        await lakebaseService.deleteBranch(branchName);
        vscode.window.showInformationMessage(`Deleted Lakebase branch: ${branchName}`);
        branchTreeProvider.refresh();
        statusBarProvider.refresh();
      } catch (err: any) {
        if (!await handleAuthError(lakebaseService, err)) {
          vscode.window.showErrorMessage(`Failed to delete branch: ${err.message}`);
        }
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.refreshCredentials', async () => {
      const gitBranch = await gitService.getCurrentBranch();
      const isMain = gitBranch === 'main' || gitBranch === 'master';

      let branchId: string;
      if (isMain) {
        const defaultBranch = await lakebaseService.getDefaultBranch();
        if (!defaultBranch) {
          vscode.window.showErrorMessage('No default Lakebase branch found.');
          return;
        }
        branchId = defaultBranch.branchId;
      } else {
        const lb = await lakebaseService.getBranchByName(gitBranch);
        if (!lb) {
          vscode.window.showErrorMessage(`No Lakebase branch for "${gitBranch}".`);
          return;
        }
        branchId = lb.branchId;
      }

      try {
        const cred = await lakebaseService.getCredential(branchId);
        vscode.window.showInformationMessage(
          `Credentials refreshed for ${branchId} (user: ${cred.email})`
        );
      } catch (err: any) {
        if (!await handleAuthError(lakebaseService, err)) {
          vscode.window.showErrorMessage(`Failed to refresh credentials: ${err.message}`);
        }
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.connectWorkspace', async () => {
      const effectiveHost = lakebaseService.getEffectiveHost().replace(/\/+$/, '');

      // Check current auth status
      const authStatus = await lakebaseService.checkAuth();
      const connectedLabel = authStatus.authenticated
        ? `Connected to ${effectiveHost}`
        : `Not connected`;

      interface WorkspacePickItem extends vscode.QuickPickItem {
        host: string;
        valid: boolean;
        action?: 'new';
      }

      const items: WorkspacePickItem[] = [];

      // Show project workspace first if configured
      if (effectiveHost) {
        const isConnected = authStatus.authenticated;
        items.push({
          label: `${isConnected ? '$(check)' : '$(plug)'} Project workspace`,
          description: effectiveHost,
          detail: isConnected ? 'Connected' : 'Not authenticated — select to connect',
          host: effectiveHost,
          valid: isConnected,
        });
      }

      // Discover workspaces with Lakebase (filtered)
      const lakebaseProfiles = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Discovering Lakebase workspaces...',
        },
        () => lakebaseService.listLakebaseProfiles()
      );

      const otherProfiles = lakebaseProfiles.filter(p => p.host !== effectiveHost);
      if (otherProfiles.length > 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, host: '', valid: false });
        for (const p of otherProfiles) {
          const projectCount = p.lakebaseProjects?.length || 0;
          const projectNames = p.lakebaseProjects?.map(pr => pr.displayName).join(', ') || '';
          items.push({
            label: `$(database) ${p.name}`,
            description: `${p.host} (${p.cloud})`,
            detail: `${projectCount} Lakebase project${projectCount !== 1 ? 's' : ''}: ${projectNames}`,
            host: p.host,
            valid: p.valid,
          });
        }
      }

      // New workspace option
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, host: '', valid: false });
      items.push({
        label: '$(add) Connect to a new workspace...',
        description: '',
        detail: 'Enter a workspace URL and authenticate',
        host: '',
        valid: false,
        action: 'new',
      });

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: connectedLabel,
        title: 'Lakebase: Connect to Workspace',
      });

      if (!pick) {
        return;
      }

      let targetHost: string;

      if (pick.action === 'new') {
        const input = await vscode.window.showInputBox({
          prompt: 'Databricks workspace URL',
          placeHolder: 'https://your-workspace.cloud.databricks.com',
          validateInput: (val) => {
            if (!val.startsWith('https://')) {
              return 'URL must start with https://';
            }
            return undefined;
          },
        });
        if (!input) {
          return;
        }
        targetHost = input.replace(/\/+$/, '');
      } else {
        targetHost = pick.host;
      }

      // Set as session target
      lakebaseService.setHostOverride(targetHost);

      if (pick.valid && targetHost === effectiveHost) {
        // Already connected — just refresh
        vscode.window.showInformationMessage(`Already connected to ${targetHost}`);
        statusBarProvider.refresh();
        branchTreeProvider.refresh();
        return;
      }

      // Need to authenticate — open terminal
      const loginCmd = lakebaseService.getLoginCommand(targetHost);
      const terminal = vscode.window.createTerminal('Databricks Connect');
      terminal.show();
      terminal.sendText(loginCmd);

      const disposable = vscode.window.onDidCloseTerminal(t => {
        if (t === terminal) {
          disposable.dispose();
          vscode.window.showInformationMessage(
            `Connected to ${targetHost}`
          );
          statusBarProvider.refresh();
          branchTreeProvider.refresh();
        }
      });
    }),

    vscode.commands.registerCommand('lakebaseSync.runMigrate', async () => {
      // Clear schema cache — database will change after Flyway runs
      schemaDiffService.clearCache();
      const terminal = vscode.window.createTerminal('Flyway Migrate');
      terminal.show();
      terminal.sendText('./scripts/flyway-migrate.sh');
    }),

    vscode.commands.registerCommand('lakebaseSync.showMigrationHistory', async () => {
      const migrations = flywayService.listMigrations();
      if (migrations.length === 0) {
        vscode.window.showInformationMessage('No migration files found.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        migrations.map(m => ({
          label: `V${m.version}`,
          description: m.description,
          detail: m.filename,
          migration: m,
        })),
        { placeHolder: 'Migration history (select to open)' }
      );

      if (pick) {
        const doc = await vscode.workspace.openTextDocument(pick.migration.fullPath);
        vscode.window.showTextDocument(doc);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.showTableDiff', async (tableName?: string, diffType?: string) => {
      if (!tableName || !diffType) {
        return;
      }
      try {
        const diff = schemaScmProvider.getLastDiff();
        await schemaDiffProvider.showTableDiff(
          tableName,
          diffType as 'created' | 'modified' | 'removed',
          diff
        );
      } catch (err: any) {
        if (!await handleAuthError(lakebaseService, err)) {
          vscode.window.showErrorMessage(`Schema diff failed: ${err.message}`);
        }
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.showBranchDiff', async (item?: BranchItem) => {
      try {
        const fileChanges = await gitService.getChangedFiles();
        // If invoked from a tree item, diff that branch; otherwise diff current
        const branchId = item?.lakebaseBranch?.branchId;
        await schemaDiffProvider.showDiff(false, fileChanges, branchId);
      } catch (err: any) {
        if (!await handleAuthError(lakebaseService, err)) {
          vscode.window.showErrorMessage(`Branch diff failed: ${err.message}`);
        }
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.showCachedBranchDiff', async () => {
      try {
        const fileChanges = await gitService.getChangedFiles();
        await schemaDiffProvider.showDiff(false, fileChanges);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Branch diff failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.openInConsole', async (item?: BranchItem) => {
      let branchUid = item?.lakebaseBranch?.uid;
      // If no branch item provided, resolve current branch or fall back to default
      if (!branchUid) {
        try {
          const gitBranch = await gitService.getCurrentBranch();
          const isMain = gitBranch === 'main' || gitBranch === 'master';
          const lb = isMain
            ? await lakebaseService.getDefaultBranch()
            : await lakebaseService.getBranchByName(gitBranch);
          branchUid = lb?.uid;
          if (!branchUid) {
            const defaultBranch = await lakebaseService.getDefaultBranch();
            branchUid = defaultBranch?.uid;
          }
        } catch {
          // Fall through — url will be project-level
        }
      }
      const url = lakebaseService.getConsoleUrl(branchUid);
      if (!url) {
        vscode.window.showWarningMessage('Cannot build console URL. Check DATABRICKS_HOST and LAKEBASE_PROJECT_ID in .env.');
        return;
      }
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand('lakebaseSync.switchBranch', async (item?: any) => {
      if (!item?.gitBranch) {
        return;
      }

      const targetGitBranch = item.gitBranch.name;
      const isMain = targetGitBranch === 'main' || targetGitBranch === 'master';

      // Suppress automatic refreshes until the full switch completes
      statusBarProvider.suppressRefresh = true;
      branchTreeProvider.suppressRefresh = true;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Switching to ${targetGitBranch}`,
          cancellable: false,
        },
        async (progress) => {
          try {
            // 1. Checkout git branch
            progress.report({ message: 'Checking out code branch...' });
            await gitService.checkoutBranch(targetGitBranch);

            // 2. Find or create Lakebase branch
            progress.report({ message: 'Finding database branch...' });
            let lb;
            if (isMain) {
              lb = await lakebaseService.getDefaultBranch();
            } else {
              lb = await lakebaseService.getBranchByName(targetGitBranch);
            }

            if (!lb && !isMain) {
              progress.report({ message: 'Creating database branch...' });
              try {
                lb = await lakebaseService.createBranch(targetGitBranch);
              } catch (err: any) {
                if (!await handleAuthError(lakebaseService, err)) {
                  vscode.window.showWarningMessage(
                    `Switched to ${targetGitBranch} (code only). DB branch creation failed: ${err.message}`
                  );
                }
                statusBarProvider.refresh();
                branchTreeProvider.refresh();
                return;
              }
            }

            if (!lb) {
              vscode.window.showWarningMessage(
                `Switched to ${targetGitBranch} (code only). No database branch available.`
              );
              statusBarProvider.refresh();
              branchTreeProvider.refresh();
              return;
            }

            // 3. Get endpoint
            progress.report({ message: 'Getting database endpoint...' });
            const endpoint = await lakebaseService.getEndpoint(lb.branchId);
            if (!endpoint?.host) {
              vscode.window.showWarningMessage(
                `Switched to ${targetGitBranch}. DB branch exists but no endpoint available.`
              );
              statusBarProvider.refresh();
              branchTreeProvider.refresh();
              return;
            }

            // 4. Get credential
            progress.report({ message: 'Refreshing credentials...' });
            const cred = await lakebaseService.getCredential(lb.branchId);

            // 5. Update .env and application-local.properties
            progress.report({ message: 'Updating connection config...' });
            updateEnvConnection({
              host: endpoint.host,
              branchId: lb.branchId,
              username: cred.email,
              password: cred.token,
            });

            // 6. Run Flyway migrate (applies only migrations present on this branch)
            progress.report({ message: 'Applying migrations...' });
            schemaDiffService.clearCache(); // DB will change after Flyway runs
            const migrationCount = flywayService.getMigrationCount();
            if (migrationCount > 0) {
              const terminal = vscode.window.createTerminal({
                name: `Flyway: ${targetGitBranch}`,
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
              });
              terminal.show(true);
              terminal.sendText('./scripts/flyway-migrate.sh');
            }

            vscode.window.showInformationMessage(
              `Switched to ${targetGitBranch} → DB: ${lb.branchId} (${lb.state})` +
              (migrationCount > 0 ? ` | ${migrationCount} migration(s) applying...` : '')
            );
          } catch (err: any) {
            const msg = err.message || '';
            if (msg.includes('local changes') && msg.includes('overwritten by checkout')) {
              const action = await vscode.window.showWarningMessage(
                `Cannot switch to ${targetGitBranch} — you have uncommitted changes that would be overwritten.`,
                'Stash & Switch', 'Commit First', 'Cancel'
              );
              if (action === 'Stash & Switch') {
                try {
                  await gitService.stash(`Auto-stash before switching to ${targetGitBranch}`);
                  vscode.window.showInformationMessage('Changes stashed. Retrying checkout...');
                  vscode.commands.executeCommand('lakebaseSync.switchBranch', item);
                } catch (stashErr: any) {
                  vscode.window.showErrorMessage(`Failed to stash: ${stashErr.message}`);
                }
              } else if (action === 'Commit First') {
                vscode.commands.executeCommand('lakebaseSync.commit');
              }
            } else if (!await handleAuthError(lakebaseService, err)) {
              vscode.window.showErrorMessage(`Failed to switch branch: ${msg}`);
            }
          } finally {
            // Re-enable and force a single refresh with final state
            statusBarProvider.suppressRefresh = false;
            branchTreeProvider.suppressRefresh = false;
            statusBarProvider.refresh();
            branchTreeProvider.refresh();
            schemaScmProvider.refresh();
            // Re-render the Branch Diff panel if it's open
            schemaDiffProvider.refresh();
          }
        }
      );
    })
  );

  // SCM git operations
  context.subscriptions.push(
    vscode.commands.registerCommand('lakebaseSync.reviewBranch', async () => {
      try {
        const root = getWorkspaceRoot();
        const currentBranch = await gitService.getCurrentBranch();
        const title = `Branch Review: ${currentBranch}`;

        // vscode.changes expects [labelUri, originalUri, modifiedUri][] — 3-element tuples
        const changes: [vscode.Uri, vscode.Uri | undefined, vscode.Uri | undefined][] = [];

        // Collect code diffs
        const fileChanges = await gitService.getChangedFiles();

        for (const file of fileChanges) {
          const filePath = root ? `${root}/${file.path}` : file.path;
          const modified = vscode.Uri.file(filePath);
          const diffPath = file.status === 'renamed' && file.oldPath ? file.oldPath : file.path;
          const original = vscode.Uri.parse(`lakebase-git-base://merge-base/${diffPath}`);

          if (file.status === 'added') {
            changes.push([modified, undefined, modified]);
          } else if (file.status === 'deleted') {
            changes.push([original, original, undefined]);
          } else {
            changes.push([modified, original, modified]);
          }
        }

        // Collect schema diffs
        const diff = schemaDiffService.getCachedDiff() || await schemaDiffService.compareBranchSchemas();
        if (diff && !diff.error) {
          for (const obj of [...diff.created, ...diff.modified, ...diff.removed]) {
            const label = vscode.Uri.parse(`lakebase-schema-content://branch/${obj.name}`);
            const original = vscode.Uri.parse(`lakebase-schema-content://production/${obj.name}`);
            const modified = vscode.Uri.parse(`lakebase-schema-content://branch/${obj.name}`);
            changes.push([label, original, modified]);
          }
        }

        // Migration file fallback if pg_dump found nothing
        if (diff && diff.inSync && !diff.error) {
          try {
            const config = getConfig();
            const mainMigrations = await gitService.listMigrationsOnBranch('main', config.migrationPath);
            const mainSet = new Set(mainMigrations);
            const branchMigrations = flywayService.listMigrations();
            const newMigrations = branchMigrations.filter(m => !mainSet.has(m.filename));
            if (newMigrations.length > 0) {
              const schemaChanges = flywayService.parseMigrationSchemaChanges(newMigrations);
              const seen = new Set<string>();
              for (const change of schemaChanges) {
                if (seen.has(change.tableName)) { continue; }
                seen.add(change.tableName);
                const label = vscode.Uri.parse(`lakebase-schema-content://branch/${change.tableName}`);
                const original = vscode.Uri.parse(`lakebase-schema-content://production/${change.tableName}`);
                const modified = vscode.Uri.parse(`lakebase-schema-content://branch/${change.tableName}`);
                changes.push([label, original, modified]);
              }
            }
          } catch { /* ignore */ }
        }

        if (changes.length === 0) {
          vscode.window.showInformationMessage('No changes to review.');
          return;
        }

        await vscode.commands.executeCommand('vscode.changes', title, changes);
      } catch (err: any) {
        if (!await handleAuthError(lakebaseService, err)) {
          vscode.window.showErrorMessage(`Review failed: ${err.message}`);
        }
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.stageFile', async (resourceState: any) => {
      const filePath = resourceState?.resourceUri?.fsPath;
      if (!filePath) { return; }
      const root = getWorkspaceRoot();
      const relative = root ? filePath.replace(root + '/', '') : filePath;
      try {
        await gitService.stageFile(relative);
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to stage: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.unstageFile', async (resourceState: any) => {
      const filePath = resourceState?.resourceUri?.fsPath;
      if (!filePath) { return; }
      const root = getWorkspaceRoot();
      const relative = root ? filePath.replace(root + '/', '') : filePath;
      try {
        await gitService.unstageFile(relative);
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to unstage: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.discardChanges', async (resourceState: any) => {
      const filePath = resourceState?.resourceUri?.fsPath;
      if (!filePath) { return; }
      const root = getWorkspaceRoot();
      const relative = root ? filePath.replace(root + '/', '') : filePath;
      const confirm = await vscode.window.showWarningMessage(
        `Discard changes to "${relative}"? This cannot be undone.`,
        { modal: true },
        'Discard'
      );
      if (confirm !== 'Discard') { return; }
      try {
        await gitService.discardFile(relative);
        // Clear schema cache if a migration file was discarded
        if (/V\d+.*\.sql$/i.test(relative)) { schemaDiffService.clearCache(); }
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to discard: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.stageAll', async () => {
      const root = getWorkspaceRoot();
      if (!root) { return; }
      try {
        await gitService.stageFile('.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to stage all: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.unstageAll', async () => {
      const root = getWorkspaceRoot();
      if (!root) { return; }
      try {
        await gitService.unstageFile('.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to unstage all: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.commit', async () => {
      const scm = schemaScmProvider.getScm();
      let message = scm?.inputBox.value || '';
      if (!message.trim()) {
        // Prompt for message when SCM input box is empty (e.g. committing from sidebar)
        const input = await vscode.window.showInputBox({
          prompt: 'Commit message',
          placeHolder: 'Describe your changes...',
          validateInput: (val) => val.trim() ? undefined : 'Commit message is required',
        });
        if (!input) { return; }
        message = input;
      }
      try {
        // If nothing is staged, stage all changes first (like Git SCM behavior)
        const staged = await gitService.getStagedChanges();
        if (staged.length === 0) {
          await gitService.stageFile('.');
        }
        await gitService.commit(message);
        if (scm) { scm.inputBox.value = ''; }
        vscode.window.showInformationMessage('Committed successfully.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Commit failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.commitStaged', async () => {
      // Same as commit — commits whatever is staged
      vscode.commands.executeCommand('lakebaseSync.commit');
    }),

    vscode.commands.registerCommand('lakebaseSync.commitAll', async () => {
      const scm = schemaScmProvider.getScm();
      let message = scm?.inputBox.value || '';
      if (!message.trim()) {
        const input = await vscode.window.showInputBox({
          prompt: 'Commit message',
          placeHolder: 'Describe your changes...',
          validateInput: (val) => val.trim() ? undefined : 'Commit message is required',
        });
        if (!input) { return; }
        message = input;
      }
      try {
        await gitService.commitAll(message);
        if (scm) { scm.inputBox.value = ''; }
        vscode.window.showInformationMessage('All changes committed.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Commit all failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.undoLastCommit', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Undo last commit? Changes will be kept as staged.',
        { modal: true },
        'Undo'
      );
      if (confirm !== 'Undo') { return; }
      try {
        await gitService.undoLastCommit();
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Last commit undone. Changes are staged.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Undo failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.commitAmend', async () => {
      const scm = schemaScmProvider.getScm();
      if (!scm) { return; }
      const message = scm.inputBox.value;
      try {
        if (message.trim()) {
          await gitService.commitAmendMessage(message);
          scm.inputBox.value = '';
        } else {
          await gitService.commitAmend();
        }
        vscode.window.showInformationMessage('Commit amended.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Amend failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.commitStagedAmend', async () => {
      vscode.commands.executeCommand('lakebaseSync.commitAmend');
    }),

    vscode.commands.registerCommand('lakebaseSync.commitAllAmend', async () => {
      try {
        await gitService.stageFile('.');
        vscode.commands.executeCommand('lakebaseSync.commitAmend');
      } catch (err: any) {
        vscode.window.showErrorMessage(`Commit all amend failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.discardAllChanges', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Discard ALL changes? This cannot be undone.',
        { modal: true },
        'Discard All'
      );
      if (confirm !== 'Discard All') { return; }
      try {
        await gitService.discardAllChanges();
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('All changes discarded.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Discard failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.renameBranch', async () => {
      const oldBranch = await gitService.getCurrentBranch();
      const newName = await vscode.window.showInputBox({
        prompt: 'New branch name',
        placeHolder: 'feature/new-name',
      });
      if (!newName) { return; }
      try {
        await gitService.renameBranch(newName);
        // Delete old Lakebase branch (new one will be auto-created by onBranchChanged)
        if (oldBranch && oldBranch !== 'main' && oldBranch !== 'master') {
          try {
            const oldLb = await lakebaseService.getBranchByName(oldBranch);
            if (oldLb) {
              await lakebaseService.deleteBranch(oldLb.branchId);
            }
          } catch { /* Lakebase cleanup is optional */ }
        }
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage(`Branch renamed to ${newName}. Lakebase branch will be recreated.`);
        statusBarProvider.refresh();
        branchTreeProvider.refresh();
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Rename failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.mergeBranch', async () => {
      const branches = await gitService.listLocalBranches();
      const currentBranch = await gitService.getCurrentBranch();
      const otherBranches = branches.filter(b => b.name !== currentBranch);

      const pick = await vscode.window.showQuickPick(
        otherBranches.map(b => ({ label: b.name })),
        { placeHolder: 'Select branch to merge into current branch' }
      );
      if (!pick) { return; }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Merging ${pick.label}...` },
          () => gitService.mergeBranch(pick.label)
        );
        schemaDiffService.clearCache();
        // Offer to clean up the merged branch's Lakebase branch
        if (pick.label !== 'main' && pick.label !== 'master') {
          try {
            const mergedLb = await lakebaseService.getBranchByName(pick.label);
            if (mergedLb) {
              const cleanup = await vscode.window.showInformationMessage(
                `Merged ${pick.label}. Delete its Lakebase branch "${mergedLb.branchId}"?`,
                'Delete', 'Keep'
              );
              if (cleanup === 'Delete') {
                await lakebaseService.deleteBranch(mergedLb.branchId);
              }
            } else {
              vscode.window.showInformationMessage(`Merged ${pick.label} into ${currentBranch}.`);
            }
          } catch {
            vscode.window.showInformationMessage(`Merged ${pick.label} into ${currentBranch}.`);
          }
        } else {
          vscode.window.showInformationMessage(`Merged ${pick.label} into ${currentBranch}.`);
        }
        schemaScmProvider.refresh();
        statusBarProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Merge failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.push', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Pushing...' },
          () => gitService.push()
        );
        vscode.window.showInformationMessage('Pushed successfully.');
        statusBarProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Push failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.pull', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Pulling...' },
          () => gitService.pull()
        );
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Pulled successfully.');
        schemaScmProvider.refresh();
        statusBarProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Pull failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.switchBranchPicker', async () => {
      try {
        const currentBranch = await gitService.getCurrentBranch();

        // Fetch git branches (local + remote) and lakebase branches in parallel
        const [gitBranches, remoteBranches, lakebaseBranches] = await Promise.all([
          gitService.listLocalBranches(),
          gitService.listRemoteBranches(),
          lakebaseService.listBranches().catch(() => [] as any[]),
        ]);

        // Build a map of lakebase branches by sanitized name
        const lbMap = new Map<string, string>();
        for (const lb of lakebaseBranches) {
          lbMap.set(lb.branchId, `${lb.branchId} (${lb.state})`);
        }
        const defaultLb = lakebaseBranches.find((b: any) => b.isDefault);

        interface BranchPickItem extends vscode.QuickPickItem {
          action?: 'create' | 'create-from' | 'detach';
          branchName?: string;
          isRemote?: boolean;
        }

        function getLakebaseInfo(branchName: string): string {
          const isMain = branchName === 'main' || branchName === 'master';
          const sanitized = lakebaseService.sanitizeBranchName(branchName);
          if (isMain) {
            return defaultLb ? `→ ${defaultLb.branchId} (default)` : '→ no Lakebase';
          }
          return lbMap.has(sanitized) ? `→ ${lbMap.get(sanitized)}` : '→ no Lakebase branch';
        }

        const items: BranchPickItem[] = [];

        // Actions section
        items.push({ label: 'Actions', kind: vscode.QuickPickItemKind.Separator } as any);
        items.push({
          label: '$(add) Create New Branch...',
          description: 'from current branch',
          action: 'create',
        });
        items.push({
          label: '$(git-branch) Create New Branch From...',
          description: 'select a base branch',
          action: 'create-from',
        });
        items.push({
          label: '$(debug-disconnect) Checkout Detached...',
          description: 'detach HEAD at a commit',
          action: 'detach',
        });

        // Local branches section
        items.push({ label: 'Local Branches', kind: vscode.QuickPickItemKind.Separator } as any);

        for (const gb of gitBranches) {
          const isCurrent = gb.name === currentBranch;
          items.push({
            label: `${isCurrent ? '$(check) ' : ''}${gb.name}`,
            description: getLakebaseInfo(gb.name),
            detail: gb.tracking ? `tracking: ${gb.tracking}` : undefined,
            branchName: gb.name,
          });
        }

        // Remote branches section
        if (remoteBranches.length > 0) {
          items.push({ label: 'Remote Branches', kind: vscode.QuickPickItemKind.Separator } as any);

          for (const rb of remoteBranches) {
            items.push({
              label: `$(cloud) ${rb.name}`,
              description: getLakebaseInfo(rb.name),
              detail: `remote: ${rb.tracking}`,
              branchName: rb.name,
              isRemote: true,
            });
          }
        }

        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a branch or tag to checkout',
          title: 'Switch Branch (Code + Database)',
        });

        if (!pick) { return; }

        if (pick.action === 'create') {
          // Delegate to the unified branch creation command
          vscode.commands.executeCommand('lakebaseSync.createUnifiedBranch');
          return;
        }

        if (pick.action === 'create-from') {
          // Pick a base branch first
          const basePick = await vscode.window.showQuickPick(
            gitBranches.map(gb => ({
              label: gb.name,
              description: gb.name === currentBranch ? '(current)' : undefined,
            })),
            { placeHolder: 'Select base branch' }
          );
          if (!basePick) { return; }

          const branchName = await vscode.window.showInputBox({
            prompt: `New branch name (from ${basePick.label})`,
            placeHolder: 'feature/my-feature',
          });
          if (!branchName) { return; }

          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Creating ${branchName} from ${basePick.label}...` },
            async (progress) => {
              // Checkout base, then create new branch
              progress.report({ message: 'Checking out base...' });
              await gitService.checkoutBranch(basePick.label);
              progress.report({ message: 'Creating branch...' });
              await gitService.checkoutBranch(branchName, true);
              // Auto-branch creation listener will handle Lakebase
            }
          );
          return;
        }

        if (pick.action === 'detach') {
          const ref = await vscode.window.showInputBox({
            prompt: 'Commit SHA, tag, or ref to detach at',
            placeHolder: 'HEAD~1, v1.0, abc1234',
          });
          if (!ref) { return; }
          const root = getWorkspaceRoot();
          if (root) {
            const cp = require('child_process');
            cp.execSync(`git checkout --detach "${ref}"`, { cwd: root });
            vscode.window.showInformationMessage(`Detached HEAD at ${ref}`);
            statusBarProvider.refresh();
            branchTreeProvider.refresh();
          }
          return;
        }

        // Switch to selected branch
        if (pick.branchName && pick.branchName !== currentBranch) {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Switching to ${pick.branchName}...` },
            async (progress) => {
              if (pick.isRemote) {
                // Checkout remote branch — creates a local tracking branch
                progress.report({ message: `Checking out remote branch ${pick.branchName}...` });
                const root = getWorkspaceRoot();
                if (root) {
                  const cp = require('child_process');
                  cp.execSync(`git checkout -b "${pick.branchName}" --track "origin/${pick.branchName}"`, { cwd: root, timeout: 10000 });
                }
              } else {
                progress.report({ message: 'Checking out...' });
                await gitService.checkoutBranch(pick.branchName!);
              }
              // The onBranchChanged listener handles .env sync and Lakebase connection
            }
          );
        }
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('local changes') && msg.includes('overwritten by checkout')) {
          const action = await vscode.window.showWarningMessage(
            'Cannot switch branch — you have uncommitted changes that would be overwritten.',
            'Stash & Switch', 'Commit First', 'Cancel'
          );
          if (action === 'Stash & Switch') {
            try {
              await gitService.stash('Auto-stash before branch switch');
              vscode.window.showInformationMessage('Changes stashed. Please try switching again.');
            } catch (stashErr: any) {
              vscode.window.showErrorMessage(`Failed to stash: ${stashErr.message}`);
            }
          } else if (action === 'Commit First') {
            vscode.commands.executeCommand('lakebaseSync.commit');
          }
        } else {
          vscode.window.showErrorMessage(`Branch switch failed: ${msg}`);
        }
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.showPrSchemaDiff', async () => {
      try {
        const pr = schemaScmProvider.getLastPrInfo();
        if (!pr) {
          vscode.window.showInformationMessage('No open PR for current branch.');
          return;
        }

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Fetching PR schema diff...' },
          async () => {
            const comments = await gitService.getPullRequestComments();
            let schemaDiffComment = comments.find(c =>
              c.body.includes('Schema') && (c.body.includes('CREATED') || c.body.includes('MODIFIED') ||
              c.body.includes('REMOVED') || c.body.includes('No schema changes') || c.body.includes('schema diff'))
            );

            if (!schemaDiffComment) {
              // No comment — try live pg_dump against the CI branch
              const ciBranchName = `ci-pr-${pr.number}`;
              let liveDiff: any;
              try {
                liveDiff = await schemaDiffService.compareBranchSchemas(ciBranchName, true);
              } catch { /* ignore */ }

              if (liveDiff && !liveDiff.error && (liveDiff.created.length > 0 || liveDiff.modified.length > 0 || liveDiff.removed.length > 0)) {
                // Build schema diff text from live pg_dump
                const lines: string[] = [];
                for (const t of liveDiff.created) {
                  lines.push(`+ TABLE ${t.name} (CREATED)`);
                  if (t.columns) { t.columns.forEach((c: any) => lines.push(`    ${c.name} ${c.dataType}`)); }
                }
                for (const t of liveDiff.modified) {
                  lines.push(`~ TABLE ${t.name} (MODIFIED)`);
                  if (t.addedColumns) { t.addedColumns.forEach((c: any) => lines.push(`  + ${c.name} ${c.dataType}`)); }
                  if (t.removedColumns) { t.removedColumns.forEach((c: any) => lines.push(`  - ${c.name} ${c.dataType}`)); }
                }
                for (const t of liveDiff.removed) { lines.push(`- TABLE ${t.name} (REMOVED)`); }

                schemaDiffComment = { author: 'live pg_dump', body: lines.join('\n') };
              } else {
                const ciMsg = pr.ciStatus === 'pending'
                  ? `PR #${pr.number}: CI is still running. Schema diff will be available when CI completes.`
                  : `PR #${pr.number}: No schema changes detected on ci-pr-${pr.number}.`;
                vscode.window.showInformationMessage(ciMsg, 'Open PR').then(action => {
                  if (action === 'Open PR') { vscode.env.openExternal(vscode.Uri.parse(pr.url)); }
                });
                return;
              }
            }

            const panel = vscode.window.createWebviewPanel(
              'prSchemaDiff',
              `PR #${pr.number} Schema Diff`,
              vscode.ViewColumn.Active,
              { enableScripts: false }
            );

            const ciBranch = `ci-pr-${pr.number}`;
            panel.webview.html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
  h1 { font-size: 1.3em; margin: 0 0 4px; }
  .meta { color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.85em; font-weight: 600; }
  .status.success { background: rgba(76,175,80,0.15); color: #4caf50; }
  .status.failure { background: rgba(244,67,54,0.15); color: #f44336; }
  .status.pending { background: rgba(255,152,0,0.15); color: #ff9800; }
  pre { background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; overflow-x: auto; font-size: 0.9em; white-space: pre-wrap; }
  a { color: var(--vscode-textLink-foreground); }
</style></head><body>
  <h1>PR #${pr.number}: ${pr.title.replace(/</g, '&lt;')}</h1>
  <div class="meta">
    <span class="status ${pr.ciStatus}">${pr.ciStatus.toUpperCase()}</span>
    CI branch: <strong>${ciBranch}</strong> |
    <a href="${pr.url}">Open on GitHub</a>
  </div>
  <h2>Schema Diff from CI</h2>
  <pre>${schemaDiffComment.body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body></html>`;
          }
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to fetch PR schema diff: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.mergePullRequest', async () => {
      try {
        const pr = schemaScmProvider.getLastPrInfo();
        if (!pr) {
          vscode.window.showInformationMessage('No open PR for current branch.');
          return;
        }

        // Pick merge method
        const method = await vscode.window.showQuickPick(
          [
            { label: '$(git-merge) Merge', description: 'Create a merge commit', value: 'merge' as const },
            { label: '$(git-commit) Squash and Merge', description: 'Squash all commits into one', value: 'squash' as const },
            { label: '$(git-branch) Rebase and Merge', description: 'Rebase commits onto base', value: 'rebase' as const },
          ],
          { placeHolder: `Merge PR #${pr.number}: ${pr.title}` }
        );
        if (!method) { return; }

        const confirm = await vscode.window.showWarningMessage(
          `${method.label.replace(/\$\([^)]+\)\s*/, '')} PR #${pr.number} into ${pr.baseBranch}? The remote branch will be deleted.`,
          { modal: true },
          'Merge'
        );
        if (confirm !== 'Merge') { return; }

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Merging PR #${pr.number}...` },
          async (progress) => {
            // Refresh CI secrets before merge so the merge workflow has a fresh token
            progress.report({ message: 'Syncing CI secrets...' });
            const root = getWorkspaceRoot();
            if (root) {
              try {
                const cp = require('child_process');
                const fs = require('fs');
                const path = require('path');
                const envContent = fs.readFileSync(path.join(root, '.env'), 'utf-8');
                const getEnvVal = (key: string) => {
                  const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'));
                  return match ? match[1].trim() : '';
                };
                const host = getEnvVal('DATABRICKS_HOST');
                const projectId = getEnvVal('LAKEBASE_PROJECT_ID');
                if (host) { cp.execSync(`gh secret set DATABRICKS_HOST --body "${host}"`, { cwd: root, timeout: 10000 }); }
                if (projectId) { cp.execSync(`gh secret set LAKEBASE_PROJECT_ID --body "${projectId}"`, { cwd: root, timeout: 10000 }); }
                try {
                  const tokenRaw = cp.execSync(
                    `databricks tokens create --comment "CI merge" --lifetime-seconds 3600 -o json`,
                    { cwd: root, timeout: 15000, env: { ...process.env, DATABRICKS_HOST: host } }
                  ).toString();
                  const token = JSON.parse(tokenRaw).token_value || JSON.parse(tokenRaw).token || '';
                  if (token) { cp.execSync(`gh secret set DATABRICKS_TOKEN --body "${token}"`, { cwd: root, timeout: 10000 }); }
                } catch {
                  const existingToken = getEnvVal('DATABRICKS_TOKEN');
                  if (existingToken) { cp.execSync(`gh secret set DATABRICKS_TOKEN --body "${existingToken}"`, { cwd: root, timeout: 10000 }); }
                }
              } catch { /* non-fatal */ }
            }

            progress.report({ message: 'Merging...' });
            await gitService.mergePullRequest(method.value, true);

            progress.report({ message: 'Switching to main...' });
            await gitService.checkoutBranch(pr.baseBranch);

            progress.report({ message: 'Pulling latest...' });
            await gitService.pull();
          }
        );

        schemaDiffService.clearCache();

        const msg = `PR #${pr.number} merged into ${pr.baseBranch}. CI will apply migrations to production and clean up Lakebase branches.`;
        const action = await vscode.window.showInformationMessage(msg, 'Open PR');
        if (action === 'Open PR') {
          vscode.env.openExternal(vscode.Uri.parse(pr.url));
        }

        statusBarProvider.refresh();
        branchTreeProvider.refresh();
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Merge failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.refreshPrStatus', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Refreshing PR status...' },
          async () => {
            const pr = await gitService.getPullRequest();
            if (pr) {
              vscode.window.showInformationMessage(
                `PR #${pr.number}: ${pr.ciStatus === 'success' ? 'CI passed' : pr.ciStatus === 'failure' ? 'CI failed' : 'CI running...'}`
              );
            } else {
              vscode.window.showInformationMessage('No open PR for current branch.');
            }
          }
        );
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to refresh PR status: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.healthCheck', async () => {
      const root = getWorkspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const fs = require('fs');
      const path = require('path');
      const cp = require('child_process');

      const results: { label: string; ok: boolean; detail: string }[] = [];

      // 1. Check CI workflows
      const prYml = path.join(root, '.github/workflows/pr.yml');
      const mergeYml = path.join(root, '.github/workflows/merge.yml');
      results.push({
        label: 'PR workflow (pr.yml)',
        ok: fs.existsSync(prYml),
        detail: fs.existsSync(prYml) ? 'Found' : 'Missing — CI will not create Lakebase branches on PR',
      });
      results.push({
        label: 'Merge workflow (merge.yml)',
        ok: fs.existsSync(mergeYml),
        detail: fs.existsSync(mergeYml) ? 'Found' : 'Missing — production migrations and branch cleanup will not run on merge',
      });

      // 2. Check .env
      const envPath = path.join(root, '.env');
      const envExists = fs.existsSync(envPath);
      const envConfig = envExists ? require('fs').readFileSync(envPath, 'utf-8') : '';
      results.push({
        label: 'LAKEBASE_PROJECT_ID in .env',
        ok: envConfig.includes('LAKEBASE_PROJECT_ID=') && !envConfig.includes('LAKEBASE_PROJECT_ID=\n'),
        detail: envConfig.includes('LAKEBASE_PROJECT_ID=') ? 'Set' : 'Missing — extension cannot connect to Lakebase',
      });
      results.push({
        label: 'DATABRICKS_HOST in .env',
        ok: envConfig.includes('DATABRICKS_HOST=') && !envConfig.includes('DATABRICKS_HOST=\n'),
        detail: envConfig.includes('DATABRICKS_HOST=') ? 'Set' : 'Missing — extension cannot connect to workspace',
      });

      // 3. Check Databricks CLI
      let cliOk = false;
      try {
        cp.execSync('databricks --version', { timeout: 5000 });
        cliOk = true;
      } catch { /* ignore */ }
      results.push({
        label: 'Databricks CLI',
        ok: cliOk,
        detail: cliOk ? 'Installed' : 'Not found — install and run "databricks auth login"',
      });

      // 4. Check CLI auth
      let authOk = false;
      if (cliOk) {
        try {
          const authStatus = await lakebaseService.checkAuth();
          authOk = authStatus.authenticated;
        } catch { /* ignore */ }
      }
      results.push({
        label: 'Databricks auth',
        ok: authOk,
        detail: authOk ? 'Authenticated' : 'Not authenticated — run "databricks auth login"',
      });

      // 5. Check gh CLI
      let ghOk = false;
      try {
        cp.execSync('gh --version', { timeout: 5000 });
        ghOk = true;
      } catch { /* ignore */ }
      results.push({
        label: 'GitHub CLI (gh)',
        ok: ghOk,
        detail: ghOk ? 'Installed' : 'Not found — needed for PR creation',
      });

      // 6. Check GitHub secrets (requires gh + repo access)
      let secretsChecked = false;
      const missingSecrets: string[] = [];
      if (ghOk) {
        try {
          const secretsRaw = cp.execSync('gh secret list', { cwd: root, timeout: 10000 }).toString();
          secretsChecked = true;
          for (const name of ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'LAKEBASE_PROJECT_ID']) {
            if (!secretsRaw.includes(name)) {
              missingSecrets.push(name);
            }
          }
        } catch { /* no repo access or not a gh repo */ }
      }
      if (secretsChecked) {
        results.push({
          label: 'GitHub repo secrets',
          ok: missingSecrets.length === 0,
          detail: missingSecrets.length === 0
            ? 'DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID all set'
            : `Missing: ${missingSecrets.join(', ')} — CI workflows will fail`,
        });
      }

      // 7. Check migration directory
      const config = getConfig();
      const migDir = path.join(root, config.migrationPath);
      results.push({
        label: 'Migration directory',
        ok: fs.existsSync(migDir),
        detail: fs.existsSync(migDir) ? `Found: ${config.migrationPath}` : `Missing: ${config.migrationPath}`,
      });

      // 8. Check git hooks
      const hookPath = path.join(root, '.git/hooks/post-checkout');
      results.push({
        label: 'Post-checkout hook',
        ok: fs.existsSync(hookPath),
        detail: fs.existsSync(hookPath) ? 'Installed' : 'Missing — run scripts/install-hook.sh',
      });

      // Display results
      const passed = results.filter(r => r.ok).length;
      const total = results.length;
      const allOk = passed === total;

      const lines = results.map(r =>
        `${r.ok ? '✅' : '❌'} **${r.label}** — ${r.detail}`
      );

      const panel = vscode.window.createWebviewPanel(
        'lakebaseHealthCheck',
        'Lakebase Health Check',
        vscode.ViewColumn.Active,
        { enableScripts: false }
      );

      const statusColor = allOk ? '#4caf50' : '#ff9800';
      const statusText = allOk ? 'All checks passed' : `${passed}/${total} checks passed`;

      panel.webview.html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
  h1 { font-size: 1.4em; margin-bottom: 4px; }
  .status { color: ${statusColor}; font-weight: 600; margin-bottom: 16px; }
  .item { padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .ok { color: var(--vscode-testing-iconPassed, #4caf50); }
  .fail { color: var(--vscode-errorForeground, #f44336); }
  .label { font-weight: 600; }
  .detail { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
</style></head><body>
  <h1>Lakebase Health Check</h1>
  <div class="status">${statusText}</div>
  ${results.map(r => `
    <div class="item">
      <span class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✅' : '❌'}</span>
      <span class="label">${r.label}</span>
      <div class="detail">${r.detail}</div>
    </div>
  `).join('')}
</body></html>`;
    }),

    vscode.commands.registerCommand('lakebaseSync.createPullRequest', async () => {
      try {
        const currentBranch = await gitService.getCurrentBranch();
        if (!currentBranch || currentBranch === 'main' || currentBranch === 'master') {
          vscode.window.showWarningMessage('Cannot create a PR from main/master.');
          return;
        }

        // Check for commits ahead of main — PR requires at least one
        try {
          const { ahead } = await gitService.getAheadBehind();
          if (ahead === 0) {
            const uncommitted = (await gitService.getStagedChanges()).length + (await gitService.getUnstagedChanges()).length;
            if (uncommitted > 0) {
              const action = await vscode.window.showWarningMessage(
                `No commits on this branch yet. You have ${uncommitted} uncommitted change${uncommitted !== 1 ? 's' : ''} — commit them first.`,
                'Commit Now', 'Cancel'
              );
              if (action === 'Commit Now') {
                vscode.commands.executeCommand('lakebaseSync.commit');
              }
              return;
            }
            vscode.window.showWarningMessage('No commits between main and this branch. Nothing to create a PR for.');
            return;
          }
        } catch { /* ignore — let gh pr create handle it */ }

        // Pre-flight: ensure GitHub secrets are set and fresh for CI
        const root = getWorkspaceRoot();
        if (root) {
          try {
            const cp = require('child_process');
            const secretsRaw = cp.execSync('gh secret list', { cwd: root, timeout: 10000 }).toString();
            const missingSecrets: string[] = [];
            for (const name of ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'LAKEBASE_PROJECT_ID']) {
              if (!secretsRaw.includes(name)) { missingSecrets.push(name); }
            }

            if (missingSecrets.length > 0) {
              // Secrets missing — offer to set them automatically
              const action = await vscode.window.showWarningMessage(
                `Missing GitHub secrets: ${missingSecrets.join(', ')}. CI needs these to create Lakebase branches.`,
                'Set Secrets Automatically', 'Cancel'
              );
              if (action !== 'Set Secrets Automatically') { return; }
            }

            // Always refresh secrets to ensure the token is current
            await vscode.window.withProgress(
              { location: vscode.ProgressLocation.Notification, title: 'Syncing CI secrets...' },
              async () => {
                const envConfig = require('fs').readFileSync(require('path').join(root, '.env'), 'utf-8');
                const getEnvVal = (key: string) => {
                  const match = envConfig.match(new RegExp(`^${key}=(.+)$`, 'm'));
                  return match ? match[1].trim() : '';
                };

                const host = getEnvVal('DATABRICKS_HOST');
                const projectId = getEnvVal('LAKEBASE_PROJECT_ID');

                if (host) {
                  cp.execSync(`gh secret set DATABRICKS_HOST --body "${host}"`, { cwd: root, timeout: 10000 });
                }
                if (projectId) {
                  cp.execSync(`gh secret set LAKEBASE_PROJECT_ID --body "${projectId}"`, { cwd: root, timeout: 10000 });
                }

                // Generate a fresh token for CI
                try {
                  const tokenRaw = cp.execSync(
                    `databricks tokens create --comment "GitHub Actions CI" --lifetime-seconds 86400 -o json`,
                    { cwd: root, timeout: 15000, env: { ...process.env, DATABRICKS_HOST: host } }
                  ).toString();
                  const token = JSON.parse(tokenRaw).token_value || JSON.parse(tokenRaw).token || '';
                  if (token) {
                    cp.execSync(`gh secret set DATABRICKS_TOKEN --body "${token}"`, { cwd: root, timeout: 10000 });
                  }
                } catch {
                  // Token creation may fail — use existing if available
                  const existingToken = getEnvVal('DATABRICKS_TOKEN');
                  if (existingToken) {
                    cp.execSync(`gh secret set DATABRICKS_TOKEN --body "${existingToken}"`, { cwd: root, timeout: 10000 });
                  }
                }
              }
            );
            vscode.window.showInformationMessage('CI secrets synced.');
          } catch (secretErr: any) {
            // Non-fatal — warn but continue
            const action = await vscode.window.showWarningMessage(
              `Could not sync CI secrets: ${secretErr.message}. CI may not create Lakebase branches.`,
              'Continue Anyway', 'Cancel'
            );
            if (action !== 'Continue Anyway') { return; }
          }
        }

        const title = await vscode.window.showInputBox({
          prompt: 'Pull request title',
          value: currentBranch.replace(/[-_/]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        });
        if (!title) { return; }

        const body = await vscode.window.showInputBox({
          prompt: 'Pull request description (optional)',
          placeHolder: 'Describe your changes...',
        });

        // Find the Lakebase branch name for context
        let lakebaseBranchId: string | undefined;
        try {
          const lb = await lakebaseService.getBranchByName(currentBranch);
          lakebaseBranchId = lb?.branchId;
        } catch { /* ignore */ }

        // Build PR body with Lakebase context
        const prBody = [
          body || '',
          '',
          '---',
          `**Lakebase branch:** ${lakebaseBranchId || 'none'}`,
          `> CI will automatically create a \`ci-pr-<N>\` Lakebase branch for testing.`,
        ].join('\n');

        const prUrl = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Creating pull request...' },
          async (progress) => {
            progress.report({ message: 'Pushing branch...' });
            const url = await gitService.createPullRequest(title, prBody);
            return url;
          }
        );

        // Refresh immediately so PR view appears
        statusBarProvider.refresh();
        branchTreeProvider.refresh();
        schemaScmProvider.refresh();
        await pullRequestTreeProvider.forceRefresh();

        const ciMsg = lakebaseBranchId
          ? `PR created → CI will create ci-pr-<N> Lakebase branch. Dev branch: ${lakebaseBranchId}`
          : 'PR created → CI will create ci-pr-<N> Lakebase branch.';

        const action = await vscode.window.showInformationMessage(
          ciMsg,
          'Open PR'
        );
        if (action === 'Open PR' && prUrl) {
          vscode.env.openExternal(vscode.Uri.parse(prUrl));
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Create PR failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.publishBranch', async () => {
      try {
        const currentBranch = await gitService.getCurrentBranch();
        let lakebaseBranchId: string | undefined;

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Publishing ${currentBranch}...` },
          async (progress) => {
            progress.report({ message: 'Pushing to remote...' });
            await gitService.publishBranch();

            // Sync Lakebase connection if branch exists
            if (currentBranch && currentBranch !== 'main' && currentBranch !== 'master') {
              try {
                progress.report({ message: 'Syncing Lakebase...' });
                const lb = await lakebaseService.getBranchByName(currentBranch);
                if (lb) {
                  lakebaseBranchId = lb.branchId;
                  const ep = await lakebaseService.getEndpoint(lb.branchId);
                  if (ep?.host) {
                    const cred = await lakebaseService.getCredential(lb.branchId);
                    updateEnvConnection({ host: ep.host, branchId: lb.branchId, username: cred.email, password: cred.token });
                  }
                }
              } catch { /* Lakebase sync is optional */ }
            }
          }
        );

        const msg = lakebaseBranchId
          ? `Published ${currentBranch} → Lakebase: ${lakebaseBranchId}`
          : `Published ${currentBranch} (no Lakebase branch)`;
        vscode.window.showInformationMessage(msg);
        statusBarProvider.refresh();
        branchTreeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Publish failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.sync', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Syncing...' },
          async () => {
            await gitService.sync();
            // Refresh Lakebase credentials after sync
            const currentBranch = await gitService.getCurrentBranch();
            if (currentBranch && currentBranch !== 'main' && currentBranch !== 'master') {
              try {
                const lb = await lakebaseService.getBranchByName(currentBranch);
                if (lb) {
                  const ep = await lakebaseService.getEndpoint(lb.branchId);
                  if (ep?.host) {
                    const cred = await lakebaseService.getCredential(lb.branchId);
                    updateEnvConnection({ host: ep.host, branchId: lb.branchId, username: cred.email, password: cred.token });
                  }
                }
              } catch { /* Lakebase sync is optional */ }
            }
          }
        );
        vscode.window.showInformationMessage('Synced successfully.');
        schemaScmProvider.refresh();
        statusBarProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Sync failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.fetch', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Fetching...' },
          () => gitService.fetch()
        );
        vscode.window.showInformationMessage('Fetched successfully.');
        branchTreeProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Fetch failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.fetchPrune', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Fetching (prune)...' },
          () => gitService.fetchPrune()
        );
        vscode.window.showInformationMessage('Fetched (pruned).');
        branchTreeProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Fetch failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.fetchAll', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Fetching from all remotes...' },
          () => gitService.fetchAll()
        );
        vscode.window.showInformationMessage('Fetched from all remotes.');
        branchTreeProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Fetch failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.pullRebase', async () => {
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Pulling (rebase)...' },
          () => gitService.pullRebase()
        );
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Pulled (rebase).');
        schemaScmProvider.refresh();
        statusBarProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Pull (rebase) failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.pullFrom', async () => {
      const remotes = await gitService.listRemotes();
      if (remotes.length === 0) { vscode.window.showWarningMessage('No remotes configured.'); return; }
      const remote = remotes.length === 1 ? remotes[0] :
        (await vscode.window.showQuickPick(remotes, { placeHolder: 'Select remote' }));
      if (!remote) { return; }
      const branch = await vscode.window.showInputBox({ prompt: `Branch to pull from ${remote}`, placeHolder: 'main' });
      if (!branch) { return; }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Pulling from ${remote}/${branch}...` },
          () => gitService.pullFrom(remote, branch)
        );
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage(`Pulled from ${remote}/${branch}.`);
        schemaScmProvider.refresh();
        statusBarProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Pull failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.pushTo', async () => {
      const remotes = await gitService.listRemotes();
      if (remotes.length === 0) { vscode.window.showWarningMessage('No remotes configured.'); return; }
      const remote = remotes.length === 1 ? remotes[0] :
        (await vscode.window.showQuickPick(remotes, { placeHolder: 'Select remote' }));
      if (!remote) { return; }
      const currentBranch = await gitService.getCurrentBranch();
      const branch = await vscode.window.showInputBox({ prompt: `Branch to push to ${remote}`, value: currentBranch });
      if (!branch) { return; }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Pushing to ${remote}/${branch}...` },
          () => gitService.pushTo(remote, branch)
        );
        vscode.window.showInformationMessage(`Pushed to ${remote}/${branch}.`);
        statusBarProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Push failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stash', async () => {
      const message = await vscode.window.showInputBox({
        prompt: 'Stash message (optional)',
        placeHolder: 'WIP: description',
      });
      // undefined = cancelled, empty string = no message (both are valid)
      if (message === undefined) { return; }
      try {
        await gitService.stash(message || undefined);
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Changes stashed.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Stash failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashPop', async () => {
      try {
        await gitService.stashPop();
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Stash popped.');
        schemaScmProvider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(`Pop stash failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.commitSignedOff', async () => {
      const scm = schemaScmProvider.getScm();
      if (!scm) { return; }
      const message = scm.inputBox.value;
      if (!message.trim()) { vscode.window.showWarningMessage('Enter a commit message.'); return; }
      try {
        await gitService.commitSignedOff(message);
        scm.inputBox.value = '';
        vscode.window.showInformationMessage('Committed (signed off).');
        schemaScmProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Commit failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.commitStagedSignedOff', async () => {
      vscode.commands.executeCommand('lakebaseSync.commitSignedOff');
    }),

    vscode.commands.registerCommand('lakebaseSync.commitAllSignedOff', async () => {
      const scm = schemaScmProvider.getScm();
      if (!scm) { return; }
      const message = scm.inputBox.value;
      if (!message.trim()) { vscode.window.showWarningMessage('Enter a commit message.'); return; }
      try {
        await gitService.commitAllSignedOff(message);
        scm.inputBox.value = '';
        vscode.window.showInformationMessage('All changes committed (signed off).');
        schemaScmProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Commit failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.viewStash', async () => {
      const stashes = await gitService.stashList();
      if (stashes.length === 0) { vscode.window.showInformationMessage('No stash entries.'); return; }
      const pick = await vscode.window.showQuickPick(
        stashes.map(s => ({ label: s })),
        { placeHolder: 'Select stash to view' }
      );
      if (!pick) { return; }
      // Extract stash index from label (e.g. "stash@{0}: ...")
      const match = pick.label.match(/stash@\{(\d+)\}/);
      const index = match ? match[1] : '0';
      const root = getWorkspaceRoot();
      if (root) {
        const terminal = vscode.window.createTerminal('Stash View');
        terminal.show();
        terminal.sendText(`git stash show -p stash@{${index}}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.createTag', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Tag name', placeHolder: 'v1.0.0' });
      if (!name) { return; }
      const message = await vscode.window.showInputBox({ prompt: 'Tag message (optional)', placeHolder: 'Release v1.0.0' });
      try {
        await gitService.createTag(name, message || undefined);
        vscode.window.showInformationMessage(`Tag "${name}" created.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Create tag failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.deleteTag', async () => {
      const tags = await gitService.listTags();
      if (tags.length === 0) {
        vscode.window.showInformationMessage('No tags found.');
        return;
      }
      const pick = await vscode.window.showQuickPick(tags, { placeHolder: 'Select tag to delete' });
      if (!pick) { return; }
      const confirm = await vscode.window.showWarningMessage(`Delete tag "${pick}"?`, { modal: true }, 'Delete');
      if (confirm !== 'Delete') { return; }
      try {
        await gitService.deleteTag(pick);
        vscode.window.showInformationMessage(`Tag "${pick}" deleted.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Delete tag failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.deleteRemoteTag', async () => {
      const tags = await gitService.listTags();
      if (tags.length === 0) { vscode.window.showInformationMessage('No tags found.'); return; }
      const pick = await vscode.window.showQuickPick(tags, { placeHolder: 'Select tag to delete from remote' });
      if (!pick) { return; }
      const confirm = await vscode.window.showWarningMessage(`Delete remote tag "${pick}"? This cannot be undone.`, { modal: true }, 'Delete');
      if (confirm !== 'Delete') { return; }
      try {
        await gitService.deleteRemoteTag(pick);
        vscode.window.showInformationMessage(`Remote tag "${pick}" deleted.`);
      } catch (err: any) { vscode.window.showErrorMessage(`Delete remote tag failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashStaged', async () => {
      const message = await vscode.window.showInputBox({ prompt: 'Stash message (optional)', placeHolder: 'WIP' });
      if (message === undefined) { return; }
      try {
        await gitService.stashStaged(message || undefined);
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Staged changes stashed.');
        schemaScmProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Stash failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashIncludeUntracked', async () => {
      const message = await vscode.window.showInputBox({ prompt: 'Stash message (optional)', placeHolder: 'WIP' });
      if (message === undefined) { return; }
      try {
        await gitService.stashIncludeUntracked(message || undefined);
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Changes stashed (including untracked).');
        schemaScmProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Stash failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashApply', async () => {
      const stashes = await gitService.stashList();
      if (stashes.length === 0) { vscode.window.showInformationMessage('No stash entries.'); return; }
      const pick = await vscode.window.showQuickPick(
        stashes.map((s, i) => ({ label: s, index: i })),
        { placeHolder: 'Select stash to apply' }
      );
      if (!pick) { return; }
      try {
        await gitService.stashApply((pick as any).index);
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Stash applied.');
        schemaScmProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Apply stash failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashApplyLatest', async () => {
      try {
        await gitService.stashApply(0);
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Latest stash applied.');
        schemaScmProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Apply stash failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashPopLatest', async () => {
      try {
        await gitService.stashPop();
        schemaDiffService.clearCache();
        vscode.window.showInformationMessage('Latest stash popped.');
        schemaScmProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Pop stash failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashDrop', async () => {
      const stashes = await gitService.stashList();
      if (stashes.length === 0) { vscode.window.showInformationMessage('No stash entries.'); return; }
      const pick = await vscode.window.showQuickPick(
        stashes.map((s, i) => ({ label: s, index: i })),
        { placeHolder: 'Select stash to drop' }
      );
      if (!pick) { return; }
      const confirm = await vscode.window.showWarningMessage(`Drop "${pick.label}"?`, { modal: true }, 'Drop');
      if (confirm !== 'Drop') { return; }
      try {
        await gitService.stashDrop((pick as any).index);
        vscode.window.showInformationMessage('Stash dropped.');
      } catch (err: any) { vscode.window.showErrorMessage(`Drop stash failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.stashDropAll', async () => {
      const confirm = await vscode.window.showWarningMessage('Drop ALL stashes? This cannot be undone.', { modal: true }, 'Drop All');
      if (confirm !== 'Drop All') { return; }
      try {
        await gitService.stashDropAll();
        vscode.window.showInformationMessage('All stashes dropped.');
      } catch (err: any) { vscode.window.showErrorMessage(`Drop all failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.createWorktree', async () => {
      const branchName = await vscode.window.showInputBox({
        prompt: 'New branch name for worktree',
        placeHolder: 'feature/worktree-branch',
      });
      if (!branchName) { return; }
      const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        title: 'Select parent directory for worktree',
      });
      if (!folders || folders.length === 0) { return; }
      const worktreePath = `${folders[0].fsPath}/${branchName.replace(/\//g, '-')}`;
      try {
        await gitService.createWorktree(worktreePath, branchName);
        const action = await vscode.window.showInformationMessage(
          `Worktree created at ${worktreePath}`, 'Open Folder'
        );
        if (action === 'Open Folder') {
          vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), true);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Create worktree failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.listWorktrees', async () => {
      const worktrees = await gitService.listWorktrees();
      if (worktrees.length === 0) {
        vscode.window.showInformationMessage('No worktrees found.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        worktrees.map(w => ({ label: w })),
        { placeHolder: 'Worktrees' }
      );
      if (pick) {
        const path = pick.label.split(/\s+/)[0];
        vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path), true);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.removeWorktree', async () => {
      const worktrees = await gitService.listWorktrees();
      // First entry is the main worktree — skip it
      const removable = worktrees.slice(1);
      if (removable.length === 0) {
        vscode.window.showInformationMessage('No removable worktrees.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        removable.map(w => ({ label: w })),
        { placeHolder: 'Select worktree to remove' }
      );
      if (!pick) { return; }
      const path = pick.label.split(/\s+/)[0];
      const confirm = await vscode.window.showWarningMessage(`Remove worktree at ${path}?`, { modal: true }, 'Remove');
      if (confirm !== 'Remove') { return; }
      try {
        await gitService.removeWorktree(path);
        vscode.window.showInformationMessage(`Worktree removed.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Remove worktree failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.abortRebase', async () => {
      try {
        await gitService.abortRebase();
        vscode.window.showInformationMessage('Rebase aborted.');
        schemaScmProvider.refresh();
        statusBarProvider.refresh();
        vscode.commands.executeCommand('setContext', 'lakebaseSync.isRebasing', false);
      } catch (err: any) { vscode.window.showErrorMessage(`Abort rebase failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.rebaseBranch', async () => {
      const branches = await gitService.listLocalBranches();
      const currentBranch = await gitService.getCurrentBranch();
      const others = branches.filter(b => b.name !== currentBranch);
      const pick = await vscode.window.showQuickPick(
        others.map(b => ({ label: b.name })),
        { placeHolder: 'Select branch to rebase onto' }
      );
      if (!pick) { return; }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Rebasing onto ${pick.label}...` },
          () => gitService.rebaseBranch(pick.label)
        );
        vscode.window.showInformationMessage(`Rebased onto ${pick.label}.`);
        schemaScmProvider.refresh();
        statusBarProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Rebase failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.createBranchFrom', async () => {
      const branches = await gitService.listLocalBranches();
      const currentBranch = await gitService.getCurrentBranch();
      const basePick = await vscode.window.showQuickPick(
        branches.map(b => ({ label: b.name, description: b.name === currentBranch ? '(current)' : undefined })),
        { placeHolder: 'Select base branch' }
      );
      if (!basePick) { return; }
      const branchName = await vscode.window.showInputBox({
        prompt: `New branch name (from ${basePick.label})`,
        placeHolder: 'feature/my-feature',
      });
      if (!branchName) { return; }
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Creating ${branchName} from ${basePick.label}...` },
          async () => {
            await gitService.checkoutBranch(basePick.label);
            await gitService.checkoutBranch(branchName, true);
          }
        );
      } catch (err: any) { vscode.window.showErrorMessage(`Create branch failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.deleteRemoteBranch', async () => {
      const remoteBranches = await gitService.listRemoteBranches();
      if (remoteBranches.length === 0) { vscode.window.showInformationMessage('No remote branches to delete.'); return; }
      const pick = await vscode.window.showQuickPick(
        remoteBranches.map(b => ({ label: b.name, description: b.tracking })),
        { placeHolder: 'Select remote branch to delete' }
      );
      if (!pick) { return; }
      const confirm = await vscode.window.showWarningMessage(`Delete remote branch "${pick.label}"? This cannot be undone.`, { modal: true }, 'Delete');
      if (confirm !== 'Delete') { return; }
      try {
        await gitService.deleteRemoteBranch(pick.label);
        // Also delete Lakebase branch
        try {
          const lb = await lakebaseService.getBranchByName(pick.label);
          if (lb) {
            await lakebaseService.deleteBranch(lb.branchId);
            vscode.window.showInformationMessage(`Remote branch "${pick.label}" and Lakebase branch "${lb.branchId}" deleted.`);
          } else {
            vscode.window.showInformationMessage(`Remote branch "${pick.label}" deleted.`);
          }
        } catch {
          vscode.window.showInformationMessage(`Remote branch "${pick.label}" deleted.`);
        }
        branchTreeProvider.refresh();
      } catch (err: any) { vscode.window.showErrorMessage(`Delete remote branch failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.addRemote', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Remote name', placeHolder: 'upstream' });
      if (!name) { return; }
      const url = await vscode.window.showInputBox({ prompt: 'Remote URL', placeHolder: 'https://github.com/user/repo.git' });
      if (!url) { return; }
      try {
        await gitService.addRemote(name, url);
        vscode.window.showInformationMessage(`Remote "${name}" added.`);
      } catch (err: any) { vscode.window.showErrorMessage(`Add remote failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.removeRemote', async () => {
      const remotes = await gitService.listRemotes();
      if (remotes.length === 0) { vscode.window.showInformationMessage('No remotes configured.'); return; }
      const pick = await vscode.window.showQuickPick(remotes, { placeHolder: 'Select remote to remove' });
      if (!pick) { return; }
      const confirm = await vscode.window.showWarningMessage(`Remove remote "${pick}"?`, { modal: true }, 'Remove');
      if (confirm !== 'Remove') { return; }
      try {
        await gitService.removeRemote(pick);
        vscode.window.showInformationMessage(`Remote "${pick}" removed.`);
      } catch (err: any) { vscode.window.showErrorMessage(`Remove remote failed: ${err.message}`); }
    }),

    vscode.commands.registerCommand('lakebaseSync.clone', async () => {
      const repoUrl = await vscode.window.showInputBox({
        prompt: 'Repository URL',
        placeHolder: 'https://github.com/user/repo.git',
      });
      if (!repoUrl) { return; }
      const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        title: 'Select parent directory to clone into',
      });
      if (!folders || folders.length === 0) { return; }
      const parentDir = folders[0].fsPath;
      try {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Cloning repository...' },
          async () => {
            const cp = require('child_process');
            cp.execSync(`git clone "${repoUrl}"`, { cwd: parentDir, timeout: 120000 });
          }
        );
        // Extract repo name from URL
        const repoName = repoUrl.replace(/\.git$/, '').split('/').pop() || 'repo';
        const clonedPath = require('path').join(parentDir, repoName);
        const action = await vscode.window.showInformationMessage(`Cloned ${repoName}`, 'Open Folder');
        if (action === 'Open Folder') {
          vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(clonedPath));
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Clone failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('lakebaseSync.showGitOutput', async () => {
      const root = getWorkspaceRoot();
      if (!root) { return; }
      const terminal = vscode.window.createTerminal('Git Output');
      terminal.show();
      terminal.sendText('git log --oneline --graph --decorate -30');
    }),
  );

  // Background credential refresh (every 20 minutes)
  let credentialRefreshTimer: NodeJS.Timeout | undefined;

  function startCredentialRefresh() {
    if (credentialRefreshTimer) { clearInterval(credentialRefreshTimer); }

    const cfg = getConfig();
    if (!cfg.autoRefreshCredentials) { return; }

    const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

    credentialRefreshTimer = setInterval(async () => {
      try {
        const currentBranch = await gitService.getCurrentBranch();
        if (!currentBranch) { return; }

        const isMain = currentBranch === 'main' || currentBranch === 'master';
        const lb = isMain
          ? await lakebaseService.getDefaultBranch()
          : await lakebaseService.getBranchByName(currentBranch);

        if (!lb) { return; }

        const ep = await lakebaseService.getEndpoint(lb.branchId);
        if (!ep?.host) { return; }

        const cred = await lakebaseService.getCredential(lb.branchId);
        updateEnvConnection({
          host: ep.host,
          branchId: lb.branchId,
          username: cred.email,
          password: cred.token,
        });
      } catch {
        // Silently fail — don't interrupt the user
      }
    }, REFRESH_INTERVAL_MS);
  }

  startCredentialRefresh();

  // Restart credential refresh when setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('lakebaseSync.autoRefreshCredentials')) {
        if (getConfig().autoRefreshCredentials) {
          startCredentialRefresh();
        } else if (credentialRefreshTimer) {
          clearInterval(credentialRefreshTimer);
          credentialRefreshTimer = undefined;
        }
      }
    })
  );

  // Disposables
  context.subscriptions.push(
    { dispose: () => { if (credentialRefreshTimer) { clearInterval(credentialRefreshTimer); } } },
    schemaContentProvider,
    { dispose: () => gitService.dispose() },
    { dispose: () => statusBarProvider.dispose() },
    { dispose: () => branchTreeProvider.dispose() },
    { dispose: () => schemaDiffProvider.dispose() },
    { dispose: () => schemaScmProvider.dispose() }
  );

  // Initial refresh
  statusBarProvider.refresh();
}

export function deactivate() {
  // Cleanup handled by disposables
}
