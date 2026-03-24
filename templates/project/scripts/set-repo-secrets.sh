#!/usr/bin/env bash
# Set the three repository secrets (DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID)
# using either the GitHub CLI or the REST API (Python script).
# Usage:
#   Option A - GitHub CLI (easiest): ensure 'gh' is installed and run 'gh auth login'.
#     export DATABRICKS_HOST=... DATABRICKS_TOKEN=... LAKEBASE_PROJECT_ID=...
#     ./scripts/set-repo-secrets.sh
#   Option B - REST API: use the Python script (see docs/github-secrets-api.md).
#     export GITHUB_TOKEN=... DATABRICKS_HOST=... DATABRICKS_TOKEN=... LAKEBASE_PROJECT_ID=...
#     python3 scripts/set-repo-secrets-api.py

set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || true
cd "${REPO_ROOT:-.}"

DATABRICKS_HOST="${DATABRICKS_HOST:-}"
DATABRICKS_TOKEN="${DATABRICKS_TOKEN:-}"
LAKEBASE_PROJECT_ID="${LAKEBASE_PROJECT_ID:-}"

if [ -z "$DATABRICKS_HOST" ] || [ -z "$DATABRICKS_TOKEN" ] || [ -z "$LAKEBASE_PROJECT_ID" ]; then
  echo "Set DATABRICKS_HOST, DATABRICKS_TOKEN, and LAKEBASE_PROJECT_ID (environment or .env)."
  echo "Note: CI and this script need DATABRICKS_TOKEN even if you use \`databricks auth login\` locally."
  echo "  Automated: run ./scripts/create-token-and-sync-secrets.sh (creates token via CLI and syncs secrets; requires prior \`databricks auth login\` and LAKEBASE_PROJECT_ID in .env)."
  echo "  Manual: create a token (Settings → Developer → Access tokens or \`databricks tokens create\`), add to .env, then run ./scripts/set-repo-secrets.sh"
  echo "  Or use the API script: GITHUB_TOKEN=... python3 scripts/set-repo-secrets-api.py"
  exit 1
fi

if command -v gh >/dev/null 2>&1; then
  echo "Using GitHub CLI (gh secret set)..."
  gh secret set DATABRICKS_HOST --body "$DATABRICKS_HOST"
  gh secret set DATABRICKS_TOKEN --body "$DATABRICKS_TOKEN"
  gh secret set LAKEBASE_PROJECT_ID --body "$LAKEBASE_PROJECT_ID"
  echo "Done. Verify in: Settings → Secrets and variables → Actions"
  exit 0
fi

if [ -n "${GITHUB_TOKEN:-}" ] && python3 -c "import nacl" 2>/dev/null; then
  echo "Using GitHub REST API (scripts/set-repo-secrets-api.py)..."
  exec python3 "$(dirname "$0")/set-repo-secrets-api.py"
fi

echo "Install the GitHub CLI (gh) and run 'gh auth login', then re-run this script."
echo "Or set GITHUB_TOKEN and install PyNaCl (pip install pynacl), then run: python3 scripts/set-repo-secrets-api.py"
exit 1
