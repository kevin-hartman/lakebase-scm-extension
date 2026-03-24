# Lakebase Branch Sync — VS Code / Cursor Extension Plan

## Workflow Process Analysis

### Current Code + Database Branch Lifecycle

This project implements a synchronized git-branch to database-branch workflow:

| Git Event | Code Action | Database Action |
|-----------|------------|-----------------|
| `git checkout -b feature/x` | Create git branch | **post-checkout hook** creates Lakebase branch, updates `.env` + `application-local.properties` |
| `git commit` | Stage & commit code | **prepare-commit-msg hook** appends schema diff to commit message |
| `git push` / PR opened | Push to remote, CI triggers | **pr.yml** creates `ci-pr-<N>` Lakebase branch, runs Flyway migrations, runs tests, posts schema diff as PR comment |
| PR updated (synchronize) | Push new commits | **pr.yml** re-runs migrations + tests on CI branch, updates PR comment |
| PR merged to main | Merge code | **merge.yml** runs Flyway on production, deletes `ci-pr-<N>` + feature Lakebase branches, deletes GitHub branch |
| PR closed (not merged) | Close PR | Lakebase branches left for manual cleanup |

### Key Insight

The "unit of change" is code + schema together. Every feature branch has a paired Lakebase database branch. Migrations in `src/main/resources/db/migration/` travel with the code. The schema diff (branch vs. production) is generated at commit time, PR time, and merge time.

---

## Plugin Vision

A VS Code / Cursor extension that provides unified visibility into both code changes and database schema changes across the git lifecycle. It makes the invisible (database branch state, schema diffs, migration status) visible alongside the familiar (git diffs, branch status, PR state).

## Architecture

```
┌─────────────────────────────────────────────────┐
│              VS Code / Cursor Extension          │
├─────────────┬───────────────┬───────────────────┤
│  Tree Views │  Diff Editor  │  Status Bar       │
│  - Branches │  - Code diff  │  - Branch sync    │
│  - Schemas  │  - Schema diff│  - Migration ver  │
│  - Migrations│              │  - DB status      │
├─────────────┴───────────────┴───────────────────┤
│              Extension Core                      │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │ Git      │  │ Lakebase │  │ Flyway         │ │
│  │ Watcher  │  │ API      │  │ Migration      │ │
│  │          │  │ Client   │  │ Parser         │ │
│  └──────────┘  └──────────┘  └────────────────┘ │
├─────────────────────────────────────────────────┤
│  Databricks CLI  │  Git CLI  │  psql / pg_dump  │
└─────────────────────────────────────────────────┘
```

---

## Phase 1: Foundation (MVP) ✅ COMPLETE

### Goals
- Extension scaffold with TypeScript + webpack
- Lakebase API client wrapping Databricks CLI
- Git watcher detecting branch changes
- Status bar showing current git branch, Lakebase branch, sync status
- Branch tree view listing all git branches with paired Lakebase branch status

### Deliverables
1. ✅ **Extension scaffold** — `package.json`, activation events, command registration
2. ✅ **LakebaseService** — Branch CRUD, endpoint management, credential generation via CLI
3. ✅ **GitService** — Branch detection, event watching, file change detection, per-branch migration listing
4. ✅ **StatusBarProvider** — Persistent status bar: DB branch + migration version + sync status
5. ✅ **BranchTreeProvider** — Sidebar tree view with git/Lakebase branch pairs, switch branch workflow

---

## Phase 2: Diff & Visibility ✅ COMPLETE

### Goals
- Schema diff engine using pg_dump with fresh Lakebase CLI credentials
- Unified diff panel showing code + schema changes side by side
- Migration parser tracking Flyway version state per branch
- SCM integration showing real schema differences via pg_dump
- Per-table Schema Diff webview following GitHub diff conventions

### Deliverables
6. ✅ **SchemaDiffService** — pg_dump comparison with fresh credentials for both branches; per-branch cache with migration-mtime invalidation and 10-minute max age; error results never cached
7. ✅ **Branch Diff WebView** — Two-column: code file changes (left) + schema changes (right); per-item diff for any branch without switching
8. ✅ **FlywayService** — Read migration files, track version state, per-branch via git ls-tree
9. ✅ **Unified Repo SCM** — Single "Unified Repo" in Source Control with flat "Code" and "Lakebase" groups; icons for added/modified/removed; clicking code files opens git diff; clicking schema items opens table diff
10. ✅ **Per-table Schema Diff** — Two-column production vs branch with GitHub diff conventions (empty panes for created/removed)
11. ✅ **Open in Databricks Console** — Per-branch link to Lakebase console URL
12. ✅ **Settings** — `showUnifiedRepo` (toggle Unified Repo in SCM), `productionReadOnly` (prevent deleting default branch)
13. ✅ **Test suite** — 120 unit tests across 9 suites; mocha + sinon + ts-node; vscode mock for testing outside extension host

---

## Phase 3: Workflow Automation 🔧 IN PROGRESS

### Goals
- Auto-branch creation hooking into VS Code git branch creation
- Background credential refresh
- PR integration showing GitHub PR status with schema diff from CI
- Merge awareness detecting merge to main

