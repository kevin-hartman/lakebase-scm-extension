# Changelog

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
