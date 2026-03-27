# Lakebase Sidebar Tree Views — Implementation Plan

## Overview

Reproduce the Git + Lakebase SCM functionality in the Lakebase sidebar. The SCM provider stays unchanged. The sidebar tree views read from the SCM provider's resource states and delegate all actions to the same commands.

**Principle:** Minimal changes to `SchemaScmProvider` (public accessors + event only). New code for sidebar views. All existing tests continue to pass.

---

## Phase A: Foundation — Expose SCM data + register views ✅ COMPLETE

### Goal
Wire the plumbing without changing any existing behavior.

### What was done
- [x] Added 7 public methods to `SchemaScmProvider`: `getStaged()`, `getCode()`, `getLakebase()`, `getMigrations()`, `getMerges()`, `getPr()`, `getSync()`
- [x] Added `onDidRefresh: Event<void>` — fires after every `refresh()`, `refreshCodeOnly()`, and `refreshMainBranch()`
- [x] Registered 5 views in `package.json` under `lakebase-synced-scm` view container: Changes, Schema Migrations, Pull Request, Recent Merges (Lakebase view later merged into Changes)
- [x] Created tree data providers for all views
- [x] Registered providers in `extension.ts`
- [x] Badge count on activity bar icon (staged + unstaged + schema changes)

### New files
- `src/providers/changesTreeProvider.ts`
- `src/providers/lakebaseSchemaTree.ts` (later merged into Changes)
- `src/providers/migrationsTree.ts`
- `src/providers/pullRequestTree.ts`
- `src/providers/mergesTree.ts`

---

## Phase B: Changes view — Full SCM parity ✅ COMPLETE

### Goal
The Changes view shows the same files as the SCM Staged + Code groups, with identical rendering and actions.

### What was done
- [x] `ChangesTreeProvider` reads from `getStaged()`, `getCode()`, `getLakebase()`, `getSync()`
- [x] Three groups: Staged, Code (renamed from "Changes"), Lakebase (moved from standalone view)
- [x] File rendering mirrors SCM: file-type icons from VS Code icon theme, status decorations (M/A/D/R) via `resourceUri`, relative directory as description
- [x] List/tree toggle with title bar button; tree mode collapses single-child directory chains
- [x] Inline actions on files: Stage (+), Discard (↩) on unstaged; Unstage (−) on staged
- [x] Inline actions on group headers: Stage All, Discard All on Code; Unstage All on Staged
- [x] Title bar: Commit, Publish, Create PR, Refresh, Review Branch
- [x] Full overflow menu with all 9 submenus (Commit, Changes, Pull/Push, Branch, Stash, Tags, Remote, Worktrees, Lakebase) + Show Git Output
- [x] Sync Changes group when ahead/behind > 0
- [x] Lakebase subgroup shows schema changes from uncommitted migrations

---

## Phase C: Lakebase schema → Merged into Changes ✅ COMPLETE

### What was done
The standalone Lakebase view was created then merged into the Changes view as a subgroup after Code. The `lakebaseSchemaTree.ts` provider file still exists but the view registration was removed from `package.json`. Schema changes appear directly under the "Lakebase" group in the Changes view.

---

## Phase D: Schema Migrations view ✅ COMPLETE

### What was done
- [x] `MigrationsTreeProvider` reads from `getMigrations()`
- [x] Each item clickable to open the migration file
- [x] Hidden on feature branches via `when` clause: `!lakebaseSync.onFeatureBranch`

---

## Phase E: Pull Request view ✅ COMPLETE

### What was done
- [x] `PullRequestTreeProvider` reads from `getPr()`
- [x] Shows PR status item + CI branch item
- [x] Title bar: Merge, Schema Diff, Refresh
- [x] Hidden when no PR via `when` clause: `lakebaseSync.hasPR`

---

## Phase F: Recent Merges view ✅ COMPLETE

