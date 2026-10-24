import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// SQLite-backed D1 subset shared by the local server and integration tests.
export function localD1(file = ':memory:') {
  const sqlite = new DatabaseSync(file);
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    if (!sqlite.prepare('SELECT name FROM _local_migrations WHERE name = ?').get(name)) {
      sqlite.exec('BEGIN');
      try {
        sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
        sqlite.prepare('INSERT INTO _local_migrations VALUES (?)').run(name);
        sqlite.exec('COMMIT');
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  }
  const db = {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() { return statement.get(...values) || null; },
        async all() { return { results: statement.all(...values), success: true }; },
        async run() { return { meta: statement.run(...values), success: true }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return db;
}