### Deliverables
14. ✅ **Auto-branch creation** — On `git checkout -b`, auto-creates Lakebase branch, gets endpoint + credentials, updates `.env`; respects `autoCreateBranch` config; always syncs `.env` connection on branch change even when auto-create is off
15. ✅ **Unified branch creation** — "Create Branch (Code + Database)" command: prompts for name, runs `git checkout -b`, creates Lakebase branch, connects, updates config — one click for both
16. ✅ **Live code change tracking** — Watches `.git/index` and file saves; debounced 1-second refresh; includes untracked files via `git ls-files`; code diff view on click
17. ✅ **Schema cache invalidation** — Cache cleared on migration file changes, Flyway migrate, and branch switch; migration watcher only refreshes code (not schema) to avoid re-caching stale data before Flyway runs
18. **Credential refresh** — Background task keeping database credentials alive
19. **PR integration** — GitHub PR status + schema diff from CI
20. **Merge awareness** — Production migration status on merge
21. **Full SCM integration** — Wrap standard git SCM capabilities into the Unified Repo view:
    - **Staged + Changes groups** — Split Code into "Staged" (git index) and "Changes" (unstaged + untracked); `git diff --cached --name-status` for staged, `git diff --name-status` + `git ls-files --others` for changes
    - **Stage file** — Inline `$(add)` action per file → `git add <file>`; moves file from Changes to Staged
    - **Unstage file** — Inline `$(remove)` action per staged file → `git reset <file>`; moves file back to Changes
    - **Discard changes** — Inline `$(discard)` action per file → `git checkout -- <file>` (tracked) or delete (untracked)
    - **Stage all / unstage all** — Group-level actions in `scm/resourceGroup/context`
    - **Commit** — Enable `scm.inputBox`; wire ✓ button and Ctrl+Enter via `acceptInputCommand` → `git commit -m <message>`; clear input box on success
    - **Push** — `$(cloud-upload)` in `scm/title` → `git push`
    - **Pull** — `$(cloud-download)` in `scm/title` → `git pull`
    - **Refresh** — After every git operation, refresh Staged + Changes groups
    - **GitService additions** — `stageFile`, `unstageFile`, `discardFile`, `commit`, `push`, `pull`, `getStagedChanges`
    - **Tests** — Stage/unstage/commit/discard/push/pull commands

---

## Phase 4: Unified Project Creation

### Goals
- One-step creation of a new GitHub repository + Lakebase database from within the extension
- Project scaffold template embedded in the extension
- Automated CI/CD setup (GitHub secrets, workflows)
- Open new project workspace when complete

### Template Structure

```
lakebase-sync/
├── templates/
│   └── project/
│       ├── .env.example
│       ├── .gitignore
│       ├── pom.xml
│       ├── mvnw
│       ├── .mvn/
│       ├── src/main/resources/db/migration/
│       │   └── V1__init_placeholder.sql
│       ├── src/main/resources/application.properties
│       ├── scripts/
│       │   ├── post-checkout.sh
│       │   ├── refresh-token.sh
│       │   ├── flyway-migrate.sh
│       │   └── install-hook.sh
│       └── .github/workflows/
│           ├── pr.yml
│           └── merge.yml
```

### Command: `lakebaseSync.createProject`

Available from Command Palette and Unified Repo SCM title bar.

### Execution Steps

