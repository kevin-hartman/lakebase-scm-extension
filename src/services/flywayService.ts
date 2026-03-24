import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig, getWorkspaceRoot } from '../utils/config';

export interface MigrationFile {
  version: string;
  description: string;
  filename: string;
  fullPath: string;
}

export interface MigrationSchemaChange {
  type: 'created' | 'modified' | 'removed';
  tableName: string;
  columns: Array<{ name: string; dataType: string }>;
  migration: MigrationFile;
}

export class FlywayService {
  listMigrations(): MigrationFile[] {
    const root = getWorkspaceRoot();
    if (!root) {
      return [];
    }

    const config = getConfig();
    const migrationDir = path.join(root, config.migrationPath);

    if (!fs.existsSync(migrationDir)) {
      return [];
    }

    const files = fs.readdirSync(migrationDir)
      .filter(f => /^V\d+.*\.sql$/i.test(f))
      .sort();

    return files.map(f => {
      // Parse Flyway naming: V{version}__{description}.sql
      const match = f.match(/^V(\d+(?:\.\d+)*)__(.+)\.sql$/i);
      return {
        version: match ? match[1] : '?',
        description: match ? match[2].replace(/_/g, ' ') : f,
        filename: f,
        fullPath: path.join(migrationDir, f),
      };
    });
  }

  getLatestVersion(): string | undefined {
    const migrations = this.listMigrations();
    if (migrations.length === 0) {
      return undefined;
    }
    return migrations[migrations.length - 1].version;
  }

  getMigrationCount(): number {
    return this.listMigrations().length;
  }

  /**
   * Parse migration SQL files to extract schema changes (CREATE TABLE, ALTER TABLE, DROP TABLE).
   * Returns objects representing what the migrations will do when applied.
   */
  parseMigrationSchemaChanges(migrations: MigrationFile[]): MigrationSchemaChange[] {
    const changes: MigrationSchemaChange[] = [];

    for (const mig of migrations) {
      if (!fs.existsSync(mig.fullPath)) { continue; }
      const sql = fs.readFileSync(mig.fullPath, 'utf-8');

      // CREATE TABLE
      const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\);/gi;
      let match;
      while ((match = createRegex.exec(sql)) !== null) {
        const tableName = match[1];
        if (tableName === 'flyway_schema_history') { continue; }
        const columns: Array<{ name: string; dataType: string }> = [];
        for (const line of match[2].split('\n')) {
          const colMatch = line.trim().match(/^(\w+)\s+(.+?)(?:,?\s*$)/);
          if (colMatch && !colMatch[2].match(/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i)) {
            columns.push({ name: colMatch[1], dataType: colMatch[2].replace(/,\s*$/, '') });
          }
        }
        changes.push({ type: 'created', tableName, columns, migration: mig });
      }

      // ALTER TABLE ... ADD COLUMN
      const alterAddRegex = /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+(?:COLUMN\s+)?(\w+)\s+(.+?);/gi;
      while ((match = alterAddRegex.exec(sql)) !== null) {
        changes.push({
          type: 'modified', tableName: match[1],
          columns: [{ name: match[2], dataType: match[3] }],
          migration: mig,
        });
      }

      // DROP TABLE
      const dropRegex = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
      while ((match = dropRegex.exec(sql)) !== null) {
        changes.push({ type: 'removed', tableName: match[1], columns: [], migration: mig });
      }
    }

    return changes;
  }

  watchMigrations(callback: () => void): vscode.Disposable {
    const root = getWorkspaceRoot();
    if (!root) {
      return { dispose: () => {} };
    }

    const config = getConfig();
    const pattern = new vscode.RelativePattern(root, `${config.migrationPath}/*.sql`);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    watcher.onDidCreate(callback);
    watcher.onDidChange(callback);
    watcher.onDidDelete(callback);

    return watcher;
  }
}
