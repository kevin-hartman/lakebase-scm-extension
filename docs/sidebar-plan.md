# Lakebase Sidebar Tree Views — Implementation Plan

## Overview

Reproduce the Git + Lakebase SCM functionality in the Lakebase sidebar. The SCM provider stays unchanged. The sidebar tree views read from the SCM provider's resource states and delegate all actions to the same commands.

**Principle:** No changes to `SchemaScmProvider`. New code only. All existing tests continue to pass at every checkpoint.

---

## Phase A: Foundation — Expose SCM data + register empty views

**Status:** Not started

### Goal
Wire the plumbing without changing any existing behavior.

### Steps

- [ ] Add public methods to `SchemaScmProvider`:
  - `getStaged(): SourceControlResourceState[]`
  - `getCode(): SourceControlResourceState[]`
  - `getLakebase(): SourceControlResourceState[]`
  - `getMigrations(): SourceControlResourceState[]`
  - `getMerges(): SourceControlResourceState[]`
  - `getPr(): SourceControlResourceState[]`
  - `getSync(): SourceControlResourceState[]`
  - `onDidRefresh: Event<void>` — fires after every `refresh()` and `refreshCodeOnly()`
- [ ] Register 5 new views in `package.json` under `lakebase-synced-scm` view container:
  - `lakebaseChanges` — "Changes"
  - `lakebaseSchema` — "Lakebase"
  - `lakebaseMigrations` — "Schema Migrations"
  - `lakebasePR` — "Pull Request"
  - `lakebaseMerges` — "Recent Merges"
- [ ] Create 5 empty tree data provider stubs (return `[]`)
- [ ] Register the providers in `extension.ts`
- [ ] Add badge count on the Lakebase activity bar icon:
  - Set `treeView.badge = { value: count, tooltip: 'Lakebase SCM Extension — N pending changes' }`
  - Count = staged + unstaged + schema changes
  - Updates on every refresh

### Checkpoint

- [ ] Install vsix
- [ ] Lakebase sidebar shows Branches (existing) + 5 new empty sections
- [ ] Badge shows 0 (no changes)
- [ ] SCM view is completely unchanged
- [ ] All 297 tests pass

### New files
- `src/providers/changesTreeProvider.ts` (stub)
- `src/providers/lakebaseSchemaTree.ts` (stub)
- `src/providers/migrationsTree.ts` (stub)
- `src/providers/pullRequestTree.ts` (stub)
- `src/providers/mergesTree.ts` (stub)

---

## Phase B: Changes view — Staged + Unstaged with inline actions

**Status:** Not started

### Goal
The Changes view shows the same files as the SCM Staged + Code groups, with the same click-to-diff and inline stage/unstage/discard actions.

### Steps

- [ ] `ChangesTreeProvider` reads from `schemaScmProvider.getStaged()` and `schemaScmProvider.getCode()`
- [ ] Returns tree items with two parent nodes: "Staged" (collapsible) and "Unstaged" (collapsible)
- [ ] Child items use the same `resourceUri`, `iconPath`, and `command` as the SCM resource states
- [ ] Register `view/item/context` menus for `lakebaseChanges`:
  - Stage (`+`) on unstaged items — `lakebaseSync.stageFile`
  - Unstage (`−`) on staged items — `lakebaseSync.unstageFile`
  - Discard (`↩`) on unstaged items — `lakebaseSync.discardChanges`
- [ ] Register `view/title` menus for `lakebaseChanges`:
  - ✓ Commit — `lakebaseSync.commit`
  - ☁↑ Publish — `lakebaseSync.publishBranch`
  - 🔀 Create PR — `lakebaseSync.createPullRequest`
  - 🔄 Refresh — `lakebaseSync.refreshBranches`
  - ⟳ Review Branch — `lakebaseSync.reviewBranch`
- [ ] Listens to `schemaScmProvider.onDidRefresh` to update
- [ ] Badge count updates with staged + unstaged count

### Checkpoint

