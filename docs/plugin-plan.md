# Lakebase SCM Extension — VS Code / Cursor Extension Plan

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
┌──────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                     │
├──────────────┬────────────────┬──────────────────────────────┤
│  Lakebase    │  SCM Provider  │  Webview Panels              │
│  Sidebar     │  (Git+Lakebase)│                              │
│  ┌─────────┐ │  ┌──────────┐  │  ┌─────────────────────────┐ │
│  │ Project │ │  │ Staged   │  │  │ Branch Diff Summary     │ │
│  │ Changes │ │  │ Code     │  │  │ Table Diff              │ │
│  │ Schema  │ │  │ Lakebase │  │  │ Health Check            │ │
│  │ Migr.   │ │  │ PR       │  │  │ PR Schema Diff          │ │
│  │ PR      │ │  │ Migr.    │  │  └─────────────────────────┘ │
│  │ Merges  │ │  │ Merges   │  │                              │
│  └─────────┘ │  └──────────┘  │  Status Bar                  │
│              │                │  - Branch picker             │
│              │                │  - Sync indicator            │
│              │                │  - Lakebase status           │
├──────────────┴────────────────┴──────────────────────────────┤
│                      Service Layer                            │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ GitService   │  │ LakebaseServ │  │ SchemaDiffService    │ │
│  │ - branch ops │  │ - branch CRUD│  │ - pg_dump comparison │ │
│  │ - staging    │  │ - endpoints  │  │ - per-branch cache   │ │
│  │ - commit     │  │ - credentials│  │ - migration parsing  │ │
│  │ - PR via gh  │  │ - console URL│  │                      │ │
│  │ - ahead/behind│ │ - display name│ │                      │ │
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
│  │          │  │   list-projects   │  │                    │ │
│  └──────────┘  └───────────────────┘  └────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ pg_dump (PostgreSQL client)                              │ │
│  │ - schema-only dumps for branch vs production comparison  │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
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

## Phase 3: Workflow Automation ✅ COMPLETE

### Goals
- Auto-branch creation hooking into VS Code git branch creation
- Background credential refresh
- Full Git SCM parity with Lakebase sync on every operation
- PR integration showing GitHub PR status with schema diff from CI
- Merge awareness detecting merge to main, showing production status

### Deliverables
14. ✅ **Auto-branch creation** — On `git checkout -b`, auto-creates Lakebase branch, gets endpoint + credentials, updates `.env`; respects `autoCreateBranch` config; always syncs `.env` connection on branch change even when auto-create is off
15. ✅ **Unified branch creation** — "Create Branch (Code + Database)" command: prompts for name, runs `git checkout -b`, creates Lakebase branch, connects, updates config — one click for both
16. ✅ **Live code change tracking** — Watches `.git/index` and file saves; debounced 1-second refresh; includes untracked files via `git ls-files`; code diff view on click; Git SCM parity (Code group shows working tree, not branch scope)
17. ✅ **Schema cache invalidation** — Cache cleared on migration file changes, Flyway migrate, and branch switch; migration watcher only refreshes code (not schema) to avoid re-caching stale data before Flyway runs
18. ✅ **Background credential refresh** — 20-minute interval; gets fresh credentials for current branch; updates `.env` and `application-local.properties`; respects `autoRefreshCredentials` setting; restarts on setting change
19. ✅ **Full SCM integration** — Complete Git parity with Lakebase sync:
    - **Staged + Code groups** — Staged shows git index; Code shows unstaged working tree changes (matches Git SCM CHANGES behavior)
    - **Stage/unstage/discard** — Inline actions per file; stage all / unstage all on group headers
    - **Commit** — Auto-stages all if nothing staged; Commit Staged, Commit All, Undo Last Commit, Abort Rebase, Amend variants, Signed Off variants
    - **Push/Pull/Sync/Fetch** — Pull, Pull (Rebase), Pull from..., Push, Push to..., Sync, Fetch, Fetch (Prune), Fetch From All Remotes
    - **Branch** — Merge..., Rebase Branch..., Create Branch..., Create Branch From..., Rename Branch..., Delete Branch..., Delete Remote Branch..., Publish Branch...
    - **Stash** — Stash, Stash (Include Untracked), Stash Staged, Apply/Pop (Latest and picker), Drop/Drop All, View Stash...
    - **Tags** — Create Tag, Delete Tag, Delete Remote Tag
    - **Worktrees** — Create Worktree, List Worktrees, Delete Worktree
    - **Remote** — Add Remote..., Remove Remote...
    - **Clone** — Clone repository to local directory
    - **Lakebase sync on all operations** — branch delete/rename/merge sync Lakebase branches; pull/stash/undo/discard clear schema cache; publish shows Lakebase branch name
    - **Submenus with separators** — Full More Actions menu matching Git SCM structure
