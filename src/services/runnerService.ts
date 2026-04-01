/**
 * Self-Hosted GitHub Actions Runner Service
 *
 * Manages a persistent local runner for each Lakebase project.
 * Runner binary is cached at ~/.cache/github-actions-runner/.
 * Runner instances live at ~/.lakebase/runners/{project-name}/.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';

const RUNNER_VERSION = '2.333.1';
const RUNNER_ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const RUNNER_OS = process.platform === 'darwin' ? 'osx' : 'linux';
const RUNNER_ARCHIVE = `actions-runner-${RUNNER_OS}-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz`;
const RUNNER_URL = `https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${RUNNER_ARCHIVE}`;
const CACHE_DIR = path.join(os.homedir(), '.cache', 'github-actions-runner');
const RUNNERS_DIR = path.join(os.homedir(), '.lakebase', 'runners');

export interface RunnerInfo {
  name: string;
  dir: string;
  pid?: number;
  online: boolean;
}

export class RunnerService {

  /** Get the runner directory for a project */
  private runnerDir(projectName: string): string {
    return path.join(RUNNERS_DIR, projectName);
  }

  /** Download runner binary if not cached. Returns path to cached archive. */
  private ensureCachedArchive(): string {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cachedPath = path.join(CACHE_DIR, RUNNER_ARCHIVE);
    if (fs.existsSync(cachedPath)) {
      return cachedPath;
    }
    cp.execSync(`curl -fsSL -o "${cachedPath}" "${RUNNER_URL}"`, { timeout: 120000 });
    return cachedPath;
  }

  /**
   * Deploy and start a self-hosted runner for a GitHub repo.
   * Idempotent — if a runner is already configured for this project, restarts it.
   *
   * @param fullRepoName - GitHub repo (e.g. "owner/my-app")
   * @param projectName - Lakebase project name (used for runner directory + name)
   * @param progress - Optional progress callback
   * @returns Runner info
   */
  async setupRunner(
    fullRepoName: string,
    projectName: string,
    progress?: (msg: string) => void,
  ): Promise<RunnerInfo> {
    const report = progress || (() => {});
    const dir = this.runnerDir(projectName);
    const runnerName = `lakebase-${projectName}`;

    // Stop existing runner if running
    this.stopRunner(projectName);

    // Extract runner binary
    report('Downloading runner binary...');
    const archive = this.ensureCachedArchive();
    fs.mkdirSync(dir, { recursive: true });

    // Only extract if not already extracted (config.sh exists)
    if (!fs.existsSync(path.join(dir, 'config.sh'))) {
      report('Extracting runner...');
      cp.execSync(`tar xzf "${archive}" -C "${dir}"`, { timeout: 60000 });
    }

    // Get registration token
    report('Registering runner with GitHub...');
    const regToken = cp.execSync(
      `gh api -X POST repos/${fullRepoName}/actions/runners/registration-token --jq '.token'`,
      { timeout: 15000 }
    ).toString().trim();

    // Configure (--replace in case previously configured)
    cp.execSync(
      `./config.sh --url "https://github.com/${fullRepoName}" --token "${regToken}" --name "${runnerName}" --labels self-hosted --unattended --replace`,
      { cwd: dir, timeout: 60000 }
    );

    // Start in background
    report('Starting runner...');
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (!env.JAVA_HOME) {
      try {
        env.JAVA_HOME = cp.execSync('/usr/libexec/java_home 2>/dev/null', { timeout: 5000 }).toString().trim();
      } catch {}
    }

    const child = cp.spawn('./run.sh', [], {
      cwd: dir,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env,
    });
    child.unref();

    // Write PID file for later management
    fs.writeFileSync(path.join(dir, '.pid'), String(child.pid));

    // Wait for runner to come online
    report('Waiting for runner to come online...');
    let online = false;
    for (let i = 0; i < 12; i++) {
      try {
        const status = cp.execSync(
          `gh api repos/${fullRepoName}/actions/runners --jq '.runners[] | select(.name == "${runnerName}") | .status'`,
          { timeout: 10000 }
        ).toString().trim();
        if (status === 'online') { online = true; break; }
      } catch {}
      cp.execSync('sleep 5');
    }

    if (!online) {
      throw new Error(`Runner "${runnerName}" did not come online within 60 seconds`);
    }

    report('Runner is online.');
    return { name: runnerName, dir, pid: child.pid, online: true };
  }

  /** Stop the runner for a project (kill process, don't deregister) */
  stopRunner(projectName: string): void {
    const dir = this.runnerDir(projectName);
    const pidFile = path.join(dir, '.pid');
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      try { process.kill(pid, 'SIGKILL'); } catch {}
      try { fs.unlinkSync(pidFile); } catch {}
    }
  }

  /** Remove the runner entirely (stop, deregister from GitHub, delete directory) */
  async removeRunner(fullRepoName: string, projectName: string): Promise<void> {
    const dir = this.runnerDir(projectName);
    const runnerName = `lakebase-${projectName}`;

    // Stop process
    this.stopRunner(projectName);

    // Wait for process to die
    cp.execSync('sleep 2');

    // Deregister via API
    try {
      const runnerId = cp.execSync(
        `gh api repos/${fullRepoName}/actions/runners --jq '.runners[] | select(.name == "${runnerName}") | .id'`,
        { timeout: 10000 }
      ).toString().trim();
      if (runnerId) {
        cp.execSync(`gh api -X DELETE repos/${fullRepoName}/actions/runners/${runnerId}`, { timeout: 10000 });
      }
    } catch {}

    // Remove directory
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  /** Check if a runner is currently running for a project */
  isRunning(projectName: string): boolean {
    const pidFile = path.join(this.runnerDir(projectName), '.pid');
    if (!fs.existsSync(pidFile)) { return false; }
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  /** Get info about a project's runner */
  getRunnerInfo(projectName: string): RunnerInfo | undefined {
    const dir = this.runnerDir(projectName);
    if (!fs.existsSync(dir)) { return undefined; }
    const pidFile = path.join(dir, '.pid');
    let pid: number | undefined;
    if (fs.existsSync(pidFile)) {
      pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    }
    return {
      name: `lakebase-${projectName}`,
      dir,
      pid,
      online: this.isRunning(projectName),
    };
  }
}
