#!/usr/bin/env bash
# Run tests using the branch URL from .env (post-checkout hook writes it).
# Use this so tests run against the feature-branch DB, not production.
# Usage: ./scripts/run-tests.sh [extra mvn args]
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
if [ ! -f .env ]; then
  echo "No .env found. Run 'git checkout <branch>' so the hook creates/updates .env, or copy .env.example to .env and set SPRING_DATASOURCE_*."
  exit 1
fi
set -a
# shellcheck source=/dev/null
source .env 2>/dev/null || true
set +a
if [ -z "${SPRING_DATASOURCE_URL:-}" ]; then
  echo "SPRING_DATASOURCE_URL not set in .env. Run 'git checkout <branch>' to refresh, or set it in .env."
  exit 1
fi
# Export so Spring Boot (Surefire) uses these; overrides any stale application-local.properties
export SPRING_DATASOURCE_URL SPRING_DATASOURCE_USERNAME SPRING_DATASOURCE_PASSWORD
./mvnw test "$@"
