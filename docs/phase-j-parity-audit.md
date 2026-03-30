# Phase J: Full Parity Audit — SCM View vs Lakebase Sidebar

## Architecture Overview

Two parallel surfaces for accessing extension functionality:

1. **SCM View** (Source Control panel) — Registered as `lakebaseUnified` via `SchemaScmProvider`. Has title bar, overflow menu with 9 submenus, resource groups with inline/context actions, status bar, and input box.

2. **Lakebase Sidebar** — Custom activity bar container with 6 views:
   - **Project** (`lakebaseBranches`) — BranchTreeProvider
   - **Changes** (`lakebaseChanges`) — ChangesTreeProvider
   - **Schema Migrations** (`lakebaseMigrations`) — visible on main only
   - **Pull Request** (`lakebasePR`) — visible when PR exists
   - **Recent Merges** (`lakebaseMerges`) — visible on main only
   - **Graph** (`lakebaseGraph`) — GraphWebviewProvider (webview)

---

## 1. Branch Operations

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Create branch | Title bar (main only) + Branch submenu | Changes overflow + Project context | SCM button only shows on main |
| Create branch from | Branch submenu | Branch submenu | ✅ Identical |
| Switch branch (picker) | Overflow + status bar | Changes overflow + Project inline | ✅ Identical |
| Switch to specific branch | ❌ Not available | Project tree inline per branch | **SCM gap** |
| Rename branch | Branch submenu | Branch submenu | ✅ Identical |
| Delete branch | Branch submenu | Branch submenu + Project tree context | Sidebar has per-branch context |
| Delete remote branch | Branch submenu | Branch submenu | ✅ Identical |
| Publish branch | Title bar + Branch submenu + status bar | Changes title + Project inline + Branch submenu | ✅ Identical |
| Merge branch | Branch submenu | Branch submenu | ✅ Identical |
| Rebase branch | Branch submenu | Branch submenu | ✅ Identical |
| Abort rebase | Commit submenu (when rebasing) | Commit submenu (when rebasing) | ✅ Identical |

---

## 2. Staging

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Stage file | Inline on code group items | Changes view inline on unstaged items | ✅ Identical |
| Unstage file | Inline on staged group items | Changes view inline on staged items | ✅ Identical |
| Stage all | Inline on code group header + Changes submenu | Changes view inline on group header + submenu | ✅ Identical |
| Unstage all | Inline on staged group header + Changes submenu | Changes view inline on group header + submenu | ✅ Identical |
| Discard file | Inline on code group items | Changes view inline on unstaged items | ✅ Identical |
| Discard all | Changes submenu | Inline on Code group header + Changes submenu | **Sidebar has extra inline button** |

---

## 3. Commit

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Commit | Title bar + Commit submenu + input box accept | Changes title + Commit submenu + Project inline | SCM uses input box; sidebar uses `showInputBox` prompt |
| Commit staged | Commit submenu | Commit submenu | ✅ Identical |
| Commit all | Commit submenu | Commit submenu | ✅ Identical |
| Commit amend | Commit submenu | Commit submenu | ✅ Identical |
| Commit staged amend | Commit submenu | Commit submenu | ✅ Identical |
| Commit all amend | Commit submenu | Commit submenu | ✅ Identical |
| Undo last commit | Commit submenu | Commit submenu | ✅ Identical |
| Commit signed off | Commit submenu | Commit submenu | ✅ Identical |
| Commit staged signed off | Commit submenu | Commit submenu | ✅ Identical |
| Commit all signed off | Commit submenu | Commit submenu | ✅ Identical |

---

## 4. Push / Pull / Sync

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Push | Overflow + Pull/Push submenu | Changes overflow + Pull/Push submenu | ✅ Identical |
| Pull | Overflow + Pull/Push submenu | Changes overflow + Pull/Push submenu | ✅ Identical |
| Sync | Pull/Push submenu + status bar | Pull/Push submenu + Sync Changes tree item | ✅ Identical |
| Fetch | Overflow + Pull/Push submenu | Changes overflow + Pull/Push submenu | ✅ Identical |
| Fetch prune | Pull/Push submenu | Pull/Push submenu | ✅ Identical |
| Fetch all | Pull/Push submenu | Pull/Push submenu | ✅ Identical |
| Pull rebase | Pull/Push submenu | Pull/Push submenu | ✅ Identical |
| Pull from | Pull/Push submenu | Pull/Push submenu | ✅ Identical |
| Push to | Pull/Push submenu | Pull/Push submenu | ✅ Identical |

---

## 5. Stash

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Stash | Stash submenu | Stash submenu | ✅ Identical |
| Stash staged | Stash submenu | Stash submenu | ✅ Identical |
| Stash include untracked | Stash submenu | Stash submenu | ✅ Identical |
| Apply stash | Stash submenu | Stash submenu | ✅ Identical |
| Apply latest stash | Stash submenu | Stash submenu | ✅ Identical |
| Pop stash | Stash submenu | Stash submenu | ✅ Identical |
| Pop latest | Stash submenu | Stash submenu | ✅ Identical |
| Drop stash | Stash submenu | Stash submenu | ✅ Identical |
| Drop all | Stash submenu | Stash submenu | ✅ Identical |
| View stash | Stash submenu | Stash submenu | ✅ Identical |

