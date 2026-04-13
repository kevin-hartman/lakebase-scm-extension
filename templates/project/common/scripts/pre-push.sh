#!/usr/bin/env bash
# Pre-push hook: before pushing, ensure repository secrets
# (DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID) are set via set-repo-secrets.sh.
# Loads .env from repo root so local Lakebase config can sync to GitHub Actions secrets.
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

# Only run set-repo-secrets if we have the three vars
if [ -n "${DATABRICKS_HOST:-}" ] && [ -n "${DATABRICKS_TOKEN:-}" ] && [ -n "${LAKEBASE_PROJECT_ID:-}" ]; then
  if "$SCRIPT_DIR/set-repo-secrets.sh"; then
    echo "Pre-push: repository secrets synced."
  fi
  # If set-repo-secrets fails (e.g. no gh / no GITHUB_TOKEN), push continues anyway
fi

exit 0
