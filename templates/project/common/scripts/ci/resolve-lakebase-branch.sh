#!/usr/bin/env bash
# Resolve a Lakebase branch paired with a git branch, plus its endpoint +
# credentials + DATABASE_URL. Uses scripts/sanitize-branch-name.sh for the
# git→lakebase name mapping so CI and local dev agree (scripts/post-checkout.sh
# uses the same helper).
#
# Usage:
#   resolve-lakebase-branch.sh --git-branch <name> [flags]
#
# Flags:
#   --git-branch <name>          Git branch (main / staging / feature/x / ci-pr-N / ...)
#   --create-from <parent>       Create the Lakebase branch from <parent>'s Lakebase
#                                clone if it doesn't exist. <parent> is a GIT branch
#                                name (main / staging / ...). No-op if branch exists.
#   --lakebase-name <name>       Skip mapping — use this exact Lakebase branch name
#                                (overrides --git-branch mapping). Useful for ci-pr-N.
#   --github-env                 Append env vars to $GITHUB_ENV instead of stdout.
#   --ensure-endpoint            Create the primary endpoint if it doesn't exist.
#
# Requires env:  DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID
# Optional env:  LAKEBASE_DB_NAME (default: databricks_postgres)
#
# Outputs (shell key=value OR appended to $GITHUB_ENV):
#   LAKEBASE_BRANCH_NAME  — e.g. "staging" / "feature-foo" / "ci-pr-42"
#   LAKEBASE_BRANCH_PATH  — projects/<id>/branches/<name>
#   LAKEBASE_HOST         — endpoint hostname
#   LAKEBASE_USERNAME     — user email (OAuth "user" for psql)
#   LAKEBASE_PASSWORD     — OAuth token (secret — never echo to logs)
#   DATABASE_URL          — postgresql:// URL with embedded creds
#   JDBC_URL              — jdbc:postgresql:// URL (no creds; Java auth uses DB_USERNAME/DB_PASSWORD)

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANITIZE="${SCRIPT_DIR}/../sanitize-branch-name.sh"
[ -x "$SANITIZE" ] || {
  echo "resolve-lakebase-branch: cannot find $SANITIZE — scripts/sanitize-branch-name.sh must exist and be executable" >&2
  exit 1
}

GIT_BRANCH=""
CREATE_FROM=""
LAKEBASE_NAME_OVERRIDE=""
GH_ENV_MODE=0
ENSURE_ENDPOINT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --git-branch)    GIT_BRANCH="$2"; shift 2 ;;
    --create-from)   CREATE_FROM="$2"; shift 2 ;;
    --lakebase-name) LAKEBASE_NAME_OVERRIDE="$2"; shift 2 ;;
    --github-env)    GH_ENV_MODE=1; shift ;;
    --ensure-endpoint) ENSURE_ENDPOINT=1; shift ;;
    *) echo "resolve-lakebase-branch: unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ -n "$GIT_BRANCH" ] || [ -n "$LAKEBASE_NAME_OVERRIDE" ] || {
  echo "resolve-lakebase-branch: --git-branch or --lakebase-name required" >&2
  exit 2
}
[ -n "${LAKEBASE_PROJECT_ID:-}" ] || {
  echo "resolve-lakebase-branch: LAKEBASE_PROJECT_ID env not set" >&2
  exit 2
}

command -v databricks >/dev/null 2>&1 || { echo "databricks CLI not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq not found" >&2; exit 1; }

PROJ_PATH="projects/${LAKEBASE_PROJECT_ID}"
DB_NAME="${LAKEBASE_DB_NAME:-databricks_postgres}"

