// Γνώση του βοηθού: ανάγνωση του site του πελάτη (crawl), κομμάτια, embeddings (Workers AI bge-m3, πολύγλωσσο)
// στο Vectorize (ένα namespace ανά πελάτη) και αντίγραφο κειμένου στη D1 (με αναζήτηση λέξεων FTS ως εφεδρεία).
import { norm, nowIso, sha256Hex, clean } from './util.ts';
import { htmlToText, pageTitle, sameSiteLinks, sitemapUrls, chunkText } from './text.ts';

export type Env = {
  DB: any; AI: any; VEC?: any;
  ADMIN_TOKEN?: string; IP_SALT?: string; NEURON_CAP?: string; CHAT_MODEL?: string; EMBED_MODEL?: string;
  BRAND_NAME?: string; BRAND_URL?: string; NOTIFY_WEBHOOK?: string; PUBLIC_URL?: string;
  ANTHROPIC_API_KEY?: string; CLAUDE_MODEL?: string; CLAUDE_MONTHLY_USD?: string;
};
export const EMBED = (env: Env) => env.EMBED_MODEL || '@cf/baai/bge-m3';
// Neurons ανά εκατομμύριο tokens (τιμοκατάλογος Workers AI) — για τον μετρητή του δωρεάν ορίου.
export const NEURONS = { embed: 1075, in: 9091, out: 27273 };
const UA = 'Thya-Chat-Bot/1.0 (+https://www.thya.gr)';
const MAX_CHUNKS_PAGE = 25;

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const r = await env.AI.run(EMBED(env), { text: texts });
  return (r?.data || []) as number[][];
}
const estTokens = (s: string) => Math.ceil(s.length / 3);

async function addUsage(env: Env, tenant: string, neurons: number) {
  const d = nowIso().slice(0, 10);
  await env.DB.prepare('INSERT INTO usage_daily (tenant, day, neurons) VALUES (?, ?, ?) ON CONFLICT(tenant, day) DO UPDATE SET neurons = neurons + excluded.neurons').bind(tenant, d, neurons).run().catch(() => {});
}

async function fetchText(url: string, ms = 10000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
  const type = r.headers.get('content-type') || '';
  const body = r.ok && /html|xml|text/i.test(type) ? (await r.text()).slice(0, 2_000_000) : '';
  return { status: r.status, type, body, url: r.url || url };
}

// Ξεκινά (ή ξαναξεκινά) την εκπαίδευση: sitemap αν υπάρχει, αλλιώς η αρχική σελίδα και οι σύνδεσμοί της.
export async function enqueueTenant(env: Env, t: any) {
  const start = new URL(t.start_url || JSON.parse(t.origins)[0]);
  const max = Math.max(1, Math.min(+t.max_pages || 60, 500));
  let urls: string[] = [];
  for (const sm of [`${start.origin}/sitemap.xml`, `${start.origin}/sitemap_index.xml`, `${start.origin}/wp-sitemap.xml`]) {
    try {
      const r = await fetchText(sm, 8000); if (!r.body.includes('<loc>')) continue;
      const locs = sitemapUrls(r.body, start.host);
      const subs = locs.filter((u) => /\.xml(\?|$)/i.test(u)).slice(0, 8);
      urls.push(...locs.filter((u) => !/\.xml(\?|$)/i.test(u)));
      for (const s of subs) { try { const x = await fetchText(s, 8000); urls.push(...sitemapUrls(x.body, start.host).filter((u) => !/\.xml(\?|$)/i.test(u))); } catch { /* */ } }
      if (urls.length) break;
    } catch { /* */ }
  }
  urls = [start.toString(), ...urls.filter((u) => u !== start.toString())];
  urls = [...new Set(urls)].slice(0, max);
  const at = nowIso();
  for (const u of urls) await env.DB.prepare('INSERT OR IGNORE INTO crawl_queue (tenant, url, added_at) VALUES (?, ?, ?)').bind(t.id, u, at).run();
  await env.DB.prepare('UPDATE tenants SET crawl_note = ?, updated_at = ? WHERE id = ?').bind(`σε εξέλιξη: ${urls.length} σελίδες στην ουρά`, at, t.id).run();
  return urls.length;
}

