import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

export const DB_PATH = process.env.ITEMFINDER_DB ?? join(ROOT, 'data', 'itemfinder.db');

let _db: Database.Database | null = null;

/**
 * Connexion SQLite partagée.
 *
 * WAL (Write-Ahead Logging) est le réglage critique ici : il permet au crawler
 * d'écrire pendant que le site web lit, sans blocage. Sans WAL, un crawl en
 * cours ferait planter les pages avec « database is locked ».
 */
export function db(): Database.Database {
  if (_db) return _db;

  mkdirSync(dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);

  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');   // sûr en WAL, bien plus rapide
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 10000');   // attendre au lieu d'échouer sur verrou
  conn.pragma('cache_size = -64000');    // 64 Mo de cache page

  _db = conn;
  return conn;
}

/** Applique les migrations non encore appliquées, dans l'ordre du nom de fichier. */
export function migrate(verbose = false): string[] {
  const conn = db();
  conn.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const dir = join(HERE, 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  const already = new Set(
    conn.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name),
  );

  const applied: string[] = [];
  for (const file of files) {
    if (already.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    // Chaque migration est atomique : soit tout passe, soit rien.
    conn.transaction(() => {
      conn.exec(sql);
      conn.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    })();
    applied.push(file);
    if (verbose) console.log(`  ✓ ${file}`);
  }
  return applied;
}

export const nowIso = () => new Date().toISOString();
