# Changelog

## 0.5.4

### Added
- Configurable trunk branch alias via `LAKEBASE_TRUNK_BRANCH` in `.env` or the `lakebaseSync.trunkBranch` VS Code setting. Projects that use user-prefixed or non-standard trunk branch names (e.g., `kevin.hartman/lakebase-ecommerce-demo` in a monorepo) can opt in. **When the alias is set, it REPLACES `main`/`master` as the project's trunk** — the shared monorepo `main` will NOT also pair with the project's default Lakebase branch. When no alias is set, `main`/`master` behave as before.
- Companion `LAKEBASE_STAGING_BRANCH` alias: pairs a named git branch (e.g. `user/project-staging` in a monorepo) with the Lakebase `staging` branch. Mirrors `LAKEBASE_TRUNK_BRANCH` semantics but targets the `staging` Lakebase branch instead of the default. Requires the Lakebase `staging` branch to already exist — the hook does NOT auto-create it.

### Fixed
- **post-checkout hook scope** — the hook now exits immediately if `.env` is missing at the work-tree root, and `unset`s all `LAKEBASE_*` / `DATABRICKS_*` env vars before sourcing `.env`. This prevents two monorepo-hostile failure modes: (1) the hook firing at a parent-submodule level and creating spurious Lakebase branches for unrelated git branches; (2) shell-inherited env vars (from sourcing a project activation script earlier in the session) leaking into checkouts in unrelated repos and triggering the "feature branch" codepath when there's no actual project context.
- **Feature branches now honor `LAKEBASE_BASE_BRANCH`** — both the post-checkout hook and `lakebaseService.createBranch()` read `LAKEBASE_BASE_BRANCH` from `.env` (or the `lakebaseSync.baseBranch` VS Code setting) and use it as the source when creating a new feature Lakebase branch. Previously the hook's `.env.example` documented `LAKEBASE_BASE_BRANCH=staging` but the value was never read — features always forked from the default branch. Now a `feature/* → staging → production` promotion flow works end-to-end.
- **Branch-tree file list is per-branch, not per-HEAD** — expanding a branch in the sidebar now shows that branch's diff vs trunk, not the current working tree's diff. Previously `getBranchFiles` ignored its `branchName` argument and always called `gitService.getChangedFiles()` for HEAD, so every branch node listed the same files. Also: `getChangedFiles()` now diffs against `config.trunkBranch` when set (falling back to `main`/`master`), which fixes a monorepo bug where branch views listed unrelated sandboxes as "added" because the diff base was the wrong trunk.
- **`LAKEBASE_GIT_BRANCH_PREFIX` scopes the branch list** — the sidebar used to list every git branch in the repo, including branches from unrelated projects/users in a monorepo. Set `LAKEBASE_GIT_BRANCH_PREFIX` (or `lakebaseSync.gitBranchPrefix`) to a string prefix (e.g. `user/project-`) and only branches starting with that prefix are shown. The currently-checked-out branch is always shown regardless, so you never "lose" the branch you're on.
- **Self-hosted runner: clear setup hint for `/Users/runner/hostedtoolcache`** — `actions/setup-python@v5`'s installer script (from `actions/python-versions`) hardcodes `/Users/runner/hostedtoolcache` as the install path on macOS. On a self-hosted runner running as a normal user, that path doesn't exist and mkdir fails with "Permission denied". `RUNNER_TOOL_CACHE` doesn't help — it redirects setup-python's cache LOOKUP but not where the installer writes, and setting it to a different path causes re-downloads every run. The only durable fix is a one-time sudo: `sudo mkdir -p /Users/runner/hostedtoolcache && sudo chown -R <user> /Users/runner`. `setupRunner` now checks that path at install time and emits the exact command if missing, so users know what to run.

## 0.5.3 (2026-04-21)

