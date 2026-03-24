import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { FlywayService } from '../../src/services/flywayService';
import { GitService } from '../../src/services/gitService';
import { SchemaDiffService, SchemaDiffResult } from '../../src/services/schemaDiffService';
import { SchemaScmProvider } from '../../src/providers/schemaScmProvider';
import { SchemaDiffProvider } from '../../src/providers/schemaDiffProvider';

describe('Branch Review — full branch scope', () => {
  let gitStub: sinon.SinonStubbedInstance<GitService>;
  let flywayStub: sinon.SinonStubbedInstance<FlywayService>;
  let schemaDiffStub: sinon.SinonStubbedInstance<SchemaDiffService>;
  let provider: SchemaScmProvider;

  beforeEach(() => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/fake/root' } }];

    gitStub = sinon.createStubInstance(GitService);
    gitStub.getCachedBranch.returns('feature/orders');
    gitStub.getCurrentBranch.resolves('feature/orders');
    gitStub.getMergeBase.resolves('abc123');
    gitStub.getStagedChanges.resolves([]);
    gitStub.getChangedFiles.resolves([]);
    gitStub.listMigrationsOnBranch.resolves([]);
    (gitStub as any).onBranchChanged = new (vscode as any).EventEmitter().event;

    flywayStub = sinon.createStubInstance(FlywayService);
    flywayStub.listMigrations.returns([]);
    flywayStub.watchMigrations.returns({ dispose: () => {} });
    flywayStub.parseMigrationSchemaChanges.returns([]);

    schemaDiffStub = sinon.createStubInstance(SchemaDiffService);
  });

  afterEach(() => {
    if (provider) { provider.dispose(); }
    sinon.restore();
  });

  function makeDiff(overrides: Partial<SchemaDiffResult> = {}): SchemaDiffResult {
    return {
      branchName: 'feature-orders',
      timestamp: new Date().toISOString(),
      migrations: [],
      created: [],
      modified: [],
      removed: [],
      branchTables: [],
      inSync: true,
      ...overrides,
    };
  }

  describe('Changes group shows working tree changes (Git SCM parity)', () => {
    it('shows only uncommitted/unstaged changes', async () => {
      gitStub.getStagedChanges.resolves([]);
      gitStub.getUnstagedChanges.resolves([
        { status: 'modified', path: 'src/model/Order.java' },
        { status: 'added', path: 'src/new-file.ts' },
      ]);
      schemaDiffStub.compareBranchSchemas.resolves(makeDiff());

      provider = new SchemaScmProvider(gitStub as any, flywayStub as any, schemaDiffStub as any);
      await new Promise(r => setTimeout(r, 150));

      assert.ok(gitStub.getUnstagedChanges.called);
    });

    it('shows empty Code group when working tree is clean', async () => {
      gitStub.getStagedChanges.resolves([]);
      gitStub.getUnstagedChanges.resolves([]);
      schemaDiffStub.compareBranchSchemas.resolves(makeDiff());

      provider = new SchemaScmProvider(gitStub as any, flywayStub as any, schemaDiffStub as any);
      await new Promise(r => setTimeout(r, 150));

      assert.ok(gitStub.getUnstagedChanges.called);
    });

    it('staged files appear in Staged group, not Code group', async () => {
      gitStub.getStagedChanges.resolves([
        { status: 'modified', path: 'pom.xml' },
      ]);
      gitStub.getUnstagedChanges.resolves([
        { status: 'added', path: 'src/new.ts' },
      ]);
      schemaDiffStub.compareBranchSchemas.resolves(makeDiff());

      provider = new SchemaScmProvider(gitStub as any, flywayStub as any, schemaDiffStub as any);
      await new Promise(r => setTimeout(r, 150));

      assert.ok(gitStub.getStagedChanges.called);
      assert.ok(gitStub.getUnstagedChanges.called);
    });
  });

  describe('Lakebase group — shows schema for uncommitted migration files', () => {
    it('shows schema changes when uncommitted migration files exist', async () => {
      // Simulate uncommitted migration files in working tree
      gitStub.getStagedChanges.resolves([]);
      gitStub.getUnstagedChanges.resolves([
        { status: 'added', path: 'src/main/resources/db/migration/V6__create_orders.sql' },
        { status: 'added', path: 'src/main/resources/db/migration/V7__create_order_items.sql' },
      ]);

      gitStub.listMigrationsOnBranch.resolves([
        'V1__init.sql', 'V2__book.sql', 'V3__product.sql', 'V4__customer.sql', 'V5__cart.sql',
      ]);
      flywayStub.listMigrations.returns([
        { version: '1', description: 'init', filename: 'V1__init.sql', fullPath: '/fake/V1__init.sql' },
        { version: '6', description: 'create orders', filename: 'V6__create_orders.sql', fullPath: '/fake/V6__create_orders.sql' },
        { version: '7', description: 'create order items', filename: 'V7__create_order_items.sql', fullPath: '/fake/V7__create_order_items.sql' },
      ]);
      flywayStub.parseMigrationSchemaChanges.returns([
        { type: 'created', tableName: 'orders', columns: [{ name: 'id', dataType: 'bigint' }], migration: {} as any },
        { type: 'created', tableName: 'order_item', columns: [{ name: 'id', dataType: 'bigint' }], migration: {} as any },
      ]);

      provider = new SchemaScmProvider(gitStub as any, flywayStub as any, schemaDiffStub as any);
      await new Promise(r => setTimeout(r, 150));

      assert.ok(flywayStub.parseMigrationSchemaChanges.called);
    });

    it('shows nothing when no uncommitted migration files', async () => {
      gitStub.getStagedChanges.resolves([]);
      gitStub.getUnstagedChanges.resolves([
        { status: 'modified', path: 'src/App.java' },
      ]);

      provider = new SchemaScmProvider(gitStub as any, flywayStub as any, schemaDiffStub as any);
      await new Promise(r => setTimeout(r, 150));

      // No migration changes → no schema parsing
      assert.strictEqual(flywayStub.parseMigrationSchemaChanges.called, false);
    });

    it('shows nothing when working tree is clean (all committed)', async () => {
      gitStub.getStagedChanges.resolves([]);
      gitStub.getUnstagedChanges.resolves([]);

      gitStub.listMigrationsOnBranch.resolves(['V1__init.sql']);
      flywayStub.listMigrations.returns([
        { version: '1', description: 'init', filename: 'V1__init.sql', fullPath: '/fake/V1__init.sql' },
      ]);

      provider = new SchemaScmProvider(gitStub as any, flywayStub as any, schemaDiffStub as any);
      await new Promise(r => setTimeout(r, 150));

      // No new migrations — parseMigrationSchemaChanges should not be called
      assert.strictEqual(flywayStub.parseMigrationSchemaChanges.called, false);
    });
  });

  describe('Combined view — uncommitted code + migration schema', () => {
    it('shows uncommitted code changes and schema from uncommitted migrations', async () => {
      gitStub.getStagedChanges.resolves([]);
      gitStub.getUnstagedChanges.resolves([
        { status: 'added', path: 'src/model/Order.java' },
        { status: 'added', path: 'src/controller/OrderController.java' },
        { status: 'added', path: 'src/main/resources/db/migration/V6__create_orders.sql' },
        { status: 'modified', path: 'pom.xml' },
      ]);

      gitStub.listMigrationsOnBranch.resolves(['V1__init.sql']);
      flywayStub.listMigrations.returns([
        { version: '1', description: 'init', filename: 'V1__init.sql', fullPath: '/fake/V1' },
        { version: '6', description: 'orders', filename: 'V6__create_orders.sql', fullPath: '/fake/V6' },
      ]);
      flywayStub.parseMigrationSchemaChanges.returns([
        { type: 'created', tableName: 'orders', columns: [], migration: {} as any },
      ]);

      provider = new SchemaScmProvider(gitStub as any, flywayStub as any, schemaDiffStub as any);
      await new Promise(r => setTimeout(r, 150));

      assert.ok(gitStub.getUnstagedChanges.called);
      assert.ok(flywayStub.parseMigrationSchemaChanges.called);
    });
  });
});