### What was done
- [x] `MergesTreeProvider` reads from `getMerges()`
- [x] Each item clickable to open commit on GitHub
- [x] Hidden on feature branches via `when` clause

---

## Phase G: Project view — Restructured from Branches ✅ COMPLETE

### Goal (evolved from original plan)
The original "Branches" view was restructured into a "Project" view that serves as the primary control surface, mirroring the SCM repo item.

### What was done
- [x] Root item shows repo name (from git remote) + "Git + Lakebase" description
- [x] Full inline action bar on root: Checkout, Publish, Commit, Create PR, Refresh, Review Branch, Branch Diff Summary
- [x] Full overflow menu on root: Pull, Push, Clone, Fetch + all 9 submenus + Show Git Output
- [x] View title bar: Connect to Workspace + Refresh
- [x] Expandable project details:
  - GitHub repo (org/repo, clickable to browser)
  - Lakebase project display name + workspace URL (clickable; fetched via `getProjectDisplayName()` API)
  - Connection status via Lakebase auth check
  - Current Branch section (expanded by default)
  - Other Branches section (collapsed by default)
- [x] Expandable branch details:
  - **Git tracking** (`fileList`) — all changed files vs main with diff icons; click opens diff
  - **Database** (`tableList`) — color-coded tables: green (new), amber (modified), red (removed), white (unchanged); click opens DDL or diff; column count + tooltip; compares branch migrations against main
  - **Endpoint status** — ACTIVE/INACTIVE
  - **Schema migrations** (`migrationList`) — individual V*.sql files with parsed descriptions; click opens file
- [x] Non-current branches: Branch Diff, Switch, Open in Console, Delete actions
- [x] Lakebase-only branches (ci-pr-*, orphaned) shown under Other Branches

---

## Phase H: Additional improvements ✅ COMPLETE

### What was done
- [x] `SchemaContentProvider` falls back to migration file parsing when no pg_dump cache
- [x] Graceful branch switch: catches "local changes would be overwritten" error; offers Stash & Switch, Commit First, Cancel
- [x] `LakebaseService.getProjectDisplayName()` — fetches display name from `databricks postgres list-projects`
- [x] Updated sidebar icon (Lakebase bars + SCM composite SVG)
- [x] Renamed "Unified Branch Diff Summary" → "Branch Diff Summary"
- [x] README updated to document Lakebase sidebar as primary interface

---

## Phase I: Graph webview — Not started

### Goal
Visual commit graph in the Lakebase sidebar.

### Steps
- [ ] Register a webview view: `lakebaseGraph` — "Graph"
- [ ] `GraphWebviewProvider` implements `WebviewViewProvider`
- [ ] Runs `git log --graph --oneline --all --decorate -30`
- [ ] Renders as HTML with branch lines, colors, commit dots, Lakebase pairing annotations
- [ ] Refreshes on branch change via `schemaScmProvider.onDidRefresh`

---

## Phase J: Full parity test — Not started

### Goal
Verify every action works from both the SCM view and the Lakebase sidebar.

### Steps
- [ ] Walk through the complete workflow using ONLY the Lakebase sidebar
- [ ] Walk through the same workflow using ONLY the SCM view
- [ ] Verify both produce identical results
- [ ] Document any differences

---

## Summary

| Phase | What | Status |
|-------|------|--------|
| A | Foundation + view registration | ✅ Complete |
| B | Changes view with full SCM parity | ✅ Complete |
| C | Lakebase schema (merged into Changes) | ✅ Complete |
| D | Schema Migrations view | ✅ Complete |
| E | Pull Request view | ✅ Complete |
| F | Recent Merges view | ✅ Complete |
| G | Project view (restructured from Branches) | ✅ Complete |
| H | Additional improvements | ✅ Complete |
| I | Graph webview | Not started |
| J | Full parity test | Not started |

**Result:** v0.3.5 — 299 tests, full sidebar with 5 views, dual interface (sidebar + SCM), expandable branch details with color-coded table status, list/tree toggle, graceful error handling.