20. ✅ **PR integration** — Create PR with auto-secret sync (generates fresh Databricks token); PR group in SCM view with CI status polling (30s); View PR Schema Diff (live pg_dump fallback when no CI comment); Merge Pull Request (merge/squash/rebase with auto-checkout main); pre-flight secret check before PR creation
21. ✅ **Merge awareness** — On main: Lakebase group shows production branch status; Schema Migrations group lists all V*.sql files; Recent Merges group shows last 5 merge commits with PR titles linking to GitHub
22. ✅ **Branch picker** — Status bar shows `⑂ branch*` with Lakebase pairing; click opens QuickPick with local + remote branches, each showing Lakebase branch; actions: Create, Create From, Checkout Detached; remote branches checkout with tracking
23. ✅ **Sync indicator** — Status bar shows `⟳ N↓ M↑` with ahead/behind counts; Sync Changes group appears when behind/ahead; click syncs with Lakebase credential refresh
24. ✅ **Review Branch** — Multi-diff editor via `vscode.changes` API showing all code + schema DDL diffs; Branch Diff Summary webview with two-column layout
25. ✅ **Health check** — Validates workflows, secrets, CLI auth, gh CLI, migration directory, post-checkout hook; webview panel with ✅/❌ per item
26. ✅ **Open in Databricks Console** — Per-branch console URL using branch UID; CI branch resolves to correct `ci-pr-<N>` UID
27. ✅ **Test suite** — 277 tests across 15 suites covering all services, providers, git operations, Lakebase sync, branch picker, merge awareness, and PR integration

---

## Phase 3.5: Lakebase Sidebar ✅ COMPLETE (v0.3.5)

### Goals
- Reproduce the full SCM functionality in the Lakebase sidebar
- Provide an alternative to the SCM view with richer branch and schema exploration
- Full feature parity: every action available from the SCM view is available from the sidebar

### Deliverables
28. ✅ **SchemaScmProvider public API** — Added 7 public accessors (`getStaged()`, `getCode()`, `getLakebase()`, `getMigrations()`, `getMerges()`, `getPr()`, `getSync()`) and `onDidRefresh` event firing after every refresh cycle
29. ✅ **Project view** — Repo name + "Git + Lakebase" root item with full inline action bar (Checkout, Publish, Commit, Create PR, Refresh, Review Branch, Branch Diff Summary) and complete overflow menu (9 submenus + top actions). Expandable to show:
    - GitHub repo link (clickable, opens browser)
    - Lakebase project display name + workspace URL (clickable, opens workspace; fetched via `getProjectDisplayName()` API)
    - Connection status via auth check
    - Current Branch section with expandable branch details
    - Other Branches section with Lakebase-only branches
30. ✅ **Expandable branch details** — Each branch expands to show:
    - **Git tracking** (`fileList`) — Collapsible; shows all changed files vs main with diff status icons (green/yellow/red/blue); click opens diff view or file
    - **Database** (`tableList`) — Collapsible; color-coded tables: green (new), amber (modified), red (removed), white (unchanged); click opens CREATE TABLE DDL or production-vs-branch diff; column count + tooltip with column definitions; compares branch migrations against main to determine status
    - **Endpoint status** — ACTIVE/INACTIVE indicator
    - **Schema migrations** (`migrationList`) — Collapsible; lists individual V*.sql files with parsed descriptions; click opens file