- [ ] Open Lakebase sidebar → Changes view shows same files as SCM Code + Staged groups
- [ ] Click a file → same diff opens
- [ ] Click `+` on a file → file moves to Staged (both sidebar AND SCM view update)
- [ ] Click `−` on a staged file → file moves back to Unstaged
- [ ] Click `↩` on a file → discard confirmation, file removed
- [ ] Click ✓ Commit → same commit flow
- [ ] Click 🔀 → same Create PR flow
- [ ] Badge count matches SCM count
- [ ] All 297 existing tests pass
- [ ] New tests for ChangesTreeProvider pass

### New files
- `src/providers/changesTreeProvider.ts` (implemented)
- `test/suite/changesTreeProvider.test.ts`

---

## Phase C: Lakebase view — Branch status + schema changes

**Status:** Not started

### Goal
The Lakebase view shows production status (on main) or uncommitted schema changes (on feature branch), same as the SCM Lakebase group.

### Steps

- [ ] `LakebaseSchemaTreeProvider` reads from `schemaScmProvider.getLakebase()`
- [ ] On main: shows production status item (clickable to console)
- [ ] On feature branch: shows schema changes from uncommitted migration files
- [ ] Register `view/title` menu: Open in Console — `lakebaseSync.openInConsole`
- [ ] Listens to `schemaScmProvider.onDidRefresh`

### Checkpoint

- [ ] On feature branch: Lakebase view shows same schema items as SCM Lakebase group
- [ ] On main: shows production status
- [ ] Click production → opens Databricks console
- [ ] All existing tests pass
- [ ] New tests for LakebaseSchemaTreeProvider pass

### New files
- `src/providers/lakebaseSchemaTree.ts` (implemented)
- `test/suite/lakebaseSchemaTree.test.ts`

---

## Phase D: Schema Migrations view

**Status:** Not started

### Goal
Shows all migration files (on main) same as the SCM Migrations group.

### Steps

- [ ] `MigrationsTreeProvider` reads from `schemaScmProvider.getMigrations()`
- [ ] Each item clickable to open the migration file
- [ ] Only visible on main (`when` clause: `!lakebaseSync.onFeatureBranch`)
- [ ] Listens to `schemaScmProvider.onDidRefresh`

### Checkpoint

- [ ] On main: Schema Migrations view shows all V*.sql files
- [ ] Click a migration → file opens
- [ ] On feature branch: view is hidden
- [ ] All existing tests pass
- [ ] New tests for MigrationsTreeProvider pass

### New files
- `src/providers/migrationsTree.ts` (implemented)
- `test/suite/migrationsTree.test.ts`

---

## Phase E: Pull Request view — CI status + merge

**Status:** Not started

### Goal
Shows PR status, CI branch, with merge/schema diff/refresh actions, same as SCM PR group.

### Steps

- [ ] `PullRequestTreeProvider` reads from `schemaScmProvider.getPr()`
- [ ] Shows PR status item + CI branch item
- [ ] Register `view/title` menus:
  - ⑂ Merge — `lakebaseSync.mergePullRequest`
  - 🔀 Schema Diff — `lakebaseSync.showPrSchemaDiff`
  - 🔄 Refresh — `lakebaseSync.refreshPrStatus`
- [ ] Register `view/item/context` menus: same click actions as SCM PR items
- [ ] Only visible when there's an open PR (`when`: `lakebaseSync.hasPR`)
- [ ] Listens to `schemaScmProvider.onDidRefresh`

### Checkpoint

- [ ] Create a PR → Pull Request view appears in Lakebase sidebar
- [ ] Shows same PR title + CI branch as SCM PR group
- [ ] Click ⑂ → same merge flow
- [ ] Click 🔀 → same schema diff
- [ ] Click PR item → opens GitHub
- [ ] Click CI branch item → opens Lakebase console
- [ ] All existing tests pass
- [ ] New tests for PullRequestTreeProvider pass

### New files
- `src/providers/pullRequestTree.ts` (implemented)
- `test/suite/pullRequestTree.test.ts`

---

## Phase F: Recent Merges view

**Status:** Not started

### Goal
Shows recent merge commits (on main) same as SCM Merges group.

### Steps

