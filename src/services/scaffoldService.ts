import * as fs from 'fs';
import * as path from 'path';
import { exec } from '../utils/exec';

/**
 * Service for scaffolding new Lakebase projects.
 * Deploys templates (scripts, workflows, hooks, config) to a project directory.
 */
export class ScaffoldService {
  private templateDir: string;

  constructor(extensionPath: string) {
    this.templateDir = path.join(extensionPath, 'templates', 'project');
  }

  /**
   * Deploy all scripts from templates/project/scripts/ to the target directory.
   * Sets executable permissions on all .sh files.
   */
  async deployScripts(targetDir: string): Promise<string[]> {
    const srcDir = path.join(this.templateDir, 'scripts');
    const destDir = path.join(targetDir, 'scripts');
    return this.copyDir(srcDir, destDir, true);
  }

  /**
   * Deploy GitHub Actions workflows from templates/project/.github/workflows/
   */
  async deployWorkflows(targetDir: string): Promise<string[]> {
    const srcDir = path.join(this.templateDir, '.github', 'workflows');
    const destDir = path.join(targetDir, '.github', 'workflows');
    return this.copyDir(srcDir, destDir, false);
  }

  /**
   * Install git hooks by running scripts/install-hook.sh in the target directory.
   * Installs: post-checkout, prepare-commit-msg, pre-push
   */
  async installHooks(targetDir: string): Promise<string> {
    const hookScript = path.join(targetDir, 'scripts', 'install-hook.sh');
    if (!fs.existsSync(hookScript)) {
      throw new Error(`install-hook.sh not found at ${hookScript}. Deploy scripts first.`);
    }
    return exec(`bash "${hookScript}"`, { cwd: targetDir });
  }

  /**
   * Deploy .env.example with placeholder values.
   * Optionally substitute real values for DATABRICKS_HOST and LAKEBASE_PROJECT_ID.
   */
  async deployEnvExample(targetDir: string, values?: { databricksHost?: string; lakebaseProjectId?: string }): Promise<void> {
    const src = path.join(this.templateDir, '.env.example');
    const dest = path.join(targetDir, '.env.example');
    let content = fs.readFileSync(src, 'utf-8');
    if (values?.databricksHost) {
      content = content.replace(/DATABRICKS_HOST=.*/, `DATABRICKS_HOST=${values.databricksHost}`);
    }
    if (values?.lakebaseProjectId) {
      content = content.replace(/LAKEBASE_PROJECT_ID=.*/, `LAKEBASE_PROJECT_ID=${values.lakebaseProjectId}`);
    }
    fs.writeFileSync(dest, content);
  }

  /**
   * Deploy .vscode/settings.json (disables built-in Git SCM).
   */
  async deployVscodeSettings(targetDir: string): Promise<void> {
    const src = path.join(this.templateDir, '.vscode', 'settings.json');
    const destDir = path.join(targetDir, '.vscode');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, 'settings.json'));
  }

  /**
   * Deploy placeholder migration file.
   */
  async deployMigrationPlaceholder(targetDir: string): Promise<void> {
    const src = path.join(this.templateDir, 'src', 'main', 'resources', 'db', 'migration', 'V1__init_placeholder.sql');
    const destDir = path.join(targetDir, 'src', 'main', 'resources', 'db', 'migration');
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, 'V1__init_placeholder.sql'));
  }

  /**
   * Deploy .gitignore from template.
   */
  async deployGitignore(targetDir: string): Promise<void> {
    const src = path.join(this.templateDir, '.gitignore');
    fs.copyFileSync(src, path.join(targetDir, '.gitignore'));
  }

  /**
   * Full scaffold: deploy everything to a target directory.
   */
  async scaffoldAll(targetDir: string, values?: { databricksHost?: string; lakebaseProjectId?: string }): Promise<{
    scripts: string[];
    workflows: string[];
    hooks: string;
  }> {
    await this.deployGitignore(targetDir);
    await this.deployEnvExample(targetDir, values);
    await this.deployVscodeSettings(targetDir);
    await this.deployMigrationPlaceholder(targetDir);
    const scripts = await this.deployScripts(targetDir);
    const workflows = await this.deployWorkflows(targetDir);
    const hooks = await this.installHooks(targetDir);
    return { scripts, workflows, hooks };
  }

  /**
   * Verify that all expected hooks are installed in .git/hooks/
   */
  verifyHooks(targetDir: string): { postCheckout: boolean; prepareCommitMsg: boolean; prePush: boolean } {
    const hooksDir = path.join(targetDir, '.git', 'hooks');
    return {
      postCheckout: fs.existsSync(path.join(hooksDir, 'post-checkout')),
      prepareCommitMsg: fs.existsSync(path.join(hooksDir, 'prepare-commit-msg')),
      prePush: fs.existsSync(path.join(hooksDir, 'pre-push')),
    };
  }

  /**
   * Verify that all expected workflow files exist.
   */
  verifyWorkflows(targetDir: string): { pr: boolean; merge: boolean } {
    const wfDir = path.join(targetDir, '.github', 'workflows');
    return {
      pr: fs.existsSync(path.join(wfDir, 'pr.yml')),
      merge: fs.existsSync(path.join(wfDir, 'merge.yml')),
    };
  }

  // ── Private ──────────────────────────────────────────────────────

  private copyDir(srcDir: string, destDir: string, makeExecutable: boolean): string[] {
    if (!fs.existsSync(srcDir)) { throw new Error(`Source directory not found: ${srcDir}`); }
    fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const srcPath = path.join(srcDir, file);
      const destPath = path.join(destDir, file);
      if (fs.statSync(srcPath).isDirectory()) {
        this.copyDir(srcPath, destPath, makeExecutable);
      } else {
        fs.copyFileSync(srcPath, destPath);
        if (makeExecutable && file.endsWith('.sh')) {
          fs.chmodSync(destPath, 0o755);
        }
      }
    }
    return files;
  }
}
