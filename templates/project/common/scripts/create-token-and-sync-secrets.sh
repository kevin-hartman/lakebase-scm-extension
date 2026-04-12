#!/usr/bin/env bash
# DEPRECATED: Use ./scripts/setup-ci-auth.sh instead (service principal auth — credentials don't expire).
#
# Create a Databricks PAT via CLI and sync it to GitHub repo secrets.
# PATs expire based on workspace policy (often hours, not the requested 30 days).
# For headless CI/CD, use setup-ci-auth.sh which creates a service principal.
#
# Prereq: run `databricks auth login` first. LAKEBASE_PROJECT_ID must be set (e.g. in .env).
# Usage: ./scripts/create-token-and-sync-secrets.sh

echo "WARNING: PAT auth is deprecated for CI/CD. PATs expire based on workspace policy."
echo "         Use ./scripts/setup-ci-auth.sh instead (service principal — credentials don't expire)."
echo ""

set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || true
cd "${REPO_ROOT:-.}"
SCRIPT_DIR="$(dirname "$0")"

# Load .env so LAKEBASE_PROJECT_ID (and optionally DATABRICKS_HOST) are available
if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi

# Require jq and databricks
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install with: brew install jq (or apt-get install jq)"
  exit 1
fi
if ! command -v databricks >/dev/null 2>&1; then
  echo "databricks CLI is required. Install and run: databricks auth login"
  exit 1
fi

# Resolve DATABRICKS_HOST from auth env if not set
if [ -z "${DATABRICKS_HOST:-}" ]; then
  AUTH_JSON="$(databricks auth env -o json 2>/dev/null)" || true
  DATABRICKS_HOST="$(echo "${AUTH_JSON:-}" | jq -r '.env.DATABRICKS_HOST // empty' 2>/dev/null)" || true
fi
if [ -z "${DATABRICKS_HOST:-}" ]; then
  echo "DATABRICKS_HOST not set and could not be read from 'databricks auth env'. Run 'databricks auth login' or set DATABRICKS_HOST in .env"
  exit 1
fi

# LAKEBASE_PROJECT_ID must be set (e.g. in .env)
if [ -z "${LAKEBASE_PROJECT_ID:-}" ]; then
  echo "LAKEBASE_PROJECT_ID is required. Set it in .env or export it, then re-run this script."
  exit 1
fi

# Resolve CLI profile for this workspace
PROFILE=""
if [ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]; then
  PROFILE="--profile ${DATABRICKS_CONFIG_PROFILE}"
elif grep -q "$(echo "$DATABRICKS_HOST" | sed 's|https://||; s|/$||')" ~/.databrickscfg 2>/dev/null; then
  PROFILE="--profile $(grep -B1 "$(echo "$DATABRICKS_HOST" | sed 's|https://||; s|/$||')" ~/.databrickscfg 2>/dev/null | head -1 | tr -d '[]')"
fi

# Get OAuth token (preferred — works on all workspaces including those with PATs disabled)
echo "Getting OAuth token..."
TOKEN_VALUE="$(databricks auth token $PROFILE -o json 2>/dev/null | jq -r '.access_token // empty')" || true

# Fallback: create a PAT (works on workspaces that allow PATs)
if [ -z "$TOKEN_VALUE" ]; then
  echo "OAuth token not available. Trying PAT..."
  REPO_NAME="$(basename "$(git remote get-url origin 2>/dev/null)" 2>/dev/null | sed 's/\.git$//')" || REPO_NAME="repo"
  COMMENT="GitHub Actions ($REPO_NAME)"
  LIFETIME_SECONDS="${TOKEN_LIFETIME_SECONDS:-2592000}"
  CREATE_OUT="$(databricks tokens create --comment "$COMMENT" --lifetime-seconds "$LIFETIME_SECONDS" -o json 2>&1)" || true
  TOKEN_VALUE="$(echo "$CREATE_OUT" | jq -r '.token_value // .token // empty' 2>/dev/null)" || true
fi

if [ -z "$TOKEN_VALUE" ]; then
  echo "Failed to get OAuth token or create PAT. Run 'databricks auth login' first."
  exit 1
fi

export DATABRICKS_HOST
export DATABRICKS_TOKEN="$TOKEN_VALUE"
export LAKEBASE_PROJECT_ID
echo "Token synced. Syncing DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID to GitHub repo secrets..."
echo "Note: OAuth tokens are short-lived (~1h). The pre-push hook refreshes them automatically."
exec "$SCRIPT_DIR/set-repo-secrets.sh"
