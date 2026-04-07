# Refactoring Plan — Eliminate Duplicative Code

## Priority Order

Sorted by severity (risk of inconsistency + maintenance burden) and blast radius.

---

## Phase R1: Service Layer — Replace Raw `execSync` Calls (High)

### Problem
~30 direct `cp.execSync('git ...')` calls across `graphWebview.ts`, `extension.ts`, and `schemaScmProvider.ts` bypass `GitService`. These block the extension host thread and diverge from service-layer normalization.

### Plan
1. **Inject `GitService` into `GraphWebviewProvider`** — constructor takes `(extensionUri, lakebaseService, gitService)`
2. **Add missing `GitService` methods:**
   - `revert(sha)` — `git revert --no-edit`
   - `cherryPick(sha)` — `git cherry-pick`
   - `checkoutDetached(sha)` — `git checkout --detach`
   - `getBranchesAtCommit(sha)` — `git branch -a --points-at`
   - `getCommitFiles(sha)` — `git diff-tree --no-commit-id --name-status -r`
   - `getFileAtRef(ref, path)` — already exists, use it
   - `getRecentMerges(limit)` — `git log --merges`
   - `fetchAll()` — `git fetch --all`
3. **Replace all `cp.execSync` git calls** in graphWebview.ts (~20), extension.ts (~10), schemaScmProvider.ts (~3) with async `GitService` method calls
4. **Remove** `import * as cp from 'child_process'` from graphWebview.ts

### Files Changed
- `src/services/gitService.ts` — add ~7 methods
- `src/providers/graphWebview.ts` — replace ~20 execSync calls
- `src/extension.ts` — replace ~10 execSync calls, update GraphWebviewProvider constructor
- `src/providers/schemaScmProvider.ts` — replace ~3 execSync calls

---

## Phase R2: GitHub Remote URL Resolution (High)

### Problem
7 copies of `git remote get-url origin` + `.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')` across 3 files. SSH URL handling is inconsistent.

### Plan
1. **Add `GitService.getGitHubUrl(): Promise<string>`** — runs `git remote get-url origin`, normalizes all formats (HTTPS, SSH `git@`, SSH `ssh://`), caches result
2. **Replace all 7 occurrences** with `await gitService.getGitHubUrl()`

### Files Changed
- `src/services/gitService.ts` — add method + cache
- `src/providers/graphWebview.ts` — replace 4 occurrences
- `src/providers/schemaScmProvider.ts` — replace 1
- `src/providers/branchTreeProvider.ts` — replace 2

---

## Phase R3: Migration Schema Detection Consolidation (High)

### Problem
4 locations implement "find migrations new vs main → parse SQL → extract table changes." graphWebview.ts also re-implements FlywayService's SQL parsing from scratch.

### Plan
1. **Extract `FlywayService.parseSql(sql: string): MigrationSchemaChange[]`** — static method accepting raw SQL, usable without disk access
2. **Add `FlywayService.getNewMigrationChanges(gitService): Promise<MigrationSchemaChange[]>`** — encapsulates the full workflow: list migrations on main, diff against current, parse new ones
3. **Replace 4 call sites:**
   - `extension.ts` reviewBranch migration fallback → `flywayService.getNewMigrationChanges(gitService)`
   - `schemaScmProvider.ts` Lakebase group refresh → same
   - `branchTreeProvider.ts` getTableList fallback → same
   - `graphWebview.ts` fetchSchema handler → `FlywayService.parseSql(sqlFromGitShow)`

### Files Changed
- `src/services/flywayService.ts` — add 2 methods
- `src/extension.ts` — simplify reviewBranch
- `src/providers/schemaScmProvider.ts` — simplify refresh
- `src/providers/branchTreeProvider.ts` — simplify getTableList
- `src/providers/graphWebview.ts` — replace inline SQL parsing

---

## Phase R4: Lakebase Connection Sync Pattern (High)

### Problem
6 locations repeat: `getEndpoint(branchId)` → check host → `getCredential(branchId)` → `updateEnvConnection(...)`.