| Step | Action | Method |
|------|--------|--------|
| 1 | Prompt for project name | `showInputBox` |
| 2 | Prompt for parent directory | `showOpenDialog` (folder picker) |
| 3 | Select Databricks workspace | Reuse existing `connectWorkspace` picker (lists workspaces with Lakebase) |
| 4 | Create Lakebase database | Databricks REST API (`POST /api/2.0/lakebase/projects`) using auth from `~/.databrickscfg` |
| 5 | Get project ID | From API response |
| 6 | Create GitHub repo | `gh repo create <name> --private --clone` in parent dir |
| 7 | Scaffold files | Copy `templates/project/` into repo; substitute `{{PROJECT_NAME}}`, `{{DATABRICKS_HOST}}`, `{{LAKEBASE_PROJECT_ID}}` placeholders |
| 8 | Write `.env` | Fill with real host, project ID, initial connection |
| 9 | Set GitHub secrets | `gh secret set DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `LAKEBASE_PROJECT_ID` |
| 10 | Install git hooks | Run `scripts/install-hook.sh` to symlink post-checkout |
| 11 | Initial commit + push | `git add . && git commit && git push` |
| 12 | Open workspace | `vscode.commands.executeCommand('vscode.openFolder', uri)` |
| 13 | Run health check | Auto-run `lakebaseSync.healthCheck` to verify all components are in place (workflows, secrets, CLI auth, hooks, migration dir) |

### Deliverables
21. **Project scaffold template** — Embedded in extension under `templates/project/`; stripped of demo-specific code; placeholder substitution at creation time
22. **Lakebase project creation via REST API** — `POST /api/2.0/lakebase/projects` with OAuth token from CLI config
23. **GitHub repo creation** — `gh repo create` with secrets setup
24. **Create Project command** — Full wizard with progress notification; each step logged; graceful failure (partial creation preserved)
25. **`.vscodeignore` update** — Include `templates/` in packaged extension
26. **Disable built-in Git SCM in workspace** — Scaffold includes `.vscode/settings.json` with `"git.enabled": false` so the built-in Git SCM is hidden and the Unified Repo is the only SCM view for the project

### Open Questions
- Verify exact Databricks REST API endpoint for Lakebase project creation
- Auth token reuse from `~/.databrickscfg` for REST calls
- Default project settings (region, size, etc.)

---

## Phase 5: Advanced

### Goals
- Data preview querying branch database from VS Code
- Conflict detection warning when two branches modify the same tables
- Branch comparison between any two Lakebase branches
- Cursor AI integration exposing database context

### Deliverables
26. **Data preview** — Read-only table viewer for branch databases
27. **Conflict detection** — Table-level conflict warnings
28. **Branch comparison** — Any-to-any Lakebase branch diff
29. **Cursor AI context** — Schema-aware code generation

---

## Extension Structure

```
lakebase-sync/
├── package.json              # Extension manifest, contributions, commands
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js         # Bundling configuration
├── src/
│   ├── extension.ts          # Activation, command registration
│   ├── providers/
│   │   ├── branchTreeProvider.ts    # Tree view data provider
│   │   ├── statusBarProvider.ts     # Status bar management
│   │   ├── schemaDiffProvider.ts    # Branch diff + table diff webviews
│   │   └── schemaScmProvider.ts     # Unified Repo SCM (Code + Lakebase groups)
│   ├── services/
│   │   ├── lakebaseService.ts       # Databricks CLI wrapper + console URLs
│   │   ├── gitService.ts            # Git operations + event watching + diff content
│   │   ├── flywayService.ts         # Migration parsing + execution
│   │   └── schemaDiffService.ts     # pg_dump diff generation + per-branch cache
│   └── utils/
│       └── config.ts                # .env + settings management + connection updates
├── templates/
│   └── project/                     # Project scaffold template (Phase 4)
├── resources/
│   └── icons/                       # Tree view icons
├── test/
│   ├── setup.js                     # vscode module mock loader
│   ├── mocks/
│   │   └── vscode.js                # Full vscode API mock
│   └── suite/
│       ├── config.test.ts
│       ├── flywayService.test.ts
│       ├── gitService.test.ts
│       ├── lakebaseService.test.ts
│       ├── schemaDiffService.test.ts
│       ├── schemaDiffProvider.test.ts
│       ├── schemaScmProvider.test.ts
│       ├── branchTreeProvider.test.ts
│       ├── statusBarProvider.test.ts
│       └── autoBranchCreation.test.ts
└── .vscodeignore
```

## Configuration

```jsonc
{
  "lakebaseSync.databricksHost": "",            // Auto-read from .env
  "lakebaseSync.lakebaseProjectId": "",         // Auto-read from .env
  "lakebaseSync.autoCreateBranch": true,        // Create DB branch on git checkout
  "lakebaseSync.autoRefreshCredentials": true,   // Background credential refresh
  "lakebaseSync.showUnifiedRepo": true,         // Show Unified Repo in SCM
  "lakebaseSync.productionReadOnly": true,      // Prevent deleting default branch
  "lakebaseSync.migrationPath": "src/main/resources/db/migration"
}
```

## Design Decisions

1. **CLI-based, not API-based** — Wraps `databricks` CLI rather than calling REST APIs directly. Reuses existing auth (OAuth, PAT) and avoids token management complexity. Exception: Lakebase project creation (Phase 4) uses REST API since the CLI doesn't support `create-project`.
2. **Event-driven, not polling** — Uses VS Code FileSystemWatcher and git extension events rather than polling Lakebase API. File saves and git index changes trigger debounced code refreshes.
3. **Schema diff at multiple layers** — Per-branch cache with migration-mtime invalidation for speed; pg_dump for accuracy; cache cleared on migration changes, Flyway runs, and branch switches.
4. **Complements existing hooks** — Provides visibility into what post-checkout and prepare-commit-msg hooks do, does not replace them. Auto-branch creation syncs `.env` on every branch change.
5. **Cursor-compatible** — Standard VS Code extension, automatically works in Cursor. Phase 5 adds Cursor-specific AI context.
6. **Unified Repo SCM** — Single flat view with Code and Lakebase groups; no sub-folders for status types; icons convey added/modified/removed; clicking code files opens git diff against merge-base.

## Commands

```
Lakebase: Show Branch Status
Lakebase: Branch Diff (any branch, cached or fresh)
Lakebase: Schema Diff (per-table)
Lakebase: Run Flyway Migrate
Lakebase: Refresh Database Credentials
Lakebase: Create Branch (Lakebase only)
Create Branch (Code + Database)
Lakebase: Delete Branch
Lakebase: Connect to Workspace
Lakebase: Open in Databricks Console
Lakebase: Show Migration History
Create Unified Project (Phase 4)
```
