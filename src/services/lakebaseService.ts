import * as cp from 'child_process';
import { getConfig } from '../utils/config';

export interface LakebaseBranch {
  /** Internal API uid (e.g. br-red-thunder-d24muck6) */
  uid: string;
  /** Full resource path (e.g. projects/.../branches/customer-entity) */
  name: string;
  /** Branch ID segment from the name path (e.g. customer-entity) */
  branchId: string;
  state: string;
  isDefault: boolean;
  endpointHost?: string;
  endpointState?: string;
}

export interface LakebaseCredential {
  token: string;
  email: string;
}

export interface AuthStatus {
  authenticated: boolean;
  currentHost: string;
  expectedHost: string;
  mismatch: boolean;
  error?: string;
}

export interface DatabricksProfile {
  name: string;
  host: string;
  cloud: string;
  authType: string;
  valid: boolean;
  hasLakebase?: boolean;
  lakebaseProjects?: Array<{ uid: string; displayName: string }>;
}

function exec(command: string, cwd?: string, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: cp.ExecOptions = { cwd, timeout: 30000 };
    if (env) {
      options.env = { ...process.env, ...env };
    }
    cp.exec(command, options, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message);
        // Tag auth/workspace errors so callers can detect them
        if (msg.includes('project id not found') || msg.includes('not authenticated') ||
            msg.includes('PERMISSION_DENIED') || msg.includes('401') ||
            msg.includes('invalid token') || msg.includes('no configuration')) {
          const authErr = new Error(msg);
          (authErr as any).isAuthError = true;
          reject(authErr);
          return;
        }
        reject(new Error(`${command}: ${msg}`));
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

function sanitizeBranchName(gitBranch: string): string {
  return gitBranch
    .replace(/\//g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .substring(0, 63);
}

export class LakebaseService {
  /** Runtime host override — set when user selects a workspace via the picker */
  private hostOverride: string | undefined;

  private projectPath(): string {
    const config = getConfig();
    return `projects/${config.lakebaseProjectId}`;
  }

  /** Get the effective host: runtime override > .env > empty */
  getEffectiveHost(): string {
    if (this.hostOverride) {
      return this.hostOverride;
    }
    const config = getConfig();
    return config.databricksHost;
  }

  /** Set a runtime host override (persists for this session) */
  setHostOverride(host: string): void {
    this.hostOverride = host.replace(/\/+$/, '');
  }

  /** Build env vars to inject DATABRICKS_HOST so CLI targets the correct workspace */
  private cliEnv(): Record<string, string> | undefined {
    const host = this.getEffectiveHost();
    if (host) {
      return { DATABRICKS_HOST: host };
    }
    return undefined;
  }

  /** Run a databricks CLI command, injecting DATABRICKS_HOST as env var */
  private dbcli(args: string, cwd?: string): Promise<string> {
    return exec(`databricks ${args}`, cwd, this.cliEnv());
  }

  async isAvailable(): Promise<boolean> {
    try {
      await exec('databricks --version');
      return true;
    } catch {
      return false;
    }
  }

  /** List all configured Databricks CLI profiles from ~/.databrickscfg */
  async listProfiles(): Promise<DatabricksProfile[]> {
    try {
      const raw = await exec('databricks auth profiles -o json');
      const parsed = JSON.parse(raw);
      const profiles: any[] = parsed.profiles || [];
      return profiles.map(p => ({
        name: p.name || '',
        host: (p.host || '').replace(/\/+$/, ''),
        cloud: p.cloud || '',
        authType: p.auth_type || '',
        valid: p.valid === true,
      }));
    } catch {
      return [];
    }
  }

  /** List profiles that have Lakebase projects available */
  async listLakebaseProfiles(): Promise<DatabricksProfile[]> {
    const profiles = await this.listProfiles();

    // Deduplicate by host (DEFAULT and named profiles often share the same host)
    const seen = new Set<string>();
    const unique = profiles.filter(p => {
      if (seen.has(p.host)) { return false; }
      seen.add(p.host);
      return true;
    });

    const results = await Promise.all(
      unique.map(async (p) => {
        if (!p.valid) {
          return { ...p, hasLakebase: false, lakebaseProjects: [] };
        }
        try {
          const raw = await exec(
            `databricks postgres list-projects -o json`,
            undefined,
            { DATABRICKS_HOST: p.host }
          );
          const parsed = JSON.parse(raw);
          const projects = (Array.isArray(parsed) ? parsed : parsed.projects || []);
          const lakebaseProjects = projects.map((proj: any) => ({
            uid: proj.uid || '',
            displayName: proj.status?.display_name || proj.name || '',
          }));
          return {
            ...p,
            hasLakebase: lakebaseProjects.length > 0,
            lakebaseProjects,
          };
        } catch {
          return { ...p, hasLakebase: false, lakebaseProjects: [] };
        }
      })
    );

    return results.filter(p => p.hasLakebase);
  }

  /** Check if CLI can reach the target workspace (using our DATABRICKS_HOST injection) */
  async checkAuth(): Promise<AuthStatus> {
    const expectedHost = this.getEffectiveHost().replace(/\/+$/, '');

    if (!expectedHost) {
      return {
        authenticated: false,
        currentHost: '',
        expectedHost: '(not configured)',
        mismatch: false,
        error: 'No DATABRICKS_HOST in .env',
      };
    }

    try {
      // Test with our env var injection — this is what all real operations use
      const userRaw = await this.dbcli('current-user me -o json');
      const user = JSON.parse(userRaw);
      const email = user.userName || user.emails?.[0]?.value || '';
      return {
        authenticated: true,
        currentHost: expectedHost,
        expectedHost,
        mismatch: false,
        error: undefined,
      };
    } catch (err: any) {
      // Auth failed against the target host — need to login
      return {
        authenticated: false,
        currentHost: '',
        expectedHost,
        mismatch: false,
        error: `Cannot authenticate to ${expectedHost}: ${err.message}`,
      };
    }
  }

  /** Get the login command string for the effective workspace */
  getLoginCommand(host?: string): string {
    const target = (host || this.getEffectiveHost()).replace(/\/+$/, '');
    if (target) {
      return `databricks auth login --host ${target}`;
    }
    return 'databricks auth login';
  }

  async listBranches(): Promise<LakebaseBranch[]> {
    const projPath = this.projectPath();
    const raw = await this.dbcli(`postgres list-branches "${projPath}" -o json`);
    const parsed = JSON.parse(raw);

    const items: any[] = Array.isArray(parsed)
      ? parsed
      : parsed.branches || parsed.items || [];

    return items.map((b: any) => {
      const fullName: string = b.name || '';
      const uid = b.uid || b.id || '';
      // Extract the branch ID segment from the full path: projects/.../branches/{branchId}
      const branchId = fullName.split('/branches/').pop() || b.branch_id || b.display_name || uid;
      return {
        uid,
        name: fullName,
        branchId,
        state: b.status?.current_state || 'UNKNOWN',
        isDefault: b.status?.default === true || b.is_default === true,
        endpointHost: undefined,
        endpointState: undefined,
      };
    });
  }

  async getDefaultBranch(): Promise<LakebaseBranch | undefined> {
    const branches = await this.listBranches();
    return branches.find(b => b.isDefault);
  }

  async getBranchByName(name: string): Promise<LakebaseBranch | undefined> {
    const branches = await this.listBranches();
    const sanitized = sanitizeBranchName(name);
    return branches.find(b =>
      b.branchId === sanitized ||
      b.branchId === name ||
      b.uid === sanitized ||
      b.uid === name ||
      b.name.endsWith(`/branches/${sanitized}`) ||
      b.name.endsWith(`/branches/${name}`)
    );
  }

  /** Resolve a branchId, uid, or name to the full resource path */
  private async resolveBranchPath(branchNameOrUid: string): Promise<string | undefined> {
    // If it already looks like a full path, use it directly
    if (branchNameOrUid.startsWith('projects/')) {
      return branchNameOrUid;
    }
    const branches = await this.listBranches();
    const branch = branches.find(b =>
      b.branchId === branchNameOrUid ||
      b.uid === branchNameOrUid ||
      b.name.endsWith(`/${branchNameOrUid}`)
    );
    return branch?.name;
  }

  async createBranch(gitBranch: string): Promise<LakebaseBranch | undefined> {
    const projPath = this.projectPath();
    const defaultBranch = await this.getDefaultBranch();
    if (!defaultBranch) {
      throw new Error('Could not find default Lakebase branch');
    }

    const branchName = sanitizeBranchName(gitBranch);
    const sourceBranch = defaultBranch.name;

    const existing = await this.getBranchByName(branchName);
    if (existing) {
      return existing;
    }

    const spec = JSON.stringify({
      spec: { source_branch: sourceBranch, no_expiry: true },
    });

    await this.dbcli(
      `postgres create-branch "${projPath}" "${branchName}" --json '${spec}'`
    );

    return this.waitForBranchReady(branchName);
  }

  async waitForBranchReady(branchName: string, maxAttempts = 24): Promise<LakebaseBranch | undefined> {
    const sanitized = sanitizeBranchName(branchName);
    for (let i = 0; i < maxAttempts; i++) {
      const branch = await this.getBranchByName(sanitized);
      if (branch && branch.state === 'READY') {
        return branch;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    return undefined;
  }

  async deleteBranch(branchNameOrUid: string): Promise<void> {
    // The CLI expects the full resource name (projects/.../branches/...), not the uid.
    // Look up the branch to get its full name.
    const branches = await this.listBranches();
    const branch = branches.find(b =>
      b.uid === branchNameOrUid ||
      b.name.endsWith(`/${branchNameOrUid}`) ||
      b.name === branchNameOrUid
    );

    if (!branch || !branch.name) {
      throw new Error(`Branch "${branchNameOrUid}" not found`);
    }

    await this.dbcli(`postgres delete-branch "${branch.name}"`);
  }

  async getEndpoint(branchNameOrUid: string): Promise<{ host: string; state: string } | undefined> {
    // Resolve to the full resource name path
    const branchPath = await this.resolveBranchPath(branchNameOrUid);
    if (!branchPath) {
      return undefined;
    }
    try {
      const raw = await this.dbcli(`postgres list-endpoints "${branchPath}" -o json`);
      const endpoints = JSON.parse(raw);
      if (Array.isArray(endpoints) && endpoints.length > 0) {
        const ep = endpoints[0];
        return {
          host: ep.status?.hosts?.host || '',
          state: ep.status?.current_state || 'UNKNOWN',
        };
      }
    } catch {
      // No endpoints
    }
    return undefined;
  }

  async getCredential(branchNameOrUid: string): Promise<LakebaseCredential> {
    const branchPath = await this.resolveBranchPath(branchNameOrUid);
    if (!branchPath) {
      throw new Error(`Branch "${branchNameOrUid}" not found`);
    }
    const endpointPath = `${branchPath}/endpoints/primary`;

    const tokenRaw = await this.dbcli(
      `postgres generate-database-credential "${endpointPath}" -o json`
    );
    const token = JSON.parse(tokenRaw).token || '';

    const userRaw = await this.dbcli('current-user me -o json');
    const userParsed = JSON.parse(userRaw);
    const email = userParsed.userName || userParsed.emails?.[0]?.value || '';

    return { token, email };
  }

  async enrichWithEndpoints(branches: LakebaseBranch[]): Promise<LakebaseBranch[]> {
    const enriched = await Promise.all(
      branches.map(async (b) => {
        try {
          const ep = await this.getEndpoint(b.uid);
          return { ...b, endpointHost: ep?.host, endpointState: ep?.state };
        } catch {
          return b;
        }
      })
    );
    return enriched;
  }

  sanitizeBranchName(name: string): string {
    return sanitizeBranchName(name);
  }

  /** Build the Databricks console URL for a Lakebase project or branch */
  getConsoleUrl(branchUid?: string): string {
    const host = this.getEffectiveHost().replace(/\/+$/, '');
    const config = getConfig();
    const projectId = config.lakebaseProjectId;
    if (!host || !projectId) {
      return '';
    }
    // Databricks Lakebase console URL pattern
    let url = `${host}/lakebase/projects/${projectId}`;
    if (branchUid) {
      url += `/branches/${branchUid}`;
    }
    return url;
  }
}
