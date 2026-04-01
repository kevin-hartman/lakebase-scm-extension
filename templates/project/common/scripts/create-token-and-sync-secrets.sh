#!/usr/bin/env bash
# Create a Databricks PAT via CLI (option 1) and sync it to GitHub repo secrets.
# Prereq: run `databricks auth login` first. LAKEBASE_PROJECT_ID must be set (e.g. in .env).
# Usage: ./scripts/create-token-and-sync-secrets.sh

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

# Create token (CLI 0.205+). Use repo name in comment if available.
REPO_NAME="$(basename "$(git remote get-url origin 2>/dev/null)" 2>/dev/null | sed 's/\.git$//')" || REPO_NAME="repo"
COMMENT="GitHub Actions ($REPO_NAME)"
LIFETIME_SECONDS="${TOKEN_LIFETIME_SECONDS:-2592000}"
echo "Creating Databricks token (comment: $COMMENT, lifetime: ${LIFETIME_SECONDS}s)..."
CREATE_OUT="$(databricks tokens create --comment "$COMMENT" --lifetime-seconds "$LIFETIME_SECONDS" -o json 2>&1)" || true
TOKEN_VALUE="$(echo "$CREATE_OUT" | jq -r '.token_value // .token // empty' 2>/dev/null)" || true
if [ -z "$TOKEN_VALUE" ]; then
  echo "Failed to create or parse token. Ensure you have run 'databricks auth login' and CLI supports 'tokens create' (0.205+)."
  echo "Output: $CREATE_OUT"
  exit 1
fi

export DATABRICKS_HOST
export DATABRICKS_TOKEN="$TOKEN_VALUE"
export LAKEBASE_PROJECT_ID
echo "Token created. Syncing DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID to GitHub repo secrets..."
exec "$SCRIPT_DIR/set-repo-secrets.sh"
