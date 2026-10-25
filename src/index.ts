// Thya Chat — AI βοηθός του thya.gr (όλα σε Cloudflare: Workers, Workers AI, D1).
//   GET  /w.js                          το widget (μία γραμμή στο site του πελάτη)
//   GET  /v1/t/<site_key>/config         εμφάνιση του βοηθού (μόνο από επιτρεπόμενο origin)
//   POST /v1/t/<site_key>/chat           συζήτηση
//   POST /v1/t/<site_key>/lead           φόρμα στοιχείων (με συγκατάθεση)
//   /admin/*                             διαχείριση (Bearer ADMIN_TOKEN)
// Συντήρηση (χωρίς cron, στο παρασκήνιο των συζητήσεων): εκπαίδευση, κατάλογος κάθε ώρα, καθαρισμός > 90 ημερών.
import { type Env, crawlStep, enqueueTenant } from './kb.ts';
import { handleChat, handleLead } from './chat.ts';
import { handleAdmin } from './admin.ts';
import { WIDGET_JS } from './widget.ts';
import { asset } from './assets.ts';
import { ensureShop, syncCatalog } from './shop.ts';
import { json, cors, originAllowed, parseList, parseObj, SEC_HEADERS, nowIso } from './util.ts';

const KEY_RE = /^pk_[a-z0-9]{10,40}$/;
const RETENTION_DAYS = 90;

async function tenantByKey(env: Env, key: string) {
  if (!KEY_RE.test(key)) return null;
  return env.DB.prepare('SELECT * FROM tenants WHERE site_key = ?').bind(key).first();
}

// Συντήρηση χωρίς cron (ο δωρεάν λογαριασμός έχει όριο cron): τρέχει στο παρασκήνιο μιας συζήτησης,
// το πολύ μία φορά ανά MAINT_EVERY. Κατάλογος κάθε ώρα, εβδομαδιαία επανεκπαίδευση, καθαρισμός παλιών δεδομένων.
const MAINT_EVERY = 10 * 60_000;
export async function maintenance(env: Env, force = false) {
  const now = Date.now();
  if (!force) {
    const last = (await env.DB.prepare("SELECT MAX(ts) AS t FROM rl WHERE h = 'maint'").first())?.t || 0;
    if (now - last < MAINT_EVERY) return false;
  }
  await env.DB.prepare("INSERT INTO rl (h, ts) VALUES ('maint', ?)").bind(now).run();
  const due: any = await env.DB.prepare("SELECT * FROM tenants WHERE status = 'active' AND (crawled_at IS NULL OR crawled_at < datetime('now', '-7 days')) AND NOT EXISTS (SELECT 1 FROM crawl_queue q WHERE q.tenant = tenants.id) ORDER BY crawled_at LIMIT 1").first();
  if (due) await enqueueTenant(env, due).catch(() => 0);
  await crawlStep(env, 6).catch(() => 0);
  await ensureShop(env).catch(() => {});
  const shop: any = await env.DB.prepare("SELECT * FROM tenants WHERE status = 'active' AND shop IS NOT NULL AND (shop_synced IS NULL OR shop_synced < ?) ORDER BY shop_synced LIMIT 1").bind(new Date(now - 3600_000).toISOString()).first().catch(() => null);
  if (shop) await syncCatalog(env as any, shop).catch(() => null);
  const lastClean = (await env.DB.prepare("SELECT MAX(ts) AS t FROM rl WHERE h = 'clean'").first())?.t || 0;
  if (now - lastClean > 3600_000) {
    const cut = new Date(now - RETENTION_DAYS * 86400_000).toISOString();
    await env.DB.prepare("DELETE FROM rl WHERE ts < ? AND h NOT IN ('maint', 'clean')").bind(now - 26 * 3600_000).run();
    await env.DB.prepare("DELETE FROM rl WHERE h IN ('maint', 'clean') AND ts < ?").bind(now - 7 * 86400_000).run();
    await env.DB.prepare("INSERT INTO rl (h, ts) VALUES ('clean', ?)").bind(now).run();
    await env.DB.prepare('DELETE FROM messages WHERE at < ?').bind(cut).run();
    await env.DB.prepare('DELETE FROM convos WHERE last_at < ?').bind(cut).run();
    await env.DB.prepare('DELETE FROM leads WHERE at < ?').bind(new Date(now - 365 * 86400_000).toISOString()).run();
    await env.DB.prepare("DELETE FROM usage_daily WHERE day < date('now', '-400 days')").run();
    await env.DB.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').bind(nowIso(), 'maint', 'cleanup', cut).run().catch(() => {});
  }
  return true;
}