describe('Branch Diff webview — migration fallback', () => {
  let schemaDiffStub: sinon.SinonStubbedInstance<SchemaDiffService>;
  let gitStub: sinon.SinonStubbedInstance<GitService>;
  let flywayStub: sinon.SinonStubbedInstance<FlywayService>;
  let diffProvider: SchemaDiffProvider;

  beforeEach(() => {
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/fake/root' } }];

    schemaDiffStub = sinon.createStubInstance(SchemaDiffService);
    gitStub = sinon.createStubInstance(GitService);
    gitStub.getChangedFiles.resolves([]);
    gitStub.listMigrationsOnBranch.resolves([]);

    flywayStub = sinon.createStubInstance(FlywayService);
    flywayStub.listMigrations.returns([]);
    flywayStub.parseMigrationSchemaChanges.returns([]);

    diffProvider = new SchemaDiffProvider(schemaDiffStub as any, gitStub as any, flywayStub as any);
  });

  afterEach(() => {
    diffProvider.dispose();
    sinon.restore();
  });

  function makeDiff(overrides: Partial<SchemaDiffResult> = {}): SchemaDiffResult {
    return {
      branchName: 'feature-orders',
      timestamp: new Date().toISOString(),
      migrations: [],
      created: [],
      modified: [],
      removed: [],
      branchTables: [],
      inSync: true,
      ...overrides,
    };
  }

  it('supplements in-sync pg_dump with migration file changes', async () => {
    schemaDiffStub.getCachedDiff.returns(makeDiff({ inSync: true }));

    // Branch has V6 not on main
    gitStub.listMigrationsOnBranch.resolves(['V1__init.sql']);
    flywayStub.listMigrations.returns([
      { version: '1', description: 'init', filename: 'V1__init.sql', fullPath: '/fake/V1' },
      { version: '6', description: 'orders', filename: 'V6__create_orders.sql', fullPath: '/fake/V6' },
    ]);
    flywayStub.parseMigrationSchemaChanges.returns([
      { type: 'created', tableName: 'orders', columns: [{ name: 'id', dataType: 'bigint' }], migration: {} as any },
    ]);

    await diffProvider.showDiff(false, []);

    assert.ok(flywayStub.parseMigrationSchemaChanges.called);
  });

  it('does not supplement when pg_dump found real differences', async () => {
    schemaDiffStub.getCachedDiff.returns(makeDiff({
      inSync: false,
      created: [{ type: 'TABLE', name: 'orders' }],
    }));

    await diffProvider.showDiff(false, []);

    // Migration fallback should not be triggered
    assert.strictEqual(flywayStub.parseMigrationSchemaChanges.called, false);
  });

  it('does not supplement when no new migrations exist', async () => {
    schemaDiffStub.getCachedDiff.returns(makeDiff({ inSync: true }));
    gitStub.listMigrationsOnBranch.resolves(['V1__init.sql']);
    flywayStub.listMigrations.returns([
      { version: '1', description: 'init', filename: 'V1__init.sql', fullPath: '/fake/V1' },
    ]);

    await diffProvider.showDiff(false, []);

    assert.strictEqual(flywayStub.parseMigrationSchemaChanges.called, false);
  });
});