// Διαβάζει έως `budget` σελίδες από την ουρά. Αν μια σελίδα δεν απαντά, κρατά την παλιά γνώση (δεν σβήνει τίποτα).
export async function crawlStep(env: Env, budget = 8) {
  const rows: any[] = (await env.DB.prepare('SELECT q.tenant, q.url, q.tries, t.origins, t.start_url, t.max_pages FROM crawl_queue q JOIN tenants t ON t.id = q.tenant WHERE t.status = ? ORDER BY q.tries, q.added_at LIMIT ?').bind('active', budget).all()).results || [];
  let done = 0;
  for (const q of rows) {
    const del = () => env.DB.prepare('DELETE FROM crawl_queue WHERE tenant = ? AND url = ?').bind(q.tenant, q.url).run();
    try {
      const r = await fetchText(q.url);
      if (r.status === 404 || r.status === 410) { await removePage(env, q.tenant, q.url); await del(); done++; continue; }
      if (!r.body || !/html/i.test(r.type)) { if (q.tries >= 2) await del(); else await env.DB.prepare('UPDATE crawl_queue SET tries = tries + 1 WHERE tenant = ? AND url = ?').bind(q.tenant, q.url).run(); continue; }
      // σύνδεσμοι: μόνο όταν δεν υπάρχει sitemap (η ουρά ξεκίνησε μόνο από την αρχική) και μέχρι το όριο σελίδων
      const known = (await env.DB.prepare('SELECT (SELECT COUNT(*) FROM pages WHERE tenant = ?) + (SELECT COUNT(*) FROM crawl_queue WHERE tenant = ?) AS n').bind(q.tenant, q.tenant).first())?.n || 0;
      if (known < (+q.max_pages || 60)) {
        const room = (+q.max_pages || 60) - known; const at = nowIso();
        for (const u of sameSiteLinks(r.body, q.url).slice(0, room)) {
          const seen = await env.DB.prepare('SELECT 1 FROM pages WHERE tenant = ? AND url = ?').bind(q.tenant, u).first();
          if (!seen) await env.DB.prepare('INSERT OR IGNORE INTO crawl_queue (tenant, url, added_at) VALUES (?, ?, ?)').bind(q.tenant, u, at).run();
        }
      }
      const title = pageTitle(r.body); const text = htmlToText(r.body);
      const hash = (await sha256Hex(text)).slice(0, 12);
      const old = await env.DB.prepare('SELECT hash FROM pages WHERE tenant = ? AND url = ?').bind(q.tenant, q.url).first();
      if (old?.hash === hash) { await env.DB.prepare('UPDATE pages SET fetched_at = ? WHERE tenant = ? AND url = ?').bind(nowIso(), q.tenant, q.url).run(); await del(); done++; continue; }
      const chunks = chunkText(text).slice(0, MAX_CHUNKS_PAGE);
      await indexPage(env, q.tenant, q.url, title, hash, chunks);
      await del(); done++;
    } catch {
      if (q.tries >= 2) await del(); else await env.DB.prepare('UPDATE crawl_queue SET tries = tries + 1 WHERE tenant = ? AND url = ?').bind(q.tenant, q.url).run();
    }
  }
  // ολοκληρώθηκε η εκπαίδευση πελάτη;
  const tenants = [...new Set(rows.map((r) => r.tenant))];
  for (const t of tenants) {
    const left = (await env.DB.prepare('SELECT COUNT(*) AS n FROM crawl_queue WHERE tenant = ?').bind(t).first())?.n || 0;
    if (!left) {
      const s = await env.DB.prepare('SELECT COUNT(*) AS p, COALESCE(SUM(chunks),0) AS c FROM pages WHERE tenant = ?').bind(t).first();
      await env.DB.prepare('UPDATE tenants SET crawled_at = ?, crawl_note = ?, updated_at = ? WHERE id = ?').bind(nowIso(), `έτοιμο: ${s?.p || 0} σελίδες, ${s?.c || 0} κομμάτια γνώσης`, nowIso(), t).run();
    }
  }
  return done;
}

async function oldIds(env: Env, tenant: string, url: string): Promise<string[]> {
  return ((await env.DB.prepare('SELECT id FROM chunks WHERE tenant = ? AND url = ?').bind(tenant, url).all()).results || []).map((r: any) => r.id);
}
export async function removePage(env: Env, tenant: string, url: string) {
  const ids = await oldIds(env, tenant, url);
  if (ids.length && env.VEC) await env.VEC.deleteByIds(ids).catch(() => {});
  for (const id of ids) await env.DB.prepare('DELETE FROM chunks_fts WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM chunks WHERE tenant = ? AND url = ?').bind(tenant, url).run();
  await env.DB.prepare('DELETE FROM pages WHERE tenant = ? AND url = ?').bind(tenant, url).run();
}

