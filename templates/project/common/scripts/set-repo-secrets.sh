#!/usr/bin/env bash
# Set repository secrets for CI/CD workflows using either the GitHub CLI or the REST API.
#
# Supports two auth modes:
#   Service principal (recommended): DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, LAKEBASE_PROJECT_ID
#   PAT (legacy):                    DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID
#
# Usage:
#   Option A - GitHub CLI (easiest): ensure 'gh' is installed and run 'gh auth login'.
#     export DATABRICKS_HOST=... DATABRICKS_CLIENT_ID=... DATABRICKS_CLIENT_SECRET=... LAKEBASE_PROJECT_ID=...
#     ./scripts/set-repo-secrets.sh
#   Option B - Automated setup: run ./scripts/setup-ci-auth.sh (creates SP + syncs secrets in one step).
#   Option C - REST API: use the Python script (see docs/github-secrets-api.md).

set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || true
cd "${REPO_ROOT:-.}"

DATABRICKS_HOST="${DATABRICKS_HOST:-}"
DATABRICKS_CLIENT_ID="${DATABRICKS_CLIENT_ID:-}"
DATABRICKS_CLIENT_SECRET="${DATABRICKS_CLIENT_SECRET:-}"
DATABRICKS_TOKEN="${DATABRICKS_TOKEN:-}"
LAKEBASE_PROJECT_ID="${LAKEBASE_PROJECT_ID:-}"

# Determine auth mode
AUTH_MODE=""
if [ -n "$DATABRICKS_CLIENT_ID" ] && [ -n "$DATABRICKS_CLIENT_SECRET" ]; then
  AUTH_MODE="service-principal"
elif [ -n "$DATABRICKS_TOKEN" ]; then
  AUTH_MODE="pat"
fi

if [ -z "$DATABRICKS_HOST" ] || [ -z "$AUTH_MODE" ] || [ -z "$LAKEBASE_PROJECT_ID" ]; then
  echo "Missing required secrets. Provide one of:"
  echo ""
  echo "  Service principal (recommended — credentials don't expire):"
  echo "    DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, LAKEBASE_PROJECT_ID"
  echo "    Automated: ./scripts/setup-ci-auth.sh"
  echo ""
  echo "  PAT (legacy — tokens expire):"
  echo "    DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID"
  echo "    Automated: ./scripts/create-token-and-sync-secrets.sh"
  exit 1
fi

if command -v gh >/dev/null 2>&1; then
  echo "Using GitHub CLI (gh secret set)..."
  gh secret set DATABRICKS_HOST --body "$DATABRICKS_HOST"
  gh secret set LAKEBASE_PROJECT_ID --body "$LAKEBASE_PROJECT_ID"

  if [ "$AUTH_MODE" = "service-principal" ]; then
    gh secret set DATABRICKS_CLIENT_ID --body "$DATABRICKS_CLIENT_ID"
    gh secret set DATABRICKS_CLIENT_SECRET --body "$DATABRICKS_CLIENT_SECRET"
    # Clean up PAT if switching to SP
    if gh secret list 2>/dev/null | grep -q "DATABRICKS_TOKEN"; then
      echo "Removing old DATABRICKS_TOKEN (replaced by service principal)..."
      gh secret delete DATABRICKS_TOKEN 2>/dev/null || true
    fi
    echo "Done (service principal auth). Verify in: Settings → Secrets and variables → Actions"
  else
    gh secret set DATABRICKS_TOKEN --body "$DATABRICKS_TOKEN"
    echo "Done (PAT auth). Verify in: Settings → Secrets and variables → Actions"
    echo "Note: PATs expire. Consider switching to service principal: ./scripts/setup-ci-auth.sh"
  fi
  exit 0
fi

if [ -n "${GITHUB_TOKEN:-}" ] && python3 -c "import nacl" 2>/dev/null; then
  echo "Using GitHub REST API (scripts/set-repo-secrets-api.py)..."
  exec python3 "$(dirname "$0")/set-repo-secrets-api.py"
fi

echo "Install the GitHub CLI (gh) and run 'gh auth login', then re-run this script."
echo "Or set GITHUB_TOKEN and install PyNaCl (pip install pynacl), then run: python3 scripts/set-repo-secrets-api.py"
exit 1
