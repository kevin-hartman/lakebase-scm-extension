# Lakebase Synced SCM

## What This Is For

Lakebase Synced SCM is a VS Code / Cursor extension that replaces the built-in Git source control with a unified **Git + Lakebase** SCM provider. Every code branch gets a paired Databricks Lakebase database branch — code and schema travel together through development, review, CI/CD, and merge.

**The problem it solves:** When applications use Lakebase (Databricks' Postgres-compatible database with copy-on-write branching), developers need to keep code branches and database branches in sync. Without this extension, you manually create database branches, refresh credentials, track schema diffs, and clean up branches — across the CLI, the Databricks console, and GitHub.

**What it does:**
- **Automatic branch pairing** — `git checkout -b feature/x` automatically creates a Lakebase database branch
- **Unified SCM view** — stage, commit, push, pull, sync, stash, tag, and merge with Lakebase awareness built in
- **Schema visibility** — see database schema changes alongside code changes in the Source Control view
- **PR integration** — create PRs that automatically trigger CI with a dedicated Lakebase branch for testing
- **Merge awareness** — merge PRs from VS Code; CI applies migrations to production and cleans up branches
- **Background credential refresh** — Lakebase tokens stay fresh automatically
- **Health check** — verify your project has all the wiring (workflows, secrets, hooks) before creating a PR
- **Full Git SCM parity** — every command from the built-in Git extension is available, plus Lakebase sync

## How to Install

### Prerequisites

| Requirement | Install |
|-------------|---------|
| VS Code 1.85+ or Cursor | — |
| Databricks CLI v0.285+ | `brew install databricks` |
| GitHub CLI | `brew install gh` |
| PostgreSQL client | `brew install libpq` |
| Java 17 + Maven | For Spring Boot / Flyway projects |
| Databricks workspace | With Lakebase enabled |
| Lakebase project | With a default (production) branch |

### Database Migration Dependency

This extension relies on **Flyway** for database schema management. Flyway migration files (`V*.sql`) are the source of truth for schema changes — the extension detects new migrations, tracks them in the SCM view, and CI applies them to Lakebase branches via `flyway:migrate`.

**The extension does not use an ORM's auto-DDL to create or modify tables.** While an ORM (e.g. Hibernate/JPA, Prisma, TypeORM) may be used in the application for data access, schema creation must be handled through explicit Flyway migration scripts. This ensures:

- Schema changes are versioned, reviewable, and auditable in source control
- The extension can detect and display pending schema changes before they're applied
- CI can apply migrations to the `ci-pr-<N>` branch and diff against production
- Production migrations are applied deterministically on merge (no runtime DDL surprises)

Set `spring.jpa.hibernate.ddl-auto=validate` (or `none`) so the ORM validates against the schema but does not create or alter tables at runtime.

### Install the Extension

1. Download `lakebase-synced-scm-0.3.0.vsix` from the [latest release](https://github.com/kevin-hartman_data/lakebase-synced-scm/releases/latest)
2. In VS Code: **Extensions** → `...` → **Install from VSIX** → select the file
3. Reload the window

### First-Time Setup

1. Open your project folder in VS Code
2. The extension activates when it detects a `.env` or `.env.example` file
3. Click **Connect to Workspace** when prompted (or from the Lakebase sidebar)
4. Complete OAuth login in the terminal
5. Run **Health Check** (`⋯` → Lakebase → Health Check) to verify everything is wired up

## How to Use

### Create a Branch

Click `⑂ main` in the Git + Lakebase status bar → **Create New Branch...**

A git branch and a Lakebase database branch are created together. The `.env` updates with the new database connection.

```
⑂ feature/orders
```

### Write Code and Migrations

As you work, the SCM view updates automatically:

- **Code** — unstaged file changes (modified, added, deleted)
- **Lakebase** — schema changes from new V*.sql migration files
- **Branch indicator** — shows `*` when there are uncommitted changes

Click any file to see a side-by-side diff against main.

### Stage and Commit

1. Click `+` on files to stage (or `+` on the Code header to stage all)
2. Type a commit message in the input box
3. Click **✓ Commit** (or Ctrl+Enter)

If nothing is staged, all changes are staged automatically.

**Commit variants** in `⋯` → Commit: Commit Staged, Commit All, Undo Last Commit, Abort Rebase, Amend, Signed Off.

### Publish and Sync

- **Publish Branch** — click ☁↑ in the title bar to push to the remote for the first time
- **Sync Changes** — after committing, the Sync Changes group shows commits to push/pull. Click the ⟳ sync icon in the status bar or the sync item in the group.

```
⑂ feature/orders    ⟳ 1↑
```

### Review Your Branch

Click the **Review Branch** button (compare-changes icon) in the SCM title bar to open a multi-diff editor with ALL code and schema changes on the branch vs main.

Or click **Unified Branch Diff Summary** (diff icon) for a two-column webview.

### Create a Pull Request

Click 🔀 **Create Pull Request** in the SCM title bar.

The extension:
1. Checks and syncs GitHub secrets (DATABRICKS_HOST, DATABRICKS_TOKEN, LAKEBASE_PROJECT_ID)
2. Pushes the branch if needed
3. Creates the PR with the Lakebase branch name in the body

CI automatically creates a `ci-pr-<N>` Lakebase branch, runs Flyway and tests.

### Monitor CI

The **Pull Request** group appears in the SCM view:

```
Pull Request                              ⑂  🔀  🔄
  ⟳ PR #42 - Feature/orders              (click opens GitHub PR)
  ⛁ Lakebase Branch for ci-pr-42         (click opens Lakebase console)
```

- Auto-polls every 30 seconds while CI is pending
- Notification when CI completes
- Click 🔀 to **View PR Schema Diff** (live pg_dump if no CI comment)

### Merge

Click ⑂ (git-merge) on the Pull Request group header:
1. Choose merge method: Merge, Squash, or Rebase
2. Confirm
3. Extension merges, checks out main, pulls latest

CI applies Flyway to production and deletes the CI + feature Lakebase branches.

### Verify Production

On main, the SCM view shows:

```
Lakebase
  ✅ production (READY)                    ← click opens console

Schema Migrations
  📄 V1__init_placeholder.sql              ← click opens file
  📄 V2__create_book_table.sql
  📄 V6__create_orders.sql

Recent Merges
  ⑂ Merge pull request #9 from...          ← click opens on GitHub
```

### Switch Branches

Click the branch name in the status bar to open the branch picker:

```
Select a branch or tag to checkout
─── Actions ───
  (+) Create New Branch...
  (⑂) Create New Branch From...
  (⊘) Checkout Detached...
─── Local Branches ───
  ✓ main                                  → production (default)
    feature/orders                        → feature-orders (READY)
─── Remote Branches ───
  ☁ hotfix-99                            → no Lakebase branch
```

Each branch shows its Lakebase pairing. Switching syncs the database connection automatically.

### More Actions (`⋯`)

```
Pull / Push / Clone / Checkout to... / Fetch
─────────────
Commit ▸          Commit / Staged / All / Undo / Abort Rebase | Amend variants | Signed Off variants
Changes ▸         Stage All / Unstage All / Discard All
Pull, Push ▸      Sync | Pull / Rebase / From... | Push / To... | Fetch / Prune / All Remotes
Branch ▸          Merge / Rebase | Create / From... | Rename / Delete / Delete Remote | Publish
Remote ▸          Add / Remove
Stash ▸           Stash / Untracked / Staged | Apply / Pop | Drop / Drop All | View
Tags ▸            Create / Delete / Delete Remote
Worktrees ▸       Create / List / Delete
Lakebase ▸        Health Check / Console / Diff Summary / PR Schema Diff / Merge PR / Refresh PR
─────────────
Show Git Output
```

### Lakebase Sync Across Git Operations

| Git Operation | Lakebase Action |
|--------------|-----------------|
| Create branch | Creates Lakebase branch from production |
| Switch branch | Updates .env with database connection |
| Delete branch | Deletes corresponding Lakebase branch |
| Delete remote branch | Deletes corresponding Lakebase branch |
| Rename branch | Deletes old, auto-creates new |
| Merge branch | Offers to delete merged branch's Lakebase branch |
| Pull / Sync | Clears schema cache + refreshes credentials |
| Stash / Pop / Apply | Clears schema cache |
| Undo commit / Discard | Clears schema cache |
| Publish branch | Shows Lakebase branch name |
| Create PR | Syncs CI secrets; CI creates ci-pr-N branch |
| Merge PR | CI applies Flyway to production + cleanup |

### Settings

Search `lakebaseSync` in VS Code Settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `autoCreateBranch` | `true` | Auto-create Lakebase branch on git checkout |
| `autoRefreshCredentials` | `true` | Background credential refresh (20 min) |
| `showUnifiedRepo` | `true` | Show Git + Lakebase in Source Control |
| `productionReadOnly` | `true` | Prevent deleting the production branch |
| `migrationPath` | `src/main/resources/db/migration` | Flyway migration path |

### Testing

```bash
npm test   # 277 tests across 15 suites
```

## Architecture

### How It's Built

The extension is a standard VS Code extension written in TypeScript, bundled with webpack, and packaged as a `.vsix` file. It uses no VS Code proposed APIs — everything is stable API available to any third-party extension.

```
┌──────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                     │
├──────────────┬────────────────┬──────────────────────────────┤
│  SCM Provider│  Webview Panels│  Status Bar                  │
│  - Git+Lake  │  - Branch Diff │  - Branch picker             │
│    Staged    │  - Table Diff  │  - Sync indicator            │
│    Code      │  - Health Check│  - Lakebase status           │
│    Lakebase  │  - PR Schema   │                              │
│    PR Status │                │                              │
│    Migrations│                │                              │
│    Merges    │                │                              │
├──────────────┴────────────────┴──────────────────────────────┤
│                      Service Layer                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ GitService   │  │ LakebaseServ │  │ SchemaDiffService    │ │
│  │ - branch ops │  │ - branch CRUD│  │ - pg_dump comparison │ │
│  │ - staging    │  │ - endpoints  │  │ - per-branch cache   │ │
│  │ - commit     │  │ - credentials│  │ - migration parsing  │ │
│  │ - PR via gh  │  │ - console URL│  │                      │ │
│  │ - ahead/behind│ │              │  │                      │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘ │
│         │                │                      │             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐ │
│  │ FlywayService│  │ SchemaContent│  │ GitBaseContent       │ │
│  │ - list/parse │  │ Provider     │  │ Provider             │ │
│  │   migrations │  │ - DDL for    │  │ - file at merge-base │ │
│  │ - watch files│  │   multi-diff │  │   for code diffs     │ │
│  └──────────────┘  └──────────────┘  └─────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│                    External CLIs                              │
│  ┌──────────┐  ┌───────────────────┐  ┌────────────────────┐ │
│  │ git      │  │ databricks CLI    │  │ gh (GitHub CLI)    │ │
│  │          │  │ - postgres        │  │ - pr create/merge  │ │
│  │          │  │   list-branches   │  │ - secret set       │ │
│  │          │  │   create-branch   │  │ - pr view          │ │
│  │          │  │   list-endpoints  │  │                    │ │
│  │          │  │   generate-cred   │  │                    │ │
│  └──────────┘  └───────────────────┘  └────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ pg_dump (PostgreSQL client)                              │ │
│  │ - schema-only dumps for branch vs production comparison  │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### What's Leveraged

| Component | Purpose | How it's used |
|-----------|---------|---------------|
| **VS Code SCM API** | Source control integration | Custom `SourceControl` provider with resource groups (Staged, Code, Lakebase, PR, Migrations, Merges) |
| **VS Code TextDocumentContentProvider** | Virtual file content | `lakebase-git-base://` for merge-base file versions; `lakebase-schema-content://` for DDL in multi-diff |
| **VS Code FileSystemWatcher** | Live file tracking | Watches `.git/HEAD`, `.git/index`, `.git/COMMIT_EDITMSG`, and migration files |
| **`vscode.diff` command** | Side-by-side diffs | Code diffs (main vs branch) and schema DDL diffs (production vs branch) |
| **`vscode.changes` command** | Multi-diff editor | Review Branch opens all code + schema diffs in one tab |
| **Databricks CLI** | Lakebase operations | Branch CRUD, endpoint management, credential generation via `child_process.exec` |
| **GitHub CLI (`gh`)** | PR and repo operations | `gh pr create`, `gh pr merge`, `gh pr view`, `gh secret set` |
| **`pg_dump`** | Schema comparison | `--schema-only` dumps of branch and production databases, parsed to extract CREATE TABLE statements |
| **Flyway** | Migration management | Extension reads V*.sql files to detect schema changes; CI workflows run `flyway:migrate` |
| **GitHub Actions** | CI/CD automation | `pr.yml` creates CI Lakebase branches; `merge.yml` applies migrations to production and cleans up |

### Caching Strategy

Schema diffs are expensive (two pg_dump calls + credential generation). The extension uses a **per-branch cache** with two invalidation triggers:

1. **Migration file mtime** — if any V*.sql file is newer than when the cache was built, pg_dump re-runs
2. **10-minute max age** — guards against stale results after credential expiry or external changes

Error results are never cached — the next access always retries.

### CI/CD Pipeline

The extension embeds project templates (`templates/project/`) that include GitHub Actions workflows and shell scripts. When a new project is created (Phase 4), these are copied into the repo:

```
PR opened/updated → pr.yml
  → Create ci-pr-<N> Lakebase branch from production
  → Wait for endpoint READY
  → Run Flyway migrate on CI branch
  → Run tests against CI database
  → Post schema diff as PR comment

PR merged → merge.yml
  → Run Flyway migrate on production (default branch)
  → Delete ci-pr-<N> Lakebase branch
  → Delete feature Lakebase branch
  → Delete GitHub branch
```

## Noted Limitations

### Schema Diff: Needs Native CLI Support

The current schema diff implementation is the extension's biggest weakness. To compare a branch's schema against production, the extension:

1. Fetches credentials for both branches via the Databricks CLI
2. Runs `pg_dump --schema-only` against both databases
3. Parses the raw DDL output to extract CREATE TABLE statements
4. Compares column lists to detect created, modified, and removed tables

**This is clunky.** It requires `pg_dump` installed on the developer's machine (with macOS Homebrew path fallbacks), handles credential expiry across two separate database connections, and produces approximate diffs that miss indexes, constraints, sequences, and other DDL objects.

**What would fix it:** A native `databricks postgres schema-diff` CLI command (similar to Neon's `neon branches schema-diff`) that:
- Takes two branch references and returns a unified diff
- Runs server-side (no local `pg_dump` needed)
- Handles auth internally (no separate credential generation)
- Returns structured output (JSON with table/column changes) alongside unified diff text
- Supports point-in-time comparison (at LSN or timestamp)

A full feature parity analysis comparing Lakebase to Neon's schema-diff capabilities is documented in `lakebase-schema-diff-feature-parity.md` in the demo project.

### Blue Action Button

VS Code's SCM "big blue button" (the Commit/Sync Changes button shown by the built-in Git extension) uses the `SourceControl.actionButton` proposed API. This API is only available to built-in extensions — third-party extensions cannot use it. The extension uses `statusBarCommands` and `scm/title` navigation buttons as alternatives, but the prominent action button is not achievable until the API is stabilized.

### Other Limitations

- **PR comment posting** — The CI workflow's schema diff comment sometimes fails silently (`2>/dev/null || true`). The extension works around this with live pg_dump fallback, but the CI should be more robust.
- **Merge conflict resolution** — No special handling for conflicting Flyway migrations across branches. If two branches add the same version number, Flyway will fail on merge.
- **Offline mode** — The extension requires network access for every Lakebase operation. A local cache of branch state would improve the experience on unreliable connections.
- **Multi-project support** — Currently assumes one Lakebase project per workspace. Multi-project workspaces would need project selection per branch.
- **Token lifecycle** — The 20-minute background refresh is a workaround for short-lived Lakebase tokens. A proper OAuth refresh token flow would be more reliable.

## Roadmap

### Unified Project Creation

The `lakebaseSync.createProject` command would create a GitHub repo + Lakebase database in one step:
- Scaffold the project from embedded templates (workflows, scripts, hooks, .env)
- Create the Lakebase database via Databricks REST API
- Set GitHub secrets automatically
- Install git hooks
- Run health check to verify all wiring
- Open the new workspace
- Disable built-in Git SCM via `.vscode/settings.json`

### Advanced Features

- **Data preview** — Read-only table viewer for branch databases from within VS Code
- **Conflict detection** — Warn when two branches modify the same tables
- **Branch comparison** — Diff any two Lakebase branches (not just branch vs production)
- **Cursor AI context** — Expose database schema to AI-assisted code generation