// Γράφει τη γνώση μιας σελίδας (ή ενός κειμένου που έδωσε ο πελάτης, url = 'doc:<όνομα>').
export async function indexPage(env: Env, tenant: string, url: string, title: string, hash: string, chunks: string[]) {
  const at = nowIso();
  const ids = chunks.map((_, i) => `${tenant}:${hash}:${i}`.slice(0, 64));
  // πρώτα τα νέα embeddings — αν αποτύχουν, η παλιά γνώση μένει όπως ήταν
  let vecs: number[][] = [];
  if (env.VEC && chunks.length) {
    vecs = await embed(env, chunks.map((c) => `${title}\n${c}`.slice(0, 2000)));
    await addUsage(env, tenant, chunks.reduce((a, c) => a + estTokens(c), 0) * NEURONS.embed / 1e6);
  }
  const prev = await oldIds(env, tenant, url);
  const stale = prev.filter((id) => !ids.includes(id));
  if (stale.length && env.VEC) await env.VEC.deleteByIds(stale).catch(() => {});
  for (const id of prev) await env.DB.prepare('DELETE FROM chunks_fts WHERE id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM chunks WHERE tenant = ? AND url = ?').bind(tenant, url).run();
  for (let i = 0; i < chunks.length; i++) {
    await env.DB.prepare('INSERT OR REPLACE INTO chunks (id, tenant, url, title, text, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(ids[i], tenant, url, title, chunks[i], at).run();
    await env.DB.prepare('INSERT INTO chunks_fts (id, tenant, body) VALUES (?, ?, ?)').bind(ids[i], tenant, norm(`${title}\n${chunks[i]}`)).run();
  }
  if (vecs.length) await env.VEC.upsert(vecs.map((v, i) => ({ id: ids[i], values: v, namespace: tenant })));
  await env.DB.prepare('INSERT INTO pages (tenant, url, title, hash, chunks, fetched_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant, url) DO UPDATE SET title = excluded.title, hash = excluded.hash, chunks = excluded.chunks, fetched_at = excluded.fetched_at')
    .bind(tenant, url, title, hash, chunks.length, at).run();
}

const STOP = new Set(['και', 'του', 'της', 'των', 'τον', 'την', 'στο', 'στη', 'στην', 'στον', 'για', 'απο', 'που', 'μου', 'σας', 'μας', 'εχει', 'εχετε', 'ειναι', 'θελω', 'πως', 'ποσο', 'ποια', 'ποιο', 'μια', 'ενα', 'the', 'and', 'for', 'you', 'are', 'what', 'how', 'with', 'have', 'can', 'your', 'does']);
export function ftsQuery(q: string) {
  const words = norm(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)).slice(0, 8);
  return [...new Set(words.map((w) => (w.length >= 6 ? w.slice(0, w.length - 2) : w).replace(/["*]/g, '') + '*'))].join(' OR ');
}

// Τα πιο σχετικά κομμάτια για μια ερώτηση: πρώτα σημασιολογικά (Vectorize), συμπλήρωση με λέξεις (FTS).
export async function retrieve(env: Env, tenant: string, query: string, k = 6) {
  const found = new Map<string, any>(); let neurons = 0;
  if (env.VEC) {
    try {
      const [v] = await embed(env, [clean(query, 1000)]); neurons += estTokens(query) * NEURONS.embed / 1e6;
      if (v) {
        const res = await env.VEC.query(v, { topK: k, namespace: tenant });
        const ids = (res?.matches || []).filter((m: any) => (m.score ?? 1) > 0.35).map((m: any) => m.id);
        if (ids.length) {
          const rows = (await env.DB.prepare(`SELECT id, url, title, text FROM chunks WHERE tenant = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(tenant, ...ids).all()).results || [];
          for (const id of ids) { const r = rows.find((x: any) => x.id === id); if (r) found.set(id, r); }
        }
      }
    } catch { /* συνεχίζουμε με λέξεις */ }
  }
  const fq = ftsQuery(query);
  if (fq && found.size < k) {
    try {
      const rows = (await env.DB.prepare('SELECT c.id, c.url, c.title, c.text FROM chunks_fts f JOIN chunks c ON c.id = f.id WHERE chunks_fts MATCH ? AND f.tenant = ? ORDER BY rank LIMIT ?').bind(fq, tenant, k).all()).results || [];
      for (const r of rows) if (!found.has(r.id) && found.size < k) found.set(r.id, r);
    } catch { /* */ }
  }
  let total = 0; const out: any[] = [];
  for (const r of found.values()) { if (total + r.text.length > 6000) break; total += r.text.length; out.push(r); }
  return { chunks: out, neurons };
}