31. ✅ **Changes view** — Three groups: Staged, Code (renamed from Changes), Lakebase (moved from standalone view):
    - **File rendering** — Mirrors SCM exactly: file-type icons from VS Code icon theme, status decorations (M/A/D/R) on the right via `resourceUri`, relative directory path as description
    - **List/tree toggle** — Title bar button switches between flat list and folder-grouped tree view with collapsed single-child directory chains
    - **Inline actions on files** — Stage (+), Discard (↩) on unstaged; Unstage (−) on staged
    - **Inline actions on group headers** — Stage All (+), Discard All (↩) on Code group; Unstage All (−) on Staged group
    - **Title bar** — Commit, Publish, Create PR, Refresh, Review Branch + full overflow menu with all 9 submenus
    - **Lakebase subgroup** — Schema changes from uncommitted migration files (moved from standalone view)
    - **Sync Changes** — Shows ahead/behind status when out of sync
32. ✅ **Schema Migrations view** — All V*.sql files on main branch; `when` clause hides on feature branches
33. ✅ **Pull Request view** — PR status + CI branch with merge/schema diff/refresh title bar actions; `when` clause shows only when PR exists
34. ✅ **Recent Merges view** — Last 5 merge commits on main with PR titles; clickable to GitHub
35. ✅ **Badge count** — Activity bar icon shows pending change count (staged + unstaged + schema)
36. ✅ **SchemaContentProvider fallback** — Falls back to parsing migration files for table DDL when no pg_dump cache is available, so table definitions are always viewable
37. ✅ **Graceful branch switch** — Catches "local changes would be overwritten" error; offers Stash & Switch, Commit First, or Cancel
38. ✅ **LakebaseService.getProjectDisplayName()** — Fetches human-readable project name from `databricks postgres list-projects` API
39. ✅ **Updated sidebar icon** — New SVG with Lakebase bars + SCM symbol
40. ✅ **Renamed** — "Unified Branch Diff Summary" → "Branch Diff Summary"
41. ✅ **Test suite** — 299 tests across 16 suites; all existing tests preserved; new tests for Project view hierarchy

### Files created
- `src/providers/changesTreeProvider.ts` — Changes view with Staged/Code/Lakebase groups, list/tree toggle
- `src/providers/migrationsTree.ts` — Schema Migrations view
- `src/providers/pullRequestTree.ts` — Pull Request view
- `src/providers/mergesTree.ts` — Recent Merges view
- `src/providers/lakebaseSchemaTree.ts` — (Created but later merged into Changes view as Lakebase subgroup)

### Files modified
- `src/providers/schemaScmProvider.ts` — Public accessors + `onDidRefresh` event
- `src/providers/branchTreeProvider.ts` — Restructured as Project view with expandable branch details, table color coding, migration listing, file listing
- `src/providers/schemaContentProvider.ts` — Migration file parsing fallback
- `src/providers/schemaDiffProvider.ts` — Renamed to "Branch Diff Summary"
- `src/services/lakebaseService.ts` — `getProjectDisplayName()` method
- `src/extension.ts` — Register sidebar views, badge count, list/tree toggle commands, graceful branch switch
- `package.json` — 5 sidebar views, view/title menus, view/item/context menus with inline actions, overflow submenus, version bump to 0.3.5
- `test/suite/branchTreeProvider.test.ts` — Updated for Project view hierarchy

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

Available from Command Palette and Project view title bar.

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
42. **Project scaffold template** ✅ — 21 files in `templates/project/` (16 scripts, 2 workflows, .env.example, .gitignore, .vscode/settings.json, V1 migration placeholder). Deployed by `ScaffoldService`.
43. **Lakebase project creation** ✅ — `LakebaseService.createProject()` via `databricks postgres create-project` CLI (not REST API — CLI supports it now). Includes `setProjectIdOverride()` for test contexts.
44. **GitHub repo creation** ✅ — `GitService.createRepo()` via `gh repo create` with visibility, description. `syncCiSecrets()` sets DATABRICKS_HOST, LAKEBASE_PROJECT_ID, DATABRICKS_TOKEN.
45. **Create Project command** ✅ — `lakebaseSync.createProject` wizard with 7-step UI flow: project name → parent dir → GitHub auth gate (web login) → repo name (defaults from project name) → visibility → Databricks workspace picker + auth gate → Lakebase project name (defaults from repo name) → execute with progress → offer to open folder. Cleanup on failure.
46. **`.vscodeignore` update** ✅ — `templates/` included in packaged extension (82 files, ~216KB).
47. **Disable built-in Git SCM in workspace** ✅ — `.vscode/settings.json` with `"git.enabled": false` deployed by `ScaffoldService.deployVscodeSettings()`.