### Plan
1. **Add `LakebaseService.syncConnection(branchId: string): Promise<{host, username, password}>`** — encapsulates the 4-step pattern
2. **Replace 6 call sites** in extension.ts with `await lakebaseService.syncConnection(branchId)`

### Files Changed
- `src/services/lakebaseService.ts` — add method
- `src/extension.ts` — simplify 6 locations

---

## Phase R5: Shared `exec` Utility (Medium)

### Problem
3 nearly identical `exec(command, cwd, env)` wrapper functions in gitService.ts, lakebaseService.ts, schemaDiffService.ts.

### Plan
1. **Create `src/utils/exec.ts`** — single `exec(command, cwd?, env?, timeout?)` function
2. **Add optional `authErrorTag` flag** for lakebaseService's error detection
3. **Replace 3 module-level functions** with imports from the shared module

### Files Changed
- `src/utils/exec.ts` — new file
- `src/services/gitService.ts` — import shared exec
- `src/services/lakebaseService.ts` — import shared exec
- `src/services/schemaDiffService.ts` — import shared exec

---

## Phase R6: Diff Tuple Builder (Medium)

### Problem
3 locations build `[label, orig, mod]` tuples for `vscode.changes`, each with subtly different handling of added/deleted files.

### Plan
1. **Create `src/utils/diffBuilder.ts`** — `buildDiffTuples(files, makeOrigUri, makeModUri): DiffTuple[]`
2. **Add `sortMigrationsToEnd(tuples, migrationPathPattern): DiffTuple[]`** utility
3. **Replace tuple construction** in extension.ts reviewBranch, graphWebview.ts reviewCommit, and getComparisonFiles

### Files Changed
- `src/utils/diffBuilder.ts` — new file
- `src/extension.ts` — use shared builder
- `src/providers/graphWebview.ts` — use shared builder

---

## Phase R7: CI Secret Syncing (Medium)

### Problem
2 identical ~25-line blocks for reading .env, generating token, setting GitHub secrets.

### Plan
1. **Add `syncCiSecrets(root: string)` function** in a new `src/utils/ciSecrets.ts` or on `GitService`
2. **Replace both copies** in createPullRequest and mergePullRequest

### Files Changed
- `src/utils/ciSecrets.ts` — new file (or gitService.ts)
- `src/extension.ts` — simplify 2 locations

---

## Phase R8: Small Patterns (Low)

### 8a: `isMainBranch()` utility
- **Add** `isMainBranch(name: string): boolean` to `src/utils/config.ts`
- **Replace** 18+ inline `=== 'main' || === 'master'` checks

### 8b: Status icon/color constants
- **Create** `src/utils/theme.ts` exporting `STATUS_ICONS` and `STATUS_COLORS` maps
- **Replace** 5 inline object literals

### 8c: CREATE TABLE parsing
- **Extract** shared regex/parsing from `schemaDiffService.ts` and `flywayService.ts` into a utility (partially covered by R3)

---

## Summary

| Phase | What | Severity | Est. Scope |
|-------|------|----------|------------|
| R1 | Replace raw execSync with GitService | High | ~30 call sites, 4 files |
| R2 | GitHub URL resolution | High | 7 call sites, 4 files |
| R3 | Migration schema detection | High | 4 call sites + SQL parsing, 5 files |
| R4 | Lakebase connection sync | High | 6 call sites, 2 files |
| R5 | Shared exec utility | Medium | 3 files |
| R6 | Diff tuple builder | Medium | 3 files |
| R7 | CI secret syncing | Medium | 2 locations |
| R8 | Small patterns | Low | 18+ checks, 5 constants |

**Total new utility files:** 3-4 (`utils/exec.ts`, `utils/diffBuilder.ts`, `utils/theme.ts`, optionally `utils/ciSecrets.ts`)
**Total new service methods:** ~10 across GitService, LakebaseService, FlywayService
**Net effect:** Eliminate ~80+ duplicated code blocks, consistent async execution, single point of maintenance for each pattern.
