// Thya Chat — AI βοηθός του thya.gr (όλα σε Cloudflare: Workers, Workers AI, D1).
//   GET  /w.js                          το widget (μία γραμμή στο site του πελάτη)
//   GET  /v1/t/<site_key>/config         εμφάνιση του βοηθού (μόνο από επιτρεπόμενο origin)
//   POST /v1/t/<site_key>/chat           συζήτηση
//   POST /v1/t/<site_key>/lead           φόρμα στοιχείων (με συγκατάθεση)
//   /admin/*                             διαχείριση (Bearer ADMIN_TOKEN)
// Cron (κάθε 10'): εκπαίδευση από την ουρά, εβδομαδιαία επανεκπαίδευση, κατάλογος καταστημάτων κάθε ώρα, καθαρισμός δεδομένων > 90 ημερών.
import { type Env, crawlStep, enqueueTenant } from './kb.ts';
import { handleChat, handleLead } from './chat.ts';
import { handleAdmin } from './admin.ts';
import { WIDGET_JS } from './widget.ts';
import { ensureShop, syncCatalog } from './shop.ts';
import { json, cors, originAllowed, parseList, parseObj, SEC_HEADERS, nowIso } from './util.ts';

const KEY_RE = /^pk_[a-z0-9]{10,40}$/;
const RETENTION_DAYS = 90;

async function tenantByKey(env: Env, key: string) {
  if (!KEY_RE.test(key)) return null;
  return env.DB.prepare('SELECT * FROM tenants WHERE site_key = ?').bind(key).first();
}

export default {
  async fetch(req: Request, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname;
    const publicUrl = env.PUBLIC_URL || url.origin;
    if (p === '/w.js' && req.method === 'GET') {
      return new Response(WIDGET_JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', ...SEC_HEADERS } });
    }
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
      const powered = b.powered === true && env.BRAND_URL ? { name: env.BRAND_NAME || 'Thya', url: env.BRAND_URL } : null;
      return json({ ok: true, name: String(b.name || t.name).slice(0, 60), color: b.color, greeting: b.greeting, chips: Array.isArray(b.chips) ? b.chips.slice(0, 4).map((x: any) => String(x).slice(0, 60)) : [], position: b.position, privacy: typeof b.privacy === 'string' && /^https:\/\//.test(b.privacy) ? b.privacy : null, powered }, 200, { ...h, 'cache-control': 'public, max-age=300' });
    }
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, h);
    if (!/application\/json/i.test(req.headers.get('content-type') || '')) return json({ error: 'json_required' }, 415, h);
    if (m[2] === 'chat') return handleChat(req, env, t, h, ctx);
    return handleLead(req, env, t, h, ctx);
  },

  async scheduled(_e: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil((async () => {
      // εβδομαδιαία επανεκπαίδευση (ένας πελάτης ανά εκτέλεση)
      const due: any = await env.DB.prepare("SELECT * FROM tenants WHERE status = 'active' AND (crawled_at IS NULL OR crawled_at < datetime('now', '-7 days')) AND NOT EXISTS (SELECT 1 FROM crawl_queue q WHERE q.tenant = tenants.id) ORDER BY crawled_at LIMIT 1").first();
      if (due) await enqueueTenant(env, due).catch(() => 0);
      await crawlStep(env, 8).catch(() => 0);
      // κατάλογος καταστημάτων: κάθε ώρα, ένα κατάστημα ανά εκτέλεση
      await ensureShop(env).catch(() => {});
      const shop: any = await env.DB.prepare("SELECT * FROM tenants WHERE status = 'active' AND shop IS NOT NULL AND (shop_synced IS NULL OR shop_synced < ?) ORDER BY shop_synced LIMIT 1").bind(new Date(Date.now() - 3600_000).toISOString()).first().catch(() => null);
      if (shop) await syncCatalog(env as any, shop).catch(() => null);
      // καθαρισμός (μία φορά την ώρα)
      if (new Date().getUTCMinutes() < 10) {
        const cut = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
        await env.DB.prepare('DELETE FROM rl WHERE ts < ?').bind(Date.now() - 26 * 3600_000).run();
        await env.DB.prepare('DELETE FROM messages WHERE at < ?').bind(cut).run();
        await env.DB.prepare('DELETE FROM convos WHERE last_at < ?').bind(cut).run();
        await env.DB.prepare('DELETE FROM leads WHERE at < ?').bind(new Date(Date.now() - 365 * 86400_000).toISOString()).run();
        await env.DB.prepare("DELETE FROM usage_daily WHERE day < date('now', '-400 days')").run();
        await env.DB.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').bind(nowIso(), 'cron', 'cleanup', cut).run().catch(() => {});
      }
    })());
  },
};