### Resolved Questions
- Lakebase project creation uses `databricks postgres create-project` CLI (not REST API)
- Auth reuses existing `databricks auth login` session from `~/.databrickscfg`
- Default project settings handled by Lakebase backend (auto-provisions default branch + endpoint)

---

## Phase 5: Advanced

### Goals
- Data preview querying branch database from VS Code
- Conflict detection warning when two branches modify the same tables
- Branch comparison between any two Lakebase branches
- Cursor AI integration exposing database context
- Visual commit graph in the Lakebase sidebar

### Deliverables
48. **Data preview** — Read-only table viewer for branch databases
49. **Conflict detection** — Table-level conflict warnings
50. **Branch comparison** — Any-to-any Lakebase branch diff
51. **Cursor AI context** — Schema-aware code generation
52. **Graph webview** — Visual commit graph with branch lines, Lakebase pairing annotations, and clickable commits ✅ (v0.3.7)
53. **Adopt STATUS_ICONS/STATUS_COLORS from theme.ts** — Replace all inline icon/color object literals in schemaScmProvider.ts (3 maps), branchTreeProvider.ts (3 maps + inline assignments), and pullRequestTree.ts (1 map) with imports from `src/utils/theme.ts`. The constants exist but are not yet consumed by callers.
54. **Evaluate pg_dump vs migration SQL parsing consolidation** — `schemaDiffService.parsePgDumpTables` and `FlywayService.parseSql` both parse CREATE TABLE statements but from different sources and with different regex patterns. Determine whether these should share a common parser or remain separate. Investigation needed:
    - `parsePgDumpTables` parses `pg_dump --schema-only` output: no `IF NOT EXISTS`, no `public.` prefix, includes `CONSTRAINT` lines, output is a complete DDL dump of all tables
    - `FlywayService.parseSql` parses hand-written migration SQL: includes `IF NOT EXISTS`, may have `public.` prefix, mixed with ALTER/DROP statements, output is incremental changes
    - Key question: are the regex differences driven by actual format differences in pg_dump vs migration SQL, or are they accidental divergence that should be unified?

---

## Extension Structure

