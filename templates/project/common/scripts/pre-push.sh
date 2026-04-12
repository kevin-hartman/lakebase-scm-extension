#!/usr/bin/env bash
# Pre-push hook: before pushing, ensure repository secrets are synced to GitHub Actions.
#
# With service principal auth (recommended): syncs DATABRICKS_HOST, DATABRICKS_CLIENT_ID,
# DATABRICKS_CLIENT_SECRET, LAKEBASE_PROJECT_ID. These don't expire — sync is a safety net.
#
# With PAT auth (legacy): syncs DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID.
# PATs expire — this sync is critical to keep CI working.
#
# Install: ./scripts/install-hook.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  set +a
fi

# Determine which auth mode is configured
HAS_SP="false"
[ -n "${DATABRICKS_CLIENT_ID:-}" ] && [ -n "${DATABRICKS_CLIENT_SECRET:-}" ] && HAS_SP="true"
HAS_PAT="false"
[ -n "${DATABRICKS_TOKEN:-}" ] && HAS_PAT="true"

# Only sync if we have credentials and the project ID
if [ -n "${DATABRICKS_HOST:-}" ] && [ -n "${LAKEBASE_PROJECT_ID:-}" ] && { [ "$HAS_SP" = "true" ] || [ "$HAS_PAT" = "true" ]; }; then
  if "$SCRIPT_DIR/set-repo-secrets.sh"; then
    echo "Pre-push: repository secrets synced."
  fi
  # If set-repo-secrets fails (e.g. no gh / no GITHUB_TOKEN), push continues anyway
fi

exit 0
