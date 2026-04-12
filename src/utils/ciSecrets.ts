import * as path from 'path';
import { exec } from './exec';

/**
 * Set up CI auth by creating a Databricks service principal and syncing
 * OAuth M2M credentials to GitHub repo secrets. Service principal credentials
 * don't expire, so CI workflows work headlessly without token refresh.
 *
 * Falls back to PAT-based auth if service principal creation fails
 * (e.g. workspace doesn't allow SP creation).
 *
 * @param root - Workspace root directory (must contain .env and scripts/setup-ci-auth.sh)
 */
export async function syncCiSecrets(root: string): Promise<void> {
  const scriptPath = path.join(root, 'scripts', 'setup-ci-auth.sh');

  try {
    await exec(`bash "${scriptPath}"`, { cwd: root, timeout: 60000 });
    return; // Service principal auth configured successfully
  } catch (err: any) {
    // SP creation failed — fall back to PAT
    const msg = err?.message || '';
    if (msg.includes('Failed to create service principal') || msg.includes('account-level SP management')) {
      // Expected failure on workspaces that restrict SP creation
    }
    // Fall through to PAT-based approach
  }

  // Fallback: PAT-based auth (deprecated — tokens expire)
  await syncCiSecretsViaPat(root);
}

/**
 * Legacy PAT-based secret sync. Creates a short-lived Databricks PAT and
 * syncs it to GitHub repo secrets. PATs expire based on workspace policy.
 */
async function syncCiSecretsViaPat(root: string): Promise<void> {
  const fs = await import('fs');
  const envContent = fs.readFileSync(path.join(root, '.env'), 'utf-8');
  const getEnvVal = (key: string): string => {
    const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].trim() : '';
  };

  const host = getEnvVal('DATABRICKS_HOST');
  const projectId = getEnvVal('LAKEBASE_PROJECT_ID');

  if (host) {
    await exec(`gh secret set DATABRICKS_HOST --body "${host}"`, { cwd: root, timeout: 30000 });
  }
  if (projectId) {
    await exec(`gh secret set LAKEBASE_PROJECT_ID --body "${projectId}"`, { cwd: root, timeout: 30000 });
  }

  // Generate a fresh Databricks token for CI
  try {
    const tokenRaw = await exec(
      `databricks tokens create --comment "GitHub Actions CI (PAT fallback)" --lifetime-seconds 2592000 -o json`,
      { cwd: root, timeout: 30000, env: { DATABRICKS_HOST: host } }
    );
    const token = JSON.parse(tokenRaw).token_value || JSON.parse(tokenRaw).token || '';
    if (token) {
      await exec(`gh secret set DATABRICKS_TOKEN --body "${token}"`, { cwd: root, timeout: 30000 });
    }
  } catch {
    // Token creation may fail — fall back to existing token from .env
    const existingToken = getEnvVal('DATABRICKS_TOKEN');
    if (existingToken) {
      await exec(`gh secret set DATABRICKS_TOKEN --body "${existingToken}"`, { cwd: root, timeout: 30000 });
    }
  }
}
