# Extension Dev Loop

Live development loop for the Lakebase SCM Extension. Monitor user testing, fix issues, and release incrementally.

## Trigger

Use when the user is actively testing the extension and reporting issues, or says "fix", "bug", "improve", "release", "devloop".

## Workflow

### 1. Diagnose

- Read the relevant source files in `src/` before proposing changes
- Check `src/extension.ts`, `src/providers/`, `src/services/` for the area involved
- Compile with `cd ~/code/lakebase-scm-extension && npm run compile` to verify no errors

### 2. Fix

- Make the minimal change to address the issue
- Compile again to confirm clean build

### 3. Release (after every fix)

Ask the user: **"Version bump needed?"**

If yes, execute this checklist in order:

1. **Bump version** in `package.json` (field `version`)
2. **Update README.md** — update the VSIX filename in the install instructions (line ~87: `lakebase-scm-extension-X.Y.Z.vsix`)
3. **Update changelog** in `docs/plugin-plan.md` — add a `### vX.Y.Z changelog:` entry before the "Known issues" section with a bullet per change
4. **Build VSIX:**
   ```bash
   cd ~/code/lakebase-scm-extension && npx @vscode/vsce package --no-dependencies
   ```
5. **Commit** all changes (package.json, README.md, docs/plugin-plan.md, src/*, dist/*):
   ```
   vX.Y.Z: <short description>
   ```
6. **Push** to GitHub:
   ```bash
   git push origin main
   ```

### Version Numbering

- **Patch** (0.4.4 → 0.4.5): bug fixes, polish, minor behavior changes
- **Minor** (0.4.x → 0.5.0): new user-visible feature or workflow
- **Major**: reserved for breaking changes

## Key Files

| Area | Files |
|------|-------|
| Commands & wiring | `src/extension.ts` |
| Branch tree | `src/providers/branchTreeProvider.ts` |
| SCM groups | `src/providers/schemaScmProvider.ts` |
| Status bar | `src/providers/statusBarProvider.ts` |
| Git operations | `src/services/gitService.ts` |
| Lakebase API | `src/services/lakebaseService.ts` |
| Schema diff | `src/services/schemaDiffService.ts` |
| Build output | `dist/extension.js` |
| Package manifest | `package.json` |
| Install docs | `README.md` (line ~87) |
| Changelog | `docs/plugin-plan.md` (bottom) |

## Build & Test

```bash
npm run compile          # webpack production build
npm run watch            # webpack dev + watch mode
npm test                 # unit tests (mocha)
npm run test:integration # all integration tests
npx @vscode/vsce package --no-dependencies  # build .vsix
```

### Integration Test Suites

| Suite | Run | Duration | Coverage |
|-------|-----|----------|----------|
| Java E-Commerce (8 scenarios) | `npm run test:integration -- --grep "E-Commerce"` | ~2 hrs | CREATE, ALTER, DROP across 8 tables with FK chains |
| Python Dev Loop (4 scenarios) | `npm run test:integration -- --grep "Python Dev Loop"` | ~40 min | CREATE, CREATE+FK, ALTER, DROP with Alembic/FastAPI/pytest |
| Branch Lifecycle | `npm run test:integration -- --grep "Branch Lifecycle"` | ~5 min | Lakebase branch create/delete |
| Project Creation | `npm run test:integration -- --grep "Project Creation"` | ~10 min | Full project scaffolding E2E |

### Python Dev Loop Scenarios

Each follows the A-B-C-D phase flow (branch → code → migration → test → PR → merge → verify):

1. **Partner** — CREATE TABLE with Alembic, SQLAlchemy model, pytest
2. **Asset** — CREATE TABLE with FK to partner, cascading relationship
3. **ALTER Asset** — ADD COLUMN (3 review fields), verify server defaults
4. **DROP Partner + Asset** — DROP TABLE with FK cascade, verify absence

Files: `test/integration/python-devloop/`

Skip teardown for debugging: `PYDEV_NO_TEARDOWN=1 npm run test:integration -- --grep "Python Dev Loop"`