export default {
  async fetch(req: Request, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname;
    const publicUrl = env.PUBLIC_URL || url.origin;
    // /w.js = έκδοση των επισκεπτών· /w-next.js = ίδια (χρησιμοποιείται για προεπισκόπηση πριν από αλλαγές)
    if ((p === '/w.js' || p === '/w-next.js') && req.method === 'GET') {
      return new Response(WIDGET_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', ...SEC_HEADERS } });
    }
    if (p.startsWith('/a/') && req.method === 'GET') { const r = asset(p); if (r) return r; }
    if (p === '/' || p === '/health') return json({ ok: true, service: env.BRAND_NAME || 'Thya Chat' });
    if (p.startsWith('/admin/')) return handleAdmin(req, env, p, publicUrl);

    const m = p.match(/^\/v1\/t\/([^/]+)\/(config|chat|lead)$/);
    if (!m) return json({ error: 'not_found' }, 404);
    const t: any = await tenantByKey(env, m[1]);
    const origin = req.headers.get('origin');
    // Μόνο από τα domains του πελάτη (το κλειδί είναι δημόσιο· το origin + τα όρια προστατεύουν από κατάχρηση).
    if (!t || t.status !== 'active' || !originAllowed(origin, parseList(t.origins))) return json({ error: 'forbidden' }, 403);
    const h = cors(origin as string);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, ...SEC_HEADERS } });
    if (m[2] === 'config' && req.method === 'GET') {
      const b = parseObj(t.brand);
      const pw = b.powered && typeof b.powered === 'object' ? b.powered : null;
      const powered = pw && typeof pw.name === 'string' && /^https:\/\/[^\s"'<>]{1,200}$/.test(String(pw.url || '')) ? { name: pw.name.slice(0, 50), url: pw.url } : null;
      return json({ ok: true, name: String(b.name || t.name).slice(0, 60), color: b.color, greeting: b.greeting, chips: Array.isArray(b.chips) ? b.chips.slice(0, 4).map((x: any) => String(x).slice(0, 60)) : [], position: b.position, privacy: typeof b.privacy === 'string' && /^https:\/\//.test(b.privacy) ? b.privacy : null, powered, avatar: typeof b.avatar === 'string' && /^(https:\/\/|\/a\/)[^\s"'<>]{1,300}$/.test(b.avatar) ? (b.avatar.startsWith('/') ? publicUrl + b.avatar : b.avatar) : null, teaser: typeof b.teaser === 'string' ? b.teaser.slice(0, 80) : null, subtitle: typeof b.subtitle === 'string' ? b.subtitle.slice(0, 60) : null }, 200, { ...h, 'cache-control': 'public, max-age=300' });
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, h);
    if (!/application\/json/i.test(req.headers.get('content-type') || '')) return json({ error: 'json_required' }, 415, h);
    if (m[2] === 'chat') { ctx.waitUntil(maintenance(env).catch(() => false)); return handleChat(req, env, t, h, ctx); }
    return handleLead(req, env, t, h, ctx);
  },

  // Αν υπάρχει cron (λογαριασμός με διαθέσιμα cron), κάνει την ίδια συντήρηση.
  async scheduled(_e: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(maintenance(env, true).catch(() => {}));
  },
};
