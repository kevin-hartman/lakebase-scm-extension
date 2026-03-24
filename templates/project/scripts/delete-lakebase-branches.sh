#!/usr/bin/env bash
# Delete Lakebase branches from two sources:
#   #1 Formulaic: ci-pr-<PR_NUM> from LAKEBASE_PR_NUM in .env
#   #2 From .env: branch name in LAKEBASE_BRANCH (your Git branch name)
# Usage:
#   ./scripts/delete-lakebase-branches.sh
#     Uses LAKEBASE_PR_NUM and LAKEBASE_BRANCH from .env.
#   ./scripts/delete-lakebase-branches.sh ci-pr-7 my-branch
#     Deletes those two branch names (ignores .env for names).

set -e

WORK_TREE="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$WORK_TREE" ] && cd "$WORK_TREE"

if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  set +a
fi

PROJ_ID="${LAKEBASE_PROJECT_ID:-}"
if [ -z "$PROJ_ID" ]; then
  echo "Set LAKEBASE_PROJECT_ID in .env or environment."
  exit 1
fi

if ! command -v databricks >/dev/null 2>&1; then
  echo "databricks CLI not found. Install it and run 'databricks auth login'."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found. Install jq (e.g. brew install jq)."
  exit 1
fi

export DATABRICKS_HOST="${DATABRICKS_HOST:-}"
export DATABRICKS_TOKEN="${DATABRICKS_TOKEN:-}"
PROJ_PATH="projects/${PROJ_ID}"

LIST_JSON="$(databricks postgres list-branches "$PROJ_PATH" -o json 2>/dev/null)" || true
BRANCHES_JSON="$(echo "$LIST_JSON" | jq -c 'if type == "array" then . elif type == "object" then (.branches // .items // []) else [] end' 2>/dev/null)" || BRANCHES_JSON="[]"

# Resolve full resource path for delete (API expects projects/{project_id}/branches/{branch_id}).
# Try: (1) .name from list-branches, (2) projects/.../branches/{uid}, (3) projects/.../branches/{display_name}.
resolve_delete_path() {
  local want="$1"
  local full_name
  full_name="$(echo "$BRANCHES_JSON" | jq -r --arg w "$want" '
    (.[]? | select((.name | type == "string" and (endswith("/branches/" + $w) or (split("/") | last == $w))) or (.uid == $w) or (.id == $w)))
    | .name
  ' 2>/dev/null | head -1)"
  if [ -n "$full_name" ] && [ "$full_name" != "null" ]; then
    echo "$full_name"
    return
  fi
  local uid
  uid="$(echo "$BRANCHES_JSON" | jq -r --arg w "$want" '
    (.[]? | select((.name | type == "string" and (endswith("/branches/" + $w) or (split("/") | last == $w))) or (.uid == $w) or (.id == $w)))
    | (.uid // .id // (if .name then (.name | split("/") | last) else empty end))
  ' 2>/dev/null | head -1)"
  if [ -n "$uid" ] && [ "$uid" != "null" ]; then
    echo "${PROJ_PATH}/branches/${uid}"
    return
  fi
  # Some APIs expect the branch display name as the path segment.
  echo "${PROJ_PATH}/branches/${want}"
}

if [ $# -eq 0 ]; then
  PR_NUM="${LAKEBASE_PR_NUM:-}"
  BRANCH_NAME="${LAKEBASE_BRANCH:-}"
  if [ -z "$PR_NUM" ] && [ -z "$BRANCH_NAME" ]; then
    echo "With no args, set in .env: LAKEBASE_PR_NUM (e.g. 7) and LAKEBASE_BRANCH (e.g. customer-entity)."
    echo "Or run: $0 ci-pr-<N> <branch-name>"
    exit 1
  fi
  set --
  [ -n "$PR_NUM" ] && set -- "$@" "ci-pr-${PR_NUM}"
  [ -n "$BRANCH_NAME" ] && set -- "$@" "$BRANCH_NAME"
  if [ $# -eq 0 ]; then
    echo "Set at least one of LAKEBASE_PR_NUM or LAKEBASE_BRANCH in .env."
    exit 1
  fi
fi

for name in "$@"; do
  DELETE_PATH="$(resolve_delete_path "$name")"
  if [ -z "$DELETE_PATH" ]; then
    echo "No Lakebase branch found for: $name (skipping)."
    continue
  fi
  echo "Deleting Lakebase branch: $name (path=${DELETE_PATH})..."
  if databricks postgres delete-branch "$DELETE_PATH" 2>&1; then
    echo "Deleted $name."
  else
    echo "Failed to delete $name (see above)."
  fi
done

echo "Done."
