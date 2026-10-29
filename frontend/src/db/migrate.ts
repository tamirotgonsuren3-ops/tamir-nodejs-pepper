// One-time migration of the data that used to live in the browser's PGlite
// database (IndexedDB) into the Go SQLite store.
//
// It only runs when the Go store is completely empty, so it can never overwrite
// data the engine has since written, and it marks itself done in localStorage so
// the old database is read at most once.
import { PGlite } from '@electric-sql/pglite';
import { StoreIsEmpty, ImportStoreSnapshot } from '../../wailsjs/go/main/App';

const DONE_KEY = 'tamir-go:pglite-migrated';

async function readTable(db: PGlite, table: string): Promise<any[]> {
  try {
    const { rows } = await db.query(`SELECT * FROM ${table}`);
    return rows as any[];
  } catch {
    // Older databases may predate a table; treat it as empty.
    return [];
  }
}

export async function runPgliteMigration(): Promise<void> {
  try {
    if (localStorage.getItem(DONE_KEY)) return;
  } catch {
    return;
  }

  let empty = false;
  try {
    empty = await StoreIsEmpty();
  } catch {
    // Go store not reachable yet; try again on the next launch.
    return;
  }
  if (!empty) {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
    return;
  }

  try {
    const db = new PGlite('idb://tamir-go-db');
    await db.query('SELECT 1'); // wait until the existing database is ready

    const snap = {
      trades: await readTable(db, 'trades'),
      schedule: await readTable(db, 'schedule'),
      logs: await readTable(db, 'schedule_logs'),
      adjustments: await readTable(db, 'indicator_adjustments'),
      orderables: await readTable(db, 'orderables'),
      api_keys: await readTable(db, 'api_keys'),
    };

    const total = Object.values(snap).reduce((n, rows: any[]) => n + rows.length, 0);
    if (total > 0) {
      await ImportStoreSnapshot(JSON.stringify(snap));
      console.log(`PGlite migration: imported ${total} rows into the Go store`);
    }
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
  } catch (e) {
    console.warn('PGlite migration skipped:', e);
  }
}
