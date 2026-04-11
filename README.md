# Lakebase SCM Extension

## What This Is For

Lakebase SCM Extension is a VS Code / Cursor extension that replaces the built-in Git source control with a unified **Git + Lakebase** SCM provider. Every code branch gets a paired Databricks Lakebase database branch — code and schema travel together through development, review, CI/CD, and merge.

**The problem it solves:** When applications use Lakebase (Databricks' Postgres-compatible database with copy-on-write branching), developers need to keep code branches and database branches in sync. Without this extension, you manually create database branches, refresh credentials, track schema diffs, and clean up branches — across the CLI, the Databricks console, and GitHub.

**What it does:**
- **Create New Project** — 10-step wizard scaffolds a complete project: GitHub repo + Lakebase database + language template (Java/Python/Node.js) + CI/CD workflows + self-hosted runner
- **Automatic branch pairing** — `git checkout -b feature/x` automatically creates a Lakebase database branch
- **Live schema visibility** — see actual database tables on each branch with diff indicators (new/modified/removed vs production)
- **Two parallel interfaces** — work from the **Lakebase sidebar** or the **SCM view**, both with full functionality
- **CI Runner management** — deploy, start, stop, and monitor a self-hosted GitHub Actions runner from the sidebar
- **PR integration** — commit → push → create PR in one flow; CI creates a dedicated Lakebase branch for testing
- **Merge awareness** — merge PRs from VS Code; CI applies migrations to production and cleans up branches
- **Branch Review** — multi-diff editor showing all code + schema changes, querying actual database state
- **Full Git SCM parity** — every command from the built-in Git extension is available, plus Lakebase sync

## Getting Started: Create a New Project

The fastest way to start is the **Create New Project** wizard. From the Command Palette:

**Lakebase: Create New Project**

The wizard walks through 10 steps:

| Step | What | Detail |
|------|------|--------|
| 1 | Project name | Lowercase, letters/numbers/hyphens |
| 2 | Parent directory | Where the project folder will be created |
| 3 | GitHub authentication | Sign in via browser, or use existing auth |
| 4 | GitHub repo name | Defaults to project name |
| 5 | Visibility | Private (default) or Public |
| 6 | Language | Java/Spring Boot, Python/FastAPI, or Node.js/Express |
| 7 | Runner type | Self-hosted (default) or GitHub-hosted |
| 8 | Databricks workspace | Select or connect to a workspace with Lakebase |
| 9 | Lakebase project name | Defaults to repo name |
| 10 | Execute | Creates everything with progress notification |

**What gets created:**
- GitHub repository with CI/CD workflows (`pr.yml`, `merge.yml`)
- Lakebase database project with a production branch
- Language-specific scaffold (entity, migration, test framework, build tool)
- 16 shell scripts (hooks, migration, secrets, schema diff)
- `.env` with Databricks connection, `.gitignore`, `.vscode/settings.json`
- Self-hosted GitHub Actions runner (if selected) — deployed and listening
- Initial commit pushed to main

After creation, the extension offers to open the new project folder.

### Language Templates

| Language | Framework | Migration Tool | Package Manager | Test Framework |
|----------|-----------|---------------|-----------------|----------------|
| **Java** | Spring Boot 3.5 / JPA | Flyway 10.22 | Maven (mvnw) | JUnit 5 + MockMvc |
| **Python** | FastAPI / SQLAlchemy / psycopg3 | Alembic 1.14 | uv + pyproject.toml | pytest + httpx |
| **Node.js** | Express | Knex 3.1 | npm | Jest + supertest |

Smart scripts (`flyway-migrate.sh`, `run-tests.sh`) auto-detect the language from `pom.xml`, `pyproject.toml`, or `package.json`. CI workflows are language-aware — they detect the project type and run the correct setup, migration, and test tools automatically.

### Runner Types

| Type | How CI runs | When to use |
|------|------------|-------------|
| **Self-hosted** (default) | On your local machine via a GitHub Actions runner | No internet needed for builds; uses local JDK + Maven cache |
| **GitHub-hosted** | On GitHub's infrastructure | Standard GitHub Actions; requires internet for dependency downloads |

## How to Install

### Prerequisites

| Requirement | Install |
|-------------|---------|
| VS Code 1.85+ or Cursor | — |
| Databricks CLI v0.285+ | `brew install databricks` |
| GitHub CLI | `brew install gh` |
| PostgreSQL client (psql) | `brew install libpq` |
| Databricks workspace | With Lakebase enabled |

**For Java projects:** Java 21+ and Maven (the scaffold includes `mvnw`)
**For Python projects:** Python 3.10+ and [uv](https://docs.astral.sh/uv/) (`brew install uv` or `pip install uv`)
**For Node.js projects:** Node.js 18+

### Install the Extension

1. Download `lakebase-scm-extension-0.4.4.vsix` from the [latest release](https://github.com/kevin-hartman/lakebase-scm-extension/releases/latest)
2. In VS Code: **Extensions** → `...` → **Install from VSIX** → select the file
3. Reload the window

### First-Time Setup (Existing Project)

If you already have a project with Lakebase:

1. Open your project folder in VS Code
2. The extension activates when it detects a `.env` or `.env.example` file
3. Click **Connect to Workspace** in the Lakebase sidebar title bar
4. Complete OAuth login in the terminal
5. Run **Health Check** (`⋯` → Lakebase → Health Check) to verify everything is wired up

## Developer Workflow

### 1. Create a Feature Branch

Click `$(git-branch)` on the project item → **Create New Branch...** → type a name.

A git branch and a Lakebase database branch are created together. The `.env` updates with the new database connection. Your code now runs against an isolated copy of production.

### 2. Write Code, Migration, and Tests

Write your feature:
- **Entity/model** — JPA entity, SQLAlchemy model, or Knex schema
- **Migration** — `V{N}__{description}.sql` (Flyway), Alembic migration, or Knex migration
- **Given/When/Then tests** — integration tests that run against the real Lakebase branch database

### 3. Run Tests Locally

```bash
./scripts/run-tests.sh        # auto-detects language
# or directly:
./mvnw test                   # Java
uv run pytest                 # Python
npm test                      # Node.js
```

Flyway/Alembic/Knex applies the migration to the branch database → framework validates entities → tests execute against live PostgreSQL. No mocks.

### 4. Commit and Push

Stage files and commit from the sidebar. If the branch hasn't been pushed, the extension prompts to push when you create a PR.

### 5. Create a Pull Request

Click `$(git-pull-request-create)` on the project item. The extension handles the full pipeline:

1. Detects uncommitted changes → prompts to commit → verifies commit succeeded
2. Pushes branch automatically (no separate dialog)
3. Syncs CI secrets (non-blocking)
4. Prompts for PR title and description
5. Creates the PR

The CI workflow (`pr.yml`) automatically:
- Creates a `ci-pr-<N>` Lakebase branch from production
- Runs Flyway/Alembic/Knex migrate on the CI branch
- Runs tests
- Posts a schema diff comment on the PR

### 6. Monitor CI

The **CI Runner** view in the sidebar shows:
- Runner status (online/offline) with start/stop controls
- Runner and job logs
- Recent workflow runs with status icons (click opens GitHub)

The **Pull Request** view shows PR status and CI branch status.

### 7. Merge

Click `$(git-merge)` in the Pull Request view:
1. Choose merge method (Merge, Squash, Rebase)
2. Confirm
3. Extension merges, checks out main, pulls latest

The merge workflow (`merge.yml`) automatically:
- Runs Flyway/Alembic/Knex migrate on production
- Verifies schema (checks all expected tables exist)
- Deletes the `ci-pr-<N>` and feature Lakebase branches

### 8. Verify Production

On main, expand the production database node to see all tables. The **Branch Review** queries the actual database state — including ALTER TABLE changes from previous merges.

## Sidebar Views

Click the Lakebase icon in the activity bar. The sidebar contains:

| View | Shows | When |
|------|-------|------|
| **Project** | Repo, Lakebase project, branches with expandable details (tables, files, migrations) | Always |
| **Changes** | Staged, Code (unstaged), Lakebase schema changes, Sync indicator | Always |
| **Schema Migrations** | All V*.sql migration files | On main only |
| **Pull Request** | PR status, CI branch status, merge action | When PR exists |
| **CI Runner** | Runner status, start/stop, logs, recent workflow runs | Always |
| **Recent Merges** | Last 5 merge commits | On main only |
| **Graph** | Visual commit graph with Lakebase annotations | Always |

### Branch Table Diff

Expanding a branch's database node queries the actual Lakebase database and shows tables with diff indicators:

- **Green `+`** — new table created on this branch
- **Yellow `~`** — table with modified columns vs production
- **Red `-`** — table removed on this branch
- **White** — unchanged (shown on production only)

Click any changed table to see a production ↔ branch DDL diff.

## Database Migration Strategy

The extension supports explicit, versioned migrations — not ORM auto-DDL. Schema changes must go through migration files:

| Language | Migration Tool | Migration Files |
|----------|---------------|----------------|
| Java | Flyway | `src/main/resources/db/migration/V{N}__desc.sql` |
| Python | Alembic | `alembic/versions/*.py` |
| Node.js | Knex | `migrations/*.js` |

**Why:** Versioned migrations are reviewable in PRs, applied deterministically by CI, and diffed between branches. ORM auto-DDL (`ddl-auto=create`, `db.create_all()`) bypasses this — use `validate` mode instead.

## Settings

Search `lakebaseSync` in VS Code Settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `autoCreateBranch` | `true` | Auto-create Lakebase branch on git checkout |
| `autoRefreshCredentials` | `true` | Background credential refresh (20 min) |
| `showUnifiedRepo` | `true` | Show Git + Lakebase in Source Control |
| `productionReadOnly` | `true` | Prevent deleting the production branch |
| `migrationPath` | `src/main/resources/db/migration` | Migration file path |

## Testing

```bash
npm test                                              # 299 unit tests
npm run test:integration -- --grep "E-Commerce"       # 179 integration tests (8 scenarios, ~30 min)
npm run test:integration -- --grep "Self-Hosted Runner" # 11 runner pipeline tests (~2 min)
```

**Integration tests** create real GitHub repos + Lakebase projects, deploy self-hosted runners, execute actual CI workflows, and verify production database state. Total: **190 integration tests**.

## Lakebase Sync Across Git Operations

| Git Operation | Lakebase Action |
|--------------|-----------------|
| Create branch | Creates Lakebase branch from production |
| Switch branch | Updates .env with database connection |
| Delete branch | Deletes corresponding Lakebase branch |
| Rename branch | Deletes old, auto-creates new |
| Merge branch | Offers to delete merged branch's Lakebase branch |
| Pull / Sync | Clears schema cache + refreshes credentials |
| Create PR | Syncs CI secrets; CI creates ci-pr-N branch |
| Merge PR | CI applies migration to production + cleanup |

## Known Limitations

- **Existing pre-v0.4.0 projects** need manual workflow update (replace `actions/setup-java` with local JDK step) for self-hosted runners
- **Schema diff** relies on `psql` queries; a native `databricks postgres schema-diff` CLI command would be faster and more complete
- **Merge conflict resolution** — no special handling for conflicting migration versions across branches
- **Multi-project support** — assumes one Lakebase project per workspace
- **Blue action button** — VS Code's SCM action button uses a proposed API not available to third-party extensions

## Roadmap

- **Deploy to Databricks Apps** — One-click deployment with `app.yaml`/`databricks.yml` generation, OAuth M2M auth, and synced table support
- **Data preview** — Read-only table viewer for branch databases
- **Conflict detection** — Warn when two branches modify the same tables
- **Branch comparison** — Diff any two Lakebase branches
- **Cursor AI context** — Expose database schema to AI-assisted code generation