```
lakebase-scm-extension/
├── package.json              # Extension manifest, contributions, commands, views, menus
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js         # Bundling configuration
├── src/
│   ├── extension.ts          # Activation, command registration, view registration
│   ├── providers/
│   │   ├── branchTreeProvider.ts    # Project view: repo identity, branches, expandable details
│   │   ├── changesTreeProvider.ts   # Changes view: Staged, Code, Lakebase, list/tree toggle
│   │   ├── migrationsTree.ts        # Schema Migrations view
│   │   ├── pullRequestTree.ts       # Pull Request view
│   │   ├── mergesTree.ts            # Recent Merges view
│   │   ├── lakebaseSchemaTree.ts    # Standalone Lakebase schema view (now merged into Changes)
│   │   ├── statusBarProvider.ts     # Status bar management
│   │   ├── schemaDiffProvider.ts    # Branch Diff Summary + table diff webviews
│   │   ├── schemaContentProvider.ts # DDL content for multi-diff (with migration fallback)
│   │   └── schemaScmProvider.ts     # SCM provider with public accessors + onDidRefresh
│   ├── services/
│   │   ├── lakebaseService.ts       # Databricks CLI wrapper + console URLs + display name
│   │   ├── gitService.ts            # Git operations + event watching + diff content
│   │   ├── flywayService.ts         # Migration parsing + execution
│   │   └── schemaDiffService.ts     # pg_dump diff generation + per-branch cache
│   └── utils/
│       └── config.ts                # .env + settings management + connection updates
├── resources/
│   └── icons/
│       ├── lakebase-sidebar.svg     # Activity bar icon (Lakebase + SCM composite)
│       └── extension-icon.png       # Marketplace icon
├── templates/
│   └── project/                     # Project scaffold template (Phase 4)
├── docs/
│   ├── plugin-plan.md               # This file
│   └── sidebar-plan.md              # Original sidebar implementation plan
├── test/
│   ├── setup.js                     # vscode module mock loader
│   ├── mocks/
│   │   └── vscode.js                # Full vscode API mock
│   └── suite/                       # 299 tests across 16 suites
│       ├── config.test.ts
│       ├── flywayService.test.ts
│       ├── gitService.test.ts
│       ├── lakebaseService.test.ts
│       ├── schemaDiffService.test.ts
│       ├── schemaDiffProvider.test.ts
│       ├── schemaScmProvider.test.ts
│       ├── branchTreeProvider.test.ts
│       ├── statusBarProvider.test.ts
│       ├── autoBranchCreation.test.ts
│       ├── branchPicker.test.ts
│       ├── branchReview.test.ts
│       ├── gitOperations.test.ts
│       ├── lakebaseSync.test.ts
│       ├── mergeAwareness.test.ts
│       └── ciSecrets.test.ts
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
3. **Schema diff at multiple layers** — Per-branch cache with migration-mtime invalidation for speed; pg_dump for accuracy; migration parsing as fallback; cache cleared on migration changes, Flyway runs, and branch switches.
4. **Complements existing hooks** — Provides visibility into what post-checkout and prepare-commit-msg hooks do, does not replace them. Auto-branch creation syncs `.env` on every branch change.
5. **Cursor-compatible** — Standard VS Code extension, automatically works in Cursor. Phase 5 adds Cursor-specific AI context.
6. **Dual interface** — Both the Lakebase sidebar (recommended) and SCM view provide full functionality. The sidebar offers richer exploration (expandable branch details, color-coded tables, migration files) while the SCM view provides the familiar Git workflow with a commit input box.
7. **Graceful degradation** — Schema content provider falls back to migration file parsing when pg_dump cache is unavailable. Branch switch offers stash/commit options when working tree is dirty. Auth failures prompt reconnection.

## Phase 6: Remaining Cleanup

### Goals
- Wire DiffService into callers
- Surface command-palette-only commands in menus
- Eliminate remaining raw execSync in GraphService

### Deliverables
55. **Wire DiffService into callers** — extension.ts `reviewBranch` and graphWebview.ts `reviewCommit`/`buildComparisonTuples` currently build tuples inline. Rewire to call `DiffService.reviewBranch()`, `DiffService.reviewCommitTwoPane()`, and `DiffService.compareRefs()`.
56. **Add menu placements for orphaned commands** — 6 commands are registered but only accessible via Command Palette:
    - `lakebaseSync.refreshCredentials` — Refresh Database Credentials
    - `lakebaseSync.runMigrate` — Run Flyway Migrate
    - `lakebaseSync.showMigrationHistory` — Show Migration History
    - `lakebaseSync.showBranchStatus` — Show Branch Status
    - `lakebaseSync.createBranch` — Create Lakebase Branch (db-only)
    - `lakebaseSync.showCachedBranchDiff` — Branch Diff (Cached)
    Add these to appropriate menus (Lakebase submenu, Project view context, or view title bars).
57. **Eliminate remaining execSync in GraphService** — ✅ Partial: `fetchAvatars()` now uses `gitService.getCurrentBranch()` + `gitService.ghApi()`. Remaining: `getCommits()` still uses `execSync` for batch git log — refactor to use `GitService.getLogRaw()` + `getLogShortstat()` (already exist).

---

## Summary

| Phase | What | Status | Version |
|-------|------|--------|---------|
| 1 | Foundation (MVP) | ✅ Complete | — |
| 2 | Diff & Visibility | ✅ Complete | — |
| 3 | Workflow Automation | ✅ Complete | — |
| 3.5 | Lakebase Sidebar | ✅ Complete | v0.3.5 |
| 4 | Unified Project Creation | ✅ Complete | v0.4.0 |
| 5 | Advanced Features | Partially complete | v0.3.7 (Graph), v0.3.8 (Refactoring) |
| 5.5 | R1-R8 Refactoring | ✅ Complete | v0.3.8 |
| 6 | Remaining Cleanup | Partially complete | v0.4.0 (#57 partial) |

**Current state:** v0.4.0

### v0.4.0 changelog:
- **Create New Project command** — 9-step wizard: project name → parent dir → GitHub auth gate (web login) → repo name → visibility → language picker (Java/Python/Node.js) → Databricks workspace picker + auth gate → Lakebase project name → execute with progress. Cascading defaults, cleanup on failure, opens project folder on success.
- **Multi-language templates** — Templates restructured into `common/` + `java/` + `python/` + `nodejs/`. Java: Maven/Spring Boot/Flyway/JPA. Python: FastAPI/Alembic/SQLAlchemy/pytest. Node.js: Express/Knex/pg/Jest. Smart `flyway-migrate.sh` and `run-tests.sh` detect language via marker files.
- **Self-hosted CI Runner** — `RunnerService` manages persistent local runners at `~/.lakebase/runners/{project}/`. Auto-deployed during project creation (before initial commit so merge.yml has a runner). Binary cached at `~/.cache/github-actions-runner/`.
- **CI Runner sidebar view** — Top-level view (peer to Project, Changes, Graph). Shows: status (running/stopped), start/stop actions, runner log, job log, collapsible Recent Runs with workflow history (green/red/spinning icons, click opens GitHub), runner name.
- **Live branch table queries** — Sidebar tree queries actual Lakebase database tables via `queryBranchSchema()` with diff indicators (green +new, yellow ~modified, red -removed vs production). Production shows all tables in white. Feature branches show only diffs. Clicking tables opens diff view (production ↔ branch DDL).
- **PR flow fix** — Complete pipeline: detect uncommitted changes → commit → detect unpushed branch → push → create PR. Previously dropped user after commit. PR status now deduplicates check runs by name (latest wins), so retried checks show correct green/red.
- **Lakebase console URL fix** — Uses project UUID instead of project name.
- **GitHub avatar fix** — Queries current branch commits (not just default branch). Removed Gravatar fallback.
- **Template fixes:**
  - pr.yml/merge.yml: use `.name` (full resource path) for source_branch, not `.uid`
  - merge.yml: fix sed `\t` bug in branch name extraction
  - pr.yml: add `permissions: pull-requests: write` for PR comments
  - pr.yml: removed redundant Flyway migrate on feature branch (developer already did this locally)
  - pr.yml: feature Lakebase branch no longer created from ci-pr-N (was causing parent-child relationship that blocked cleanup)
  - delete-lakebase-branches.sh: delete feature branches before CI branches
  - flyway-migrate.sh / run-tests.sh: detect language (pom.xml/requirements.txt/package.json)
- **Runner reliability:**
  - `stopRunner` kills child `.NET Runner.Listener`/`.Worker` processes via `pkill -f` (not just the bash wrapper)
  - Clears `_diag/pages`, `_work/_temp`, `_work/_actions` on stop/restart to prevent stale file errors
  - CI secrets sync timeouts increased from 10-15s to 30s
- **E-commerce integration test suite** — 8 scenarios with ephemeral self-hosted runner, given/when/then Java tests against live Lakebase branch DBs, pause gate for step-by-step debugging

### Known issues / tech debt:
- `actions/setup-java@v4` in common workflow templates hangs on self-hosted runners when Maven Central is unreachable. The `mavenProject.ts` test helper patches this to use local JDK, but existing projects need manual workflow update.
- Runner zombie processes can still occur if the extension crashes mid-operation. The `stopRunner` pkill fix handles most cases but edge cases remain.
- `GraphService.getCommits()` still uses `execSync` for the batch git log operation (Phase 6 #57 remaining).
- Extension.ts still has some direct `cp.execSync` calls for health checks (`databricks --version`, `gh --version`) and secret listing — these are simple availability checks, not service-layer operations.
- E-commerce integration tests: **179 passing, 0 failing** (all 8 scenarios complete end-to-end, 29 min).
