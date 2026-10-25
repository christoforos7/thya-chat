// Ψεύτικη D1 πάνω σε node:sqlite (ίδια SQL με την πραγματική), για τα tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function makeDB() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const fix = (a: any[]) => a.map((x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x));
  return {
    raw: db,
    async batch(list: any[]) { db.exec('BEGIN'); try { for (const st of list) await st.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; },
    prepare(sql: string) {
      let args: any[] = [];
      const st: any = {
        bind: (...a: any[]) => { args = fix(a); return st; },
        first: async () => { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
        all: async () => ({ results: db.prepare(sql).all(...args).map((r: any) => ({ ...r })) }),
        run: async () => { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
      };
      return st;
    },
  };
}
