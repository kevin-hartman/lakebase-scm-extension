#!/usr/bin/env bash
# Run Flyway migrate using the branch URL from .env (post-checkout hook writes it).
# Usage: ./scripts/flyway-migrate.sh [extra mvn args]
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
./mvnw flyway:migrate "$@"