- [ ] `MergesTreeProvider` reads from `schemaScmProvider.getMerges()`
- [ ] Each item clickable to open commit on GitHub
- [ ] Only visible on main (`when` clause: `!lakebaseSync.onFeatureBranch`)
- [ ] Listens to `schemaScmProvider.onDidRefresh`

### Checkpoint

- [ ] On main: Recent Merges view shows same commits as SCM Merges group
- [ ] Click a merge → opens on GitHub
- [ ] On feature branch: view is hidden
- [ ] All existing tests pass
- [ ] New tests for MergesTreeProvider pass

### New files
- `src/providers/mergesTree.ts` (implemented)
- `test/suite/mergesTree.test.ts`

---

## Phase G: Sync indicator in Changes view

**Status:** Not started

### Goal
Show ahead/behind sync status in the Changes view, same as the SCM Sync Changes group.

### Steps

- [ ] Add a "Sync Changes" parent node in `ChangesTreeProvider` when ahead/behind > 0
- [ ] Reads from `schemaScmProvider.getSync()`
- [ ] Click syncs — `lakebaseSync.sync` command
- [ ] Shows `⟳ N to pull, M to push` same as SCM

### Checkpoint

- [ ] Commit something → "Sync Changes" node appears in Changes view with "1 to push"
- [ ] Click → syncs
- [ ] After sync → node disappears
- [ ] All existing tests pass
- [ ] Updated tests pass

### Files modified
- `src/providers/changesTreeProvider.ts` (updated)
- `test/suite/changesTreeProvider.test.ts` (updated)

---

## Phase H: Graph webview

**Status:** Not started

### Goal
Visual commit graph in the Lakebase sidebar.

### Steps

- [ ] Register a webview view: `lakebaseGraph` — "Graph"
- [ ] `GraphWebviewProvider` implements `WebviewViewProvider`
- [ ] Runs `git log --graph --oneline --all --decorate -30`
- [ ] Renders as HTML with:
  - Branch lines with colors (main=green, feature=blue, merge=purple)
  - Commit dots with short SHA
  - Branch labels with Lakebase pairing annotations
  - Click a commit to view diff (optional)
- [ ] Refreshes on branch change via `schemaScmProvider.onDidRefresh`

### Checkpoint

- [ ] Lakebase sidebar shows commit graph
- [ ] Branch names and merge points visible
- [ ] Graph updates on branch switch
- [ ] All existing tests pass
- [ ] New tests for GraphWebviewProvider pass

### New files
- `src/providers/graphWebview.ts`
- `test/suite/graphWebview.test.ts`

---

## Phase I: Full parity test

**Status:** Not started

### Goal
Verify every action works from both the SCM view and the Lakebase sidebar.

### Steps

- [ ] Walk through the entire 14-step workflow from the README using ONLY the Lakebase sidebar
- [ ] Walk through the same workflow using ONLY the SCM view
- [ ] Verify both produce identical results
- [ ] Document any differences
- [ ] Update README with Lakebase sidebar instructions

### Checkpoint

- [ ] Sign-off that both views are at full parity
- [ ] README documents both workflows
- [ ] All tests pass
- [ ] New release created

---

## Summary

| Phase | What | New files | Risk | Status |
|-------|------|-----------|------|--------|
| A | Foundation + empty views | 5 stubs | None | Not started |
| B | Changes view with actions | 1 provider + tests | Medium | Not started |
| C | Lakebase schema view | 1 provider + tests | Low | Not started |
| D | Schema Migrations view | 1 provider + tests | Low | Not started |
| E | Pull Request view | 1 provider + tests | Medium | Not started |
| F | Recent Merges view | 1 provider + tests | Low | Not started |
| G | Sync indicator | Update to Changes | Low | Not started |
| H | Graph webview | 1 webview + tests | Medium | Not started |
| I | Full parity test | Test document | None | Not started |

**Total new files:** ~10 providers/tests + 1 webview
**Existing files modified:** `SchemaScmProvider` (add public read methods + event), `extension.ts` (register views), `package.json` (register views + menus)
**Existing files NOT modified:** All service files, all existing providers, all existing tests