# Fetch list-branches once (expensive CLI call) and cache JSON for downstream
# jq filters. Shape varies: array root, {branches:[]}, or {items:[]}.
_BRANCHES_RAW="$(databricks postgres list-branches "$PROJ_PATH" -o json 2>/dev/null || echo "[]")"
BRANCHES_JSON="$(echo "$_BRANCHES_RAW" | jq -c '
  if type == "array" then .
  elif type == "object" then (.branches // .items // [])
  else [] end' 2>/dev/null || echo "[]")"

# Return the Lakebase branch NAME that matches a given git branch.
# main/master → Lakebase default branch (dynamic, via list-branches)
# anything else → sanitize-branch-name.sh output
git_to_lakebase_name() {
  local git="$1"
  if [ "$git" = "main" ] || [ "$git" = "master" ]; then
    echo "$BRANCHES_JSON" | jq -r '
      .[] | select((.status.default == true) or (.is_default == true))
      | (if .name then (.name | split("/") | last) else (.uid // .id // empty) end)
    ' | head -1
  else
    "$SANITIZE" "$git"
  fi
}

# Check whether a Lakebase branch with this name exists. Prints its current_state
# (READY, CREATING, etc.) or empty if not found.
branch_state() {
  local name="$1"
  echo "$BRANCHES_JSON" | jq -r --arg n "$name" '
    .[] | select(
      (.name | type == "string" and (endswith("/branches/" + $n) or (split("/") | last == $n)))
      or (.uid == $n) or (.id == $n)
    ) | .status.current_state // empty
  ' | head -1
}

# ── Resolve the target Lakebase branch name ──────────────────────
if [ -n "$LAKEBASE_NAME_OVERRIDE" ]; then
  LAKEBASE_NAME="$LAKEBASE_NAME_OVERRIDE"
else
  LAKEBASE_NAME="$(git_to_lakebase_name "$GIT_BRANCH")"
fi

[ -n "$LAKEBASE_NAME" ] || {
  echo "resolve-lakebase-branch: could not map git '$GIT_BRANCH' to a Lakebase branch name" >&2
  exit 1
}

BRANCH_PATH="${PROJ_PATH}/branches/${LAKEBASE_NAME}"

# ── Ensure the branch exists (create if requested) ───────────────
STATE="$(branch_state "$LAKEBASE_NAME")"
if [ -z "$STATE" ]; then
  if [ -n "$CREATE_FROM" ]; then
    SOURCE_NAME="$(git_to_lakebase_name "$CREATE_FROM")"
    [ -n "$SOURCE_NAME" ] || {
      echo "resolve-lakebase-branch: could not resolve source branch for '$CREATE_FROM'" >&2
      exit 1
    }
    databricks postgres create-branch "$PROJ_PATH" "$LAKEBASE_NAME" \
      --json "{\"spec\": {\"source_branch\": \"${PROJ_PATH}/branches/${SOURCE_NAME}\", \"no_expiry\": true}}" \
      >/dev/null 2>&1 || true
    # Wait for READY (up to 2 min). Re-fetch branches every 5s.
    for _ in $(seq 1 24); do
      sleep 5
      _BRANCHES_RAW="$(databricks postgres list-branches "$PROJ_PATH" -o json 2>/dev/null || echo "[]")"
      BRANCHES_JSON="$(echo "$_BRANCHES_RAW" | jq -c '
        if type == "array" then . elif type == "object" then (.branches // .items // []) else [] end')"
      STATE="$(branch_state "$LAKEBASE_NAME")"
      [ "$STATE" = "READY" ] && break
    done
    [ "$STATE" = "READY" ] || {
      echo "resolve-lakebase-branch: branch '$LAKEBASE_NAME' did not reach READY (state: ${STATE:-unknown})" >&2
      exit 1
    }
  else
    echo "resolve-lakebase-branch: branch '$LAKEBASE_NAME' does not exist and --create-from not given" >&2
    exit 1
  fi
fi

# ── Get (or ensure) the primary endpoint ─────────────────────────
HOST="$(databricks postgres list-endpoints "$BRANCH_PATH" -o json 2>/dev/null \
  | jq -r '.[0].status.hosts.host // empty')"

if [ -z "$HOST" ] && [ "$ENSURE_ENDPOINT" = "1" ]; then
  databricks postgres create-endpoint "$BRANCH_PATH" "primary" \
    --json '{"spec": {"endpoint_type": "ENDPOINT_TYPE_READ_WRITE", "autoscaling_limit_min_cu": 2, "autoscaling_limit_max_cu": 4}}' \
    >/dev/null 2>&1 || true
  for _ in $(seq 1 24); do
    EP_STATE="$(databricks postgres list-endpoints "$BRANCH_PATH" -o json 2>/dev/null \
      | jq -r '.[0].status.current_state // empty')"
    [ "$EP_STATE" = "ACTIVE" ] && break
    sleep 5
  done
  HOST="$(databricks postgres list-endpoints "$BRANCH_PATH" -o json 2>/dev/null \
    | jq -r '.[0].status.hosts.host // empty')"
fi

[ -n "$HOST" ] || {
  echo "resolve-lakebase-branch: no endpoint for '$LAKEBASE_NAME' (pass --ensure-endpoint to create)" >&2
  exit 1
}

# ── Mint credentials ─────────────────────────────────────────────
TOKEN="$(databricks postgres generate-database-credential "${BRANCH_PATH}/endpoints/primary" -o json 2>/dev/null \
  | jq -r '.token // empty')"
EMAIL="$(databricks current-user me -o json 2>/dev/null \
  | jq -r '.userName // .emails[0].value // empty')"

[ -n "$TOKEN" ] && [ -n "$EMAIL" ] || {
  echo "resolve-lakebase-branch: could not mint credentials for '$LAKEBASE_NAME'" >&2
  exit 1
}

# URL-encode chars that break postgres:// parsing (rare in tokens but safe)
ENCODED_PASS="$(printf '%s' "$TOKEN" | sed 's/@/%40/g; s/:/%3A/g; s/\//%2F/g; s/?/%3F/g; s/#/%23/g')"
PG_URL="postgresql://${EMAIL}:${ENCODED_PASS}@${HOST}:5432/${DB_NAME}?sslmode=require"
JDBC_URL="jdbc:postgresql://${HOST}:5432/${DB_NAME}?sslmode=require"

# ── Emit output ──────────────────────────────────────────────────
# GH env mode writes each var to $GITHUB_ENV. Multi-line-safe for tokens
# via heredoc delimiter. Stdout mode emits shell key=value for eval.
if [ "$GH_ENV_MODE" = "1" ] && [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "LAKEBASE_BRANCH_NAME=${LAKEBASE_NAME}"
    echo "LAKEBASE_BRANCH_PATH=${BRANCH_PATH}"
    echo "LAKEBASE_HOST=${HOST}"
    echo "LAKEBASE_USERNAME=${EMAIL}"
    echo "LAKEBASE_PASSWORD<<__LB_PW_EOF__"
    printf '%s\n' "$TOKEN"
    echo "__LB_PW_EOF__"
    echo "DATABASE_URL=${PG_URL}"
    echo "JDBC_URL=${JDBC_URL}"
    echo "DB_USERNAME=${EMAIL}"
    echo "DB_PASSWORD<<__LB_PW_EOF__"
    printf '%s\n' "$TOKEN"
    echo "__LB_PW_EOF__"
    echo "SPRING_DATASOURCE_URL=${JDBC_URL}"
    echo "SPRING_DATASOURCE_USERNAME=${EMAIL}"
    echo "SPRING_DATASOURCE_PASSWORD<<__LB_PW_EOF__"
    printf '%s\n' "$TOKEN"
    echo "__LB_PW_EOF__"
  } >> "$GITHUB_ENV"
  # Also print the branch name to stdout for logging (non-secret)
  echo "$LAKEBASE_NAME"
else
  # Stdout: shell-eval format. Caller: eval "$(resolve-lakebase-branch.sh ...)"
  cat <<EOF
LAKEBASE_BRANCH_NAME='${LAKEBASE_NAME}'
LAKEBASE_BRANCH_PATH='${BRANCH_PATH}'
LAKEBASE_HOST='${HOST}'
LAKEBASE_USERNAME='${EMAIL}'
LAKEBASE_PASSWORD='${TOKEN}'
DATABASE_URL='${PG_URL}'
JDBC_URL='${JDBC_URL}'
EOF
fi
