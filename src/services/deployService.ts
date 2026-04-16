import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../utils/exec';
import { getWorkspaceRoot } from '../utils/config';

export interface DeployTarget {
  workspace_profile: string;
  workspace_path: string;
  app_name: string;
  lakebase_project: string;
  lakebase_branch: string;
}

export interface DeployTargetsConfig {
  targets: Record<string, DeployTarget>;
}

export type DeployPhase = 'build' | 'config' | 'upload' | 'deploy' | 'done';
type ProgressCallback = (message: string, phase?: DeployPhase) => void;

/**
 * Service for deploying applications to Databricks Apps.
 *
 * Workflow:
 * 1. Build frontend (if client/ exists)
 * 2. Update app.yaml with target's Lakebase config
 * 3. Upload source files to Databricks workspace (per-file for reliability)
 * 4. Deploy the Databricks App
 */
export class DeployService {
  /**
   * Read deploy-targets.yaml from the workspace root.
   * Uses a lightweight YAML parser for the fixed config structure.
   */
  static readTargets(workspaceRoot?: string): DeployTargetsConfig | null {
    const root = workspaceRoot || getWorkspaceRoot();
    if (!root) { return null; }
    const targetsFile = path.join(root, 'deploy-targets.yaml');
    if (!fs.existsSync(targetsFile)) { return null; }
    const content = fs.readFileSync(targetsFile, 'utf-8');
    return DeployService.parseTargetsYaml(content);
  }

  /**
   * Parse deploy-targets.yaml content.
   * Handles the fixed structure: targets → target_name → key: value
   */
  static parseTargetsYaml(content: string): DeployTargetsConfig {
    const targets: Record<string, DeployTarget> = {};
    let currentTarget: string | null = null;
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed || trimmed.startsWith('#')) { continue; }

      // Top-level "targets:" — skip
      if (trimmed === 'targets:') { continue; }

      // Target name (2-space indent, ends with colon)
      const targetMatch = trimmed.match(/^  (\S+):$/);
      if (targetMatch) {
        currentTarget = targetMatch[1];
        targets[currentTarget] = {} as DeployTarget;
        continue;
      }