describe('FlywayService — parseMigrationSchemaChanges', () => {
  let service: FlywayService;
  let tmpDir: string;

  beforeEach(() => {
    service = new FlywayService();
    tmpDir = path.join('/tmp', `flyway-parse-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('parses CREATE TABLE statements', () => {
    const sqlPath = path.join(tmpDir, 'V6__create_orders.sql');
    fs.writeFileSync(sqlPath, `CREATE TABLE orders (
  id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  total DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);`);

    const migrations = [{ version: '6', description: 'create orders', filename: 'V6__create_orders.sql', fullPath: sqlPath }];
    const changes = service.parseMigrationSchemaChanges(migrations);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'created');
    assert.strictEqual(changes[0].tableName, 'orders');
    assert.ok(changes[0].columns.length >= 3);
    assert.ok(changes[0].columns.find(c => c.name === 'id'));
    assert.ok(changes[0].columns.find(c => c.name === 'customer_id'));
  });

  it('parses multiple CREATE TABLEs in one file', () => {
    const sqlPath = path.join(tmpDir, 'V7__create_order_items.sql');
    fs.writeFileSync(sqlPath, `CREATE TABLE order_item (
  id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INTEGER DEFAULT 1
);

CREATE TABLE order_status (
  id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  status VARCHAR(50)
);`);

    const migrations = [{ version: '7', description: 'create order items', filename: 'V7__create_order_items.sql', fullPath: sqlPath }];
    const changes = service.parseMigrationSchemaChanges(migrations);

    assert.strictEqual(changes.length, 2);
    assert.strictEqual(changes[0].tableName, 'order_item');
    assert.strictEqual(changes[1].tableName, 'order_status');
  });

  it('parses ALTER TABLE ADD COLUMN', () => {
    const sqlPath = path.join(tmpDir, 'V8__add_email.sql');
    fs.writeFileSync(sqlPath, `ALTER TABLE customer ADD COLUMN email VARCHAR(255);`);

    const migrations = [{ version: '8', description: 'add email', filename: 'V8__add_email.sql', fullPath: sqlPath }];
    const changes = service.parseMigrationSchemaChanges(migrations);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'modified');
    assert.strictEqual(changes[0].tableName, 'customer');
    assert.strictEqual(changes[0].columns[0].name, 'email');
  });

  it('parses DROP TABLE', () => {
    const sqlPath = path.join(tmpDir, 'V9__drop_legacy.sql');
    fs.writeFileSync(sqlPath, `DROP TABLE IF EXISTS legacy_data;`);

    const migrations = [{ version: '9', description: 'drop legacy', filename: 'V9__drop_legacy.sql', fullPath: sqlPath }];
    const changes = service.parseMigrationSchemaChanges(migrations);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].type, 'removed');
    assert.strictEqual(changes[0].tableName, 'legacy_data');
  });

  it('skips flyway_schema_history table', () => {
    const sqlPath = path.join(tmpDir, 'V1__init.sql');
    fs.writeFileSync(sqlPath, `CREATE TABLE flyway_schema_history (id INT);
CREATE TABLE real_table (id INT);`);

    const migrations = [{ version: '1', description: 'init', filename: 'V1__init.sql', fullPath: sqlPath }];
    const changes = service.parseMigrationSchemaChanges(migrations);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].tableName, 'real_table');
  });

  it('handles CREATE TABLE IF NOT EXISTS', () => {
    const sqlPath = path.join(tmpDir, 'V10__safe_create.sql');
    fs.writeFileSync(sqlPath, `CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT NOT NULL,
  action TEXT
);`);

    const migrations = [{ version: '10', description: 'safe create', filename: 'V10__safe_create.sql', fullPath: sqlPath }];
    const changes = service.parseMigrationSchemaChanges(migrations);

    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].tableName, 'audit_log');
  });

  it('returns empty for non-schema SQL', () => {
    const sqlPath = path.join(tmpDir, 'V11__insert_data.sql');
    fs.writeFileSync(sqlPath, `INSERT INTO config (key, value) VALUES ('version', '1.0');`);

    const migrations = [{ version: '11', description: 'insert data', filename: 'V11__insert_data.sql', fullPath: sqlPath }];
    const changes = service.parseMigrationSchemaChanges(migrations);

    assert.strictEqual(changes.length, 0);
  });
});