### Two-tier CI (fork + migrate against parent branch)
- **`templates/.github/workflows/pr.yml`** now forks `ci-pr-<N>` from the PR's **base.ref** branch (e.g. `staging`) instead of the Lakebase default. Schema diff compares CI branch vs parent, not vs production. Projects using a `feature/* → staging → main` promotion flow now test against the right baseline.
- **`templates/.github/workflows/merge.yml`** triggers on push to `main` **or** `staging`. The `migrate-target` job resolves the matching Lakebase branch from `github.ref_name` (main → default/production; staging → `staging`). Cleanup of `ci-pr-<N>` + the merged feature branch's Lakebase clone fires on **any** merged PR, not just PRs to `main`.
- **New helper `templates/scripts/ci/resolve-lakebase-branch.sh`** — single source of truth for the git→Lakebase branch mapping. Uses `scripts/sanitize-branch-name.sh` for non-main branches, the project default for `main`/`master`. Handles create-from-parent, endpoint ensure, credential mint, and emits env vars to `$GITHUB_ENV` + non-secret vars to stdout for same-step `eval`.
- **Source-mismatch verification** — if `ci-pr-<N>` already exists but was forked from the wrong parent (e.g. from a prior run when base.ref was `main` but now it's `staging`), the helper can delete + re-fork from the correct parent (`--recreate-on-source-mismatch`). Previously the extension silently reused the wrong-source branch. New `LAKEBASE_BRANCH_STATUS` output (`CREATED` / `VERIFIED` / `RECREATED` / `EXISTS` / `UNVERIFIED`) exposes the truth in CI logs + step summaries.
- **Protected-branch allowlist** — `templates/scripts/delete-lakebase-branches.sh` refuses to delete `main`/`master`/`staging`/`production` or the project's default branch, even if a PR's HEAD_REF happens to sanitize to one of them (matters when `staging → main` PRs get merged).

### Schema tree reliability
- **`pg` client fallback** — `queryBranchSchema` no longer silently returns `[]` when `psql` isn't on the user's PATH (the common macOS default). It now tries `psql` first and falls back to the bundled `pg` node client, so the schema tree populates regardless of local binary availability. Errors surface in the developer console instead of being swallowed.

### Developer-experience fixes
- `$GITHUB_ENV` writes don't apply to the same step that wrote them. The helper now ALSO emits non-secret vars to stdout so callers can `eval` them in-step — fixes an earlier regression where `JDBC_URL` was empty when writing the step output.
- Informational echoes in the helper go to stderr, so `HELPER_OUT` captures only `KEY='value'` lines (avoids `eval: syntax error near unexpected token '('`).

## 0.5.2 (2026-04-18)

### Setup helpers
- New `setupCiSecrets` command + automatic prompt after runner setup so GitHub repo secrets (`DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `LAKEBASE_PROJECT_ID`) get populated without a trip to the repo UI.
- New `createLakebaseProject` command for one-shot Lakebase autoscaling project creation.
- `.vscodeignore` tightened to keep the VSIX lean.

### Database name resolution
- `getProjectDatabase()` now parses the path segment of `DATABASE_URL` before falling back to `databricks_postgres`, so projects using a custom app DB no longer have to hard-code overrides.

## 0.5.1 (2026-04-17)

### Deploy Enhancements
- **Lakebase PAT-based auth** -- New `ensureLakebaseSecretAuth()` method: creates secret scope, generates 90-day PAT, stores in secret, grants app SP READ ACL. Enables Lakebase Postgres auth on workspaces where SP-generated credentials are not accepted (e.g. partner-demo-catalog).
- **Seed data automation** -- New `runSeedData()` method: detects `scripts/seed-data/seed_demo_data.py`, runs with `--target` and `--with-partners` flags. Integrated as Step 6 of deploy flow.
- **Dynamic app.yaml generation** -- Step 2 now builds the env block programmatically from deploy target config instead of sed replacements. Includes `lakebase_secret_scope`, `lakebase_secret_key`, and `ai_model` fields. Original app.yaml restored in `finally` block.
- **AI model override** -- New `ai_model` field in deploy targets, passed as `AI_MODEL` env var in app.yaml for workspaces where default Foundation Model endpoints are rate-limited.
- **UC catalog permissions** -- Deploy Step 4 now grants `USE_CATALOG`, `USE_SCHEMA`, `READ_VOLUME`, `WRITE_VOLUME` to the app SP on the target UC catalog.

### Documentation
- **Deploy to Databricks Apps** -- New README section covering deploy targets configuration, deploy steps, Lakebase Auth (SP vs PAT), seed data, and CLI deploy script reference.

## 0.5.0 (2026-04-14)

### CI Reliability Hardening
- **Block push on token refresh failure** -- `pre-push.sh` now exits 1 when OAuth token refresh fails, preventing pushes with stale tokens that cause CI failures mid-run. Clear error message tells developers to run `databricks auth login`.
- **Auto-expire CI branches** -- CI branches (`ci-pr-*`) are now created with a 24-hour TTL instead of `no_expiry`. If merge workflow cleanup fails or a direct push skips it, branches auto-delete instead of lingering with active endpoints.
- **Pre-migration snapshot** -- `merge.yml` creates a snapshot branch from production before running migrations. Deleted on success. On failure, the snapshot is preserved with recovery instructions in the GitHub job summary. Uses 24h TTL as a safety net.

### Branch Name Sanitization
- **Centralized sanitization** -- Extracted the git-to-Lakebase branch name regex into `sanitize-branch-name.sh`. Replaces 4 inline copies across `post-checkout.sh`, `pr.yml`, and `merge.yml`. Single source of truth: lowercase, slash-to-dash, strip special chars, truncate to 63 chars, pad to 3 char minimum.

### Orphan Cleanup
- **Weekly garbage collector** -- New `cleanup-orphans.yml` GitHub Action runs every Monday at 6am UTC. Lists all `ci-pr-*` Lakebase branches, compares against open PRs, and deletes orphaned branches whose PRs are closed or merged. Also available via manual `workflow_dispatch`.

### Token Lifecycle
- **Optimized refresh interval** -- Background credential refresh changed from 20 minutes to 45 minutes. Token lifetime is ~1 hour; the previous 20-minute interval was unnecessarily aggressive. 45 minutes provides a 15-minute buffer before expiry.
- **All migrate commands wrapped** -- Java (Flyway) and Node.js (Knex) migrate commands now run through `refresh-token.sh`, matching the existing Python (Alembic) behavior. Prevents expired credentials during long dev sessions.

### Observability
- **Fork point audit trail** -- Branch creation in `post-checkout.sh` and `pr.yml` now logs `source_branch_lsn` and `source_branch_time` from the Lakebase API response. Useful for debugging "my branch has different data than expected" scenarios.
- **Connection verification** -- `post-checkout.sh` runs a `psql SELECT 1` after creating a branch to verify the endpoint is reachable and credentials work. Retries credential generation once on failure. Non-blocking: skips if `psql` is not installed.

### Resilience
- **Retry UI for failed connections** -- When `syncConnection()` cannot reach an endpoint, VS Code now shows a warning notification with a "Retry" button instead of failing silently. The `.env` file includes a timestamped comment with recovery instructions.

### Federation Support
- **Lakehouse Federation setup script** -- New `setup-federation.sh` for partners who need to query Lakebase tables from the lakehouse side. Creates a native Postgres role with SCRAM-SHA-256 auth (required because Federation only supports static credentials), grants read-only access, and creates a Databricks connection + foreign catalog. One-time setup per project. Based on Cameron Casher's Lakebase-Backstage POC.

## 0.4.9 (2026-04-06)

- Fix: exclude `.claude/hooks` symlink and `.agent-logs` from VSIX
- Add `post-merge` hook and update `install-hook` to deploy it

## 0.4.8 and earlier

See [git log](https://github.com/kevin-hartman/lakebase-scm-extension/commits/main) for full history.