---

## 6. Pull Request

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Create PR | Title bar + Lakebase submenu | Changes title + Project inline | ✅ Identical |
| View PR | Click PR status item → GitHub | PR view: expandable checks, files, reviews, CI branch | **Sidebar is richer** |
| Merge PR | Inline on pr group + Lakebase submenu | PR view title + Lakebase submenu | ✅ Identical |
| View PR schema diff | Inline on pr group + Lakebase submenu | PR view title + Lakebase submenu | ✅ Identical |
| Refresh PR status | Inline on pr group + Lakebase submenu | PR view title + Lakebase submenu | ✅ Identical |

---

## 7. Schema

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Review branch | Title bar | Changes title + Project inline | ✅ Identical |
| Branch diff summary | Title bar + Lakebase submenu | Project inline + per-branch context + Lakebase submenu | Sidebar has per-branch diff |
| Table diff | Click Lakebase schema items | Click schema items in Changes > Lakebase | ✅ Identical |
| Open in console | Lakebase submenu | Lakebase submenu + per-branch inline | Sidebar has per-branch access |

---

## 8. Graph (Sidebar Only)

| Operation | SCM View | Sidebar |
|---|---|---|
| View commit history | ❌ | Graph webview |
| Click to open multi-diff | ❌ | Single-click on row |
| Hover tooltip | ❌ | 400ms delay, schema changes, stats, refs, avatar |
| Context menu (13 actions) | ❌ | Open Changes, Blame, GitHub, Checkout/Delete Branch submenus, Create Branch/Tag, Cherry Pick, Copy SHA/Message |
| Title bar (7 icons) | ❌ | Repo picker, branch filter, go to current, fetch, pull, push, refresh |
| Schema changes in tooltip | ❌ | CI comment parsing + migration SQL fallback |
| Infinite scroll | ❌ | 50 commits per page via IntersectionObserver |

---

## 9. Tags

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Create tag | Tags submenu | Tags submenu + Graph context menu | ✅ Identical (+ Graph) |
| Delete tag | Tags submenu | Tags submenu | ✅ Identical |
| Delete remote tag | Tags submenu | Tags submenu | ✅ Identical |

---

## 10. Worktrees

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Create worktree | Worktrees submenu | Worktrees submenu | ✅ Identical |
| List worktrees | Worktrees submenu | Worktrees submenu | ✅ Identical |
| Delete worktree | Worktrees submenu | Worktrees submenu | ✅ Identical |

---

## 11. Remote

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Add remote | Remote submenu | Remote submenu | ✅ Identical |
| Remove remote | Remote submenu | Remote submenu | ✅ Identical |

---

## 12. Clone

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Clone | Overflow | Project context | ✅ Identical |

---

## 13. Other

| Operation | SCM View | Sidebar | Difference |
|---|---|---|---|
| Health check | Lakebase submenu | Lakebase submenu | ✅ Identical |
| Connect workspace | ❌ | Project view title bar | **SCM gap** |
| Refresh | Title bar | Changes title + Project title + Project inline | ✅ Identical |
| Show git output | Overflow | Changes overflow + Project context | ✅ Identical |
| List/tree toggle | N/A | Changes title bar | Sidebar only |

---

## Summary of Gaps

### SCM view is missing (compared to Sidebar):
1. **Graph view** — entire commit history + tooltip + context menu actions (13 items)
2. **Connect workspace** button
3. **Switch to specific branch** inline action per branch
4. **Open in console per-branch** inline action
5. **Branch diff from specific branch** context
6. **PR detail richness** — sidebar shows expandable checks, files with diffs, reviews with author/state; SCM shows only 2 flat items

### Sidebar is missing (compared to SCM view):
1. **SCM input box** for commit messages — sidebar uses `showInputBox` prompt instead (inherent limitation)
2. **Status bar sync button** with ahead/behind counts — sidebar shows this in Sync Changes tree item

### Neither surface exposes (command palette only):
1. `refreshCredentials` — Refresh Database Credentials
2. `runMigrate` — Run Flyway Migrate
3. `showMigrationHistory` — Show Migration History
4. `showBranchStatus` — Show Branch Status
5. `createBranch` — Create Lakebase Branch (db-only, called programmatically)
6. `showCachedBranchDiff` — Branch Diff (Cached)

---

## Recommendation

The Lakebase sidebar is now the **superset** of the SCM view. Every SCM action is available from the sidebar (via shared submenus), plus the sidebar adds the Graph view, richer PR details, per-branch inline actions, connect workspace, and list/tree toggle. The only inherent SCM advantage is the input box for commit messages.

**Phase J status: AUDIT COMPLETE — document only, no changes made.**