      // Key-value pair (4-space indent)
      const kvMatch = trimmed.match(/^    (\S+):\s*"?([^"]*)"?\s*$/);
      if (kvMatch && currentTarget) {
        const key = kvMatch[1] as keyof DeployTarget;
        targets[currentTarget][key] = kvMatch[2];
      }
    }

    return { targets };
  }

  /**
   * Write deploy-targets.yaml back to the workspace root.
   */
  static writeTargets(config: DeployTargetsConfig, workspaceRoot?: string): void {
    const root = workspaceRoot || getWorkspaceRoot();
    if (!root) { throw new Error('No workspace root found'); }
    const targetsFile = path.join(root, 'deploy-targets.yaml');
    let yaml = 'targets:\n';
    for (const [name, target] of Object.entries(config.targets)) {
      yaml += `  ${name}:\n`;
      yaml += `    workspace_profile: ${target.workspace_profile}\n`;
      yaml += `    workspace_path: ${target.workspace_path}\n`;
      yaml += `    app_name: ${target.app_name}\n`;
      yaml += `    lakebase_project: ${target.lakebase_project}\n`;
      yaml += `    lakebase_branch: ${target.lakebase_branch}\n`;
    }
    fs.writeFileSync(targetsFile, yaml);
  }

  /**
   * Get available target names.
   */
  static getTargetNames(workspaceRoot?: string): string[] {
    const config = DeployService.readTargets(workspaceRoot);
    if (!config?.targets) { return []; }
    return Object.keys(config.targets);
  }

  /**
   * Resolve the workspace host URL from a Databricks CLI profile.
   */
  static async resolveWorkspaceHost(profile: string): Promise<string | undefined> {
    try {
      const raw = await exec(`databricks auth env --profile "${profile}"`);
      const env = JSON.parse(raw);
      return env.DATABRICKS_HOST?.replace(/\/+$/, '');
    } catch {
      return undefined;
    }
  }

  static async deploy(
    targetName: string,
    workspaceRoot?: string,
    progress?: ProgressCallback,
  ): Promise<{ success: boolean; appUrl?: string; workspaceHost?: string; error?: string }> {
    const root = workspaceRoot || getWorkspaceRoot();
    if (!root) {
      return { success: false, error: 'No workspace root found' };
    }

    const config = DeployService.readTargets(root);
    if (!config?.targets?.[targetName]) {
      return { success: false, error: `Target "${targetName}" not found in deploy-targets.yaml` };
    }

    const target = config.targets[targetName];
    const { workspace_profile: profile, workspace_path: wsPath, app_name: appName,
            lakebase_project: lbProject, lakebase_branch: lbBranch } = target;

    // Resolve workspace host for console URLs
    let workspaceHost: string | undefined;
    try {
      workspaceHost = await DeployService.resolveWorkspaceHost(profile);
    } catch {
      // Non-critical — deploy still works without clickable links
    }

    try {
      // Step 1: Build frontend (if client/ exists)
      const clientDir = path.join(root, 'client');
      if (fs.existsSync(path.join(clientDir, 'package.json'))) {
        progress?.('Building frontend...', 'build');
        await exec('npm run build', { cwd: clientDir, timeout: 120000 });
      }

      // Step 2: Update app.yaml with target's Lakebase config
      const appYamlPath = path.join(root, 'app.yaml');
      if (fs.existsSync(appYamlPath)) {
        progress?.('Updating app.yaml...', 'config');
        let appYamlContent = fs.readFileSync(appYamlPath, 'utf-8');
        appYamlContent = appYamlContent.replace(
          /(LAKEBASE_PROJECT_ID['"]\s*\n\s*value:\s*)"[^"]*"/,
          `$1"${lbProject}"`
        );
        appYamlContent = appYamlContent.replace(
          /(LAKEBASE_BRANCH_ID['"]\s*\n\s*value:\s*)"[^"]*"/,
          `$1"${lbBranch}"`
        );
        fs.writeFileSync(appYamlPath, appYamlContent);
      }

      // Step 3: Upload source files (per-file for reliability)
      // IMPORTANT: databricks workspace import-dir does NOT reliably update
      // Python files. Always use per-file workspace import --overwrite.
      progress?.('Uploading source to workspace...', 'upload');
      const uploadCount = await DeployService.uploadSource(root, wsPath, profile, progress);
      progress?.(`Uploaded ${uploadCount} files`, 'upload');

      // Step 4: Deploy the app (apps deploy waits for completion — allow 10 minutes)
      progress?.(`Deploying ${appName}...`, 'deploy');
      await exec(
        `databricks apps deploy "${appName}" --source-code-path "${wsPath}" --profile "${profile}"`,
        { cwd: root, timeout: 600000 }
      );

      // Extract app URL
      let appUrl: string | undefined;
      try {
        const getOutput = await exec(
          `databricks apps get "${appName}" --profile "${profile}"`,
          { cwd: root }
        );
        const appInfo = JSON.parse(getOutput);
        appUrl = appInfo.url;
      } catch {
        // Non-critical
      }

      return { success: true, appUrl, workspaceHost };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /**
   * Upload project source files to workspace, per-file for reliability.
   */
  private static async uploadSource(
    projectRoot: string,
    workspacePath: string,
    profile: string,
    progress?: ProgressCallback,
  ): Promise<number> {
    let count = 0;
    const createdDirs = new Set<string>();

    const ensureRemoteDir = async (remoteDirPath: string) => {
      if (createdDirs.has(remoteDirPath)) { return; }
      await exec(
        `databricks workspace mkdirs "${remoteDirPath}" --profile "${profile}"`
      );
      createdDirs.add(remoteDirPath);
    };

    const uploadFile = async (relPath: string) => {
      const localPath = path.join(projectRoot, relPath);
      const remotePath = `${workspacePath}/${relPath}`;
      // Ensure the parent directory exists in the workspace
      const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
      if (remoteDir !== workspacePath) {
        await ensureRemoteDir(remoteDir);
      }
      await exec(
        `databricks workspace import "${remotePath}" --file "${localPath}" --format AUTO --overwrite --profile "${profile}"`
      );
      count++;
    };

    // Upload root config files
    for (const f of ['app.yaml', 'pyproject.toml', 'uv.lock', 'alembic.ini', 'package.json']) {
      if (fs.existsSync(path.join(projectRoot, f))) {
        await uploadFile(f);
      }
    }

    // Upload app/ directory (Python source)
    progress?.('Uploading app/ ...');
    await DeployService.uploadDir(projectRoot, 'app', uploadFile, ['.py']);

    // Upload alembic/ directory (migrations)
    progress?.('Uploading alembic/ ...');
    await DeployService.uploadDir(projectRoot, 'alembic', uploadFile, ['.py', '.ini', '.mako']);

    // Upload static/ directory (built frontend)
    if (fs.existsSync(path.join(projectRoot, 'static'))) {
      progress?.('Uploading static/ ...');
      await DeployService.uploadDir(projectRoot, 'static', uploadFile);
    }

    return count;
  }

  /**
   * Recursively upload files from a directory, optionally filtered by extension.
   */
  private static async uploadDir(
    projectRoot: string,
    dirRelPath: string,
    uploadFn: (relPath: string) => Promise<void>,
    extensions?: string[],
  ): Promise<void> {
    const fullDir = path.join(projectRoot, dirRelPath);
    if (!fs.existsSync(fullDir)) { return; }

    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const relPath = path.join(dirRelPath, entry.name);
      if (entry.isDirectory()) {
        await DeployService.uploadDir(projectRoot, relPath, uploadFn, extensions);
      } else if (!extensions || extensions.some(ext => entry.name.endsWith(ext))) {
        await uploadFn(relPath);
      }
    }
  }
}
