#!/usr/bin/env bash
# Create a Databricks service principal for CI/CD and sync credentials to GitHub repo secrets.
# Replaces PAT-based auth with non-expiring OAuth M2M credentials so merge/PR workflows
# work headlessly without token refresh.
#
# Prerequisites:
#   - databricks auth login (workspace admin or account admin)
#   - LAKEBASE_PROJECT_ID in .env
#   - gh auth login
#
# Usage: ./scripts/setup-ci-auth.sh
#
# What it does:
#   1. Creates a service principal named "CI/CD - <repo-name>"
#   2. Generates an OAuth secret (client_id + client_secret)
#   3. Syncs DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET,
#      LAKEBASE_PROJECT_ID to GitHub repo secrets
#   4. Removes the old DATABRICKS_TOKEN secret (no longer needed)
#
# After running, the merge and PR workflows authenticate at runtime via OAuth M2M.
# No PAT rotation or pre-push secret sync required.

set -e
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || true
cd "${REPO_ROOT:-.}"

# Load .env
if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  set +a
fi

# Prerequisites
for cmd in databricks jq gh; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "setup-ci-auth: $cmd is required but not found."
    case "$cmd" in
      databricks) echo "  Install: https://docs.databricks.com/dev-tools/cli/install.html" ;;
      jq)         echo "  Install: brew install jq" ;;
      gh)         echo "  Install: brew install gh && gh auth login" ;;
    esac
    exit 1
  fi
done

# Verify Databricks auth
if ! databricks current-user me -o json >/dev/null 2>&1; then
  echo "setup-ci-auth: Databricks CLI auth failed."
  if [ -n "${DATABRICKS_CONFIG_PROFILE:-}" ]; then
    echo "  Run: databricks auth login --profile ${DATABRICKS_CONFIG_PROFILE} --host ${DATABRICKS_HOST:-<workspace-url>}"
  else
    echo "  Run: databricks auth login --host ${DATABRICKS_HOST:-<workspace-url>}"
  fi
  exit 1
fi

# Resolve DATABRICKS_HOST
if [ -z "${DATABRICKS_HOST:-}" ]; then
  AUTH_JSON="$(databricks auth env -o json 2>/dev/null)" || true
  DATABRICKS_HOST="$(echo "${AUTH_JSON:-}" | jq -r '.env.DATABRICKS_HOST // empty' 2>/dev/null)" || true
fi
if [ -z "${DATABRICKS_HOST:-}" ]; then
  echo "setup-ci-auth: DATABRICKS_HOST not set. Run 'databricks auth login' or set in .env"
  exit 1
fi

if [ -z "${LAKEBASE_PROJECT_ID:-}" ]; then
  echo "setup-ci-auth: LAKEBASE_PROJECT_ID is required. Set in .env."
  exit 1
fi

# Verify gh is authenticated
if ! gh auth status >/dev/null 2>&1; then
  echo "setup-ci-auth: GitHub CLI not authenticated. Run: gh auth login"
  exit 1
fi

# Create service principal
REPO_NAME="$(basename "$(git remote get-url origin 2>/dev/null)" 2>/dev/null | sed 's/\.git$//')" || REPO_NAME="repo"
SP_NAME="CI/CD - ${REPO_NAME}"

echo "Creating service principal: ${SP_NAME}..."
SP_JSON="$(databricks service-principals create --display-name "$SP_NAME" --active -o json 2>&1)"
SP_ID="$(echo "$SP_JSON" | jq -r '.id // empty')"
APP_ID="$(echo "$SP_JSON" | jq -r '.applicationId // .application_id // empty')"

if [ -z "$SP_ID" ] || [ -z "$APP_ID" ]; then
  echo "Failed to create service principal."
  echo "Output: $SP_JSON"
  echo ""
  echo "If this workspace requires account-level SP management, create the SP in the"
  echo "Databricks account console and add it to this workspace, then re-run this script."
  exit 1
fi
echo "  id=$SP_ID  applicationId=$APP_ID"

# Create OAuth secret
echo "Creating OAuth secret..."
SECRET_JSON="$(databricks service-principal-secrets-proxy create "$SP_ID" -o json 2>&1)"
CLIENT_SECRET="$(echo "$SECRET_JSON" | jq -r '.secret // empty')"

if [ -z "$CLIENT_SECRET" ]; then
  echo "Failed to create OAuth secret."
  echo "Output: $SECRET_JSON"
  echo "Cleaning up service principal $SP_ID..."
  databricks service-principals delete "$SP_ID" 2>/dev/null || true
  exit 1
fi
echo "  OAuth secret created (shown only once — stored directly in GitHub secrets)."

# Sync to GitHub repo secrets
echo ""
echo "Syncing to GitHub repo secrets..."
gh secret set DATABRICKS_HOST --body "$DATABRICKS_HOST"
gh secret set DATABRICKS_CLIENT_ID --body "$APP_ID"
gh secret set DATABRICKS_CLIENT_SECRET --body "$CLIENT_SECRET"
gh secret set LAKEBASE_PROJECT_ID --body "$LAKEBASE_PROJECT_ID"
echo "  Set: DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, LAKEBASE_PROJECT_ID"

# Remove old PAT secret
if gh secret list 2>/dev/null | grep -q "DATABRICKS_TOKEN"; then
  echo "Removing old DATABRICKS_TOKEN secret (replaced by service principal)..."
  gh secret delete DATABRICKS_TOKEN 2>/dev/null || true
fi

echo ""
echo "=== CI Auth Setup Complete ==="
echo "Service principal : ${SP_NAME} (id: ${SP_ID})"
echo "Application ID    : ${APP_ID}"
echo "GitHub secrets    : DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, LAKEBASE_PROJECT_ID"
echo ""
echo "Merge and PR workflows will now authenticate at runtime via OAuth M2M."
echo "No token expiry. No pre-push secret sync required."
