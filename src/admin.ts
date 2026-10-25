// Διαχείριση: Authorization: Bearer <ADMIN_TOKEN>. Προτείνεται επιπλέον Cloudflare Access στο /admin/*.
//   GET  /admin/tenants                         λίστα πελατών + χρήση σήμερα
//   POST /admin/tenants                         νέος/ενημέρωση {id, name, origins[], start_url, brand{}, instructions, facts, lead_webhook, daily_cap, max_pages, status}
//   POST /admin/tenants/<id>/crawl[?continue=1] εκπαίδευση τώρα (από το site· συνέχεια όσο remaining > 0)
//   POST /admin/tenants/<id>/doc                πρόσθετο κείμενο γνώσης {title, text}
//   GET  /admin/tenants/<id>/convos?days=7      συζητήσεις
//   GET  /admin/tenants/<id>/leads?days=30      leads
//   GET  /admin/tenants/<id>/install            κώδικας εγκατάστασης
//   GET  /admin/usage?days=14                   χρήση ανά ημέρα (απαντήσεις, neurons)
//   POST /admin/tenants/<id>/shop-sync          κατάλογος καταστήματος τώρα (WooCommerce Store API)
//   POST /admin/tenants/<id>/tg-test            δοκιμαστικό μήνυμα στο κοινό κανάλι Telegram
//   GET  /admin/tg-chats                        ομάδες που είδε πρόσφατα το bot (για το tg_chat· πριν το webhook)
//   POST /admin/tg-webhook                      σύνδεση Telegram → Worker (ζωντανές απαντήσεις, /naria)
//   Πεδία καταστήματος στο POST /admin/tenants: shop {type:'woocommerce', base:'https://...'}, tg_chat ('-100...')
import { type Env, enqueueTenant, indexPage, crawlStep } from './kb.ts';
import { json, safeEqual, clean, nowIso, normOrigin, randomId, sha256Hex, parseList } from './util.ts';
import { chunkText } from './text.ts';
import { monthSpend } from './llm.ts';
import { ensureShop, syncCatalog, tgSend, tgChats, ordersEnabled } from './shop.ts';
import { setupWebhook } from './live.ts';

const ID_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
async function audit(env: Env, action: string, tenant: string | null, detail = '') {
  await env.DB.prepare('INSERT INTO audit (at, actor, action, tenant, detail) VALUES (?, ?, ?, ?, ?)').bind(nowIso(), 'admin', action, tenant, detail.slice(0, 500)).run().catch(() => {});
}

export async function handleAdmin(req: Request, env: Env, path: string, publicUrl: string): Promise<Response> {
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) return json({ error: 'admin_not_configured' }, 503);
  // προστασία από μαντέματα: 10 λάθη/ώρα ανά IP
  const ipH = 'a' + (await sha256Hex(`${req.headers.get('cf-connecting-ip') || ''}|${env.IP_SALT || 'salt'}`)).slice(0, 32);
  const fails = (await env.DB.prepare('SELECT COUNT(*) AS n FROM rl WHERE h = ? AND ts > ?').bind(ipH, Date.now() - 3600_000).first())?.n || 0;
  if (fails >= 10) return json({ error: 'locked' }, 429);
  if (!safeEqual(tok, env.ADMIN_TOKEN)) { await env.DB.prepare('INSERT INTO rl (h, ts) VALUES (?, ?)').bind(ipH, Date.now()).run(); return json({ error: 'unauthorized' }, 401); }

  const seg = path.split('/').filter(Boolean); // ['admin', ...]
  const body = async () => { try { return JSON.parse((await req.text()).slice(0, 200_000) || '{}'); } catch { return {}; } };
  const today = nowIso().slice(0, 10);

  if (seg[1] === 'usage' && req.method === 'GET') {
    const days = Math.min(90, +(new URL(req.url).searchParams.get('days') || 14));
    const rows = (await env.DB.prepare("SELECT day, tenant, replies, neurons, cost_usd, blocked FROM usage_daily WHERE day >= date('now', ?) ORDER BY day DESC, tenant").bind(`-${days} days`).all()).results;
    return json({ neuron_cap: +(env.NEURON_CAP || 9000), claude_month_usd: await monthSpend(env), claude_cap_usd: +(env.CLAUDE_MONTHLY_USD || 30), rows });
  }
  if (seg[1] === 'tg-chats' && req.method === 'GET') return json(await tgChats(env as any));
  if (seg[1] === 'tg-webhook' && req.method === 'POST') { const r = await setupWebhook(env as any, publicUrl); await audit(env, 'tg-webhook', null, JSON.stringify(r)); return json(r); }
  if (seg[1] !== 'tenants') return json({ error: 'not_found' }, 404);

  if (seg.length === 2 && req.method === 'GET') {
    const rows = (await env.DB.prepare('SELECT t.id, t.name, t.site_key, t.origins, t.status, t.plan, t.daily_cap, t.crawled_at, t.crawl_note, u.replies, u.neurons, (SELECT COUNT(*) FROM pages p WHERE p.tenant = t.id) AS pages, (SELECT COUNT(*) FROM leads l WHERE l.tenant = t.id) AS leads FROM tenants t LEFT JOIN usage_daily u ON u.tenant = t.id AND u.day = ? ORDER BY t.created_at').bind(today).all()).results;
    return json({ tenants: rows });
  }
  if (seg.length === 2 && req.method === 'POST') {
    const b = await body(); const id = String(b.id || '').toLowerCase();
    if (!ID_RE.test(id)) return json({ error: 'bad_id', hint: 'πεζά λατινικά, αριθμοί, παύλα (2–31)' }, 400);
    const origins = (Array.isArray(b.origins) ? b.origins : []).map((o: string) => normOrigin(String(o))).filter(Boolean);
    const ex = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!ex && (!b.name || !origins.length)) return json({ error: 'name_and_origins_required' }, 400);
    const startUrl = b.start_url ? String(b.start_url) : ex?.start_url || (origins[0] ? origins[0] + '/' : null);
    if (startUrl && !origins.concat(ex ? parseList(ex.origins) : []).includes(normOrigin(startUrl) || '')) return json({ error: 'start_url_must_match_origins' }, 400);
    if (b.lead_webhook && !/^https:\/\//i.test(String(b.lead_webhook))) return json({ error: 'webhook_must_be_https' }, 400);
    const at = nowIso();
    if (!ex) {
      const key = 'pk_' + randomId(24);
      await env.DB.prepare('INSERT INTO tenants (id, name, site_key, origins, start_url, status, plan, brand, instructions, facts, lead_webhook, lead_email, daily_cap, max_pages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, clean(b.name, 120), key, JSON.stringify(origins), startUrl, b.status === 'paused' ? 'paused' : 'active', clean(b.plan || 'pilot', 20), JSON.stringify(b.brand || {}), clean(b.instructions, 3000) || null, clean(b.facts, 3000) || null, b.lead_webhook || null, clean(b.lead_email, 200) || null, Math.min(5000, +b.daily_cap || 200), Math.min(500, +b.max_pages || 60), at, at).run();
      await audit(env, 'create', id, JSON.stringify({ name: b.name, origins }));
    } else {
      const set = (k: string, v: unknown) => env.DB.prepare(`UPDATE tenants SET ${k} = ?, updated_at = ? WHERE id = ?`).bind(v, at, id).run();
      if (b.name) await set('name', clean(b.name, 120));
      if (origins.length) await set('origins', JSON.stringify(origins));
      if (b.start_url) await set('start_url', startUrl);
      if (b.brand) await set('brand', JSON.stringify(b.brand));
      if ('instructions' in b) await set('instructions', clean(b.instructions, 3000) || null);
      if ('facts' in b) await set('facts', clean(b.facts, 3000) || null);
      if ('lead_webhook' in b) await set('lead_webhook', b.lead_webhook || null);
      if (b.daily_cap) await set('daily_cap', Math.min(5000, +b.daily_cap));
      if (b.max_pages) await set('max_pages', Math.min(500, +b.max_pages));
      if (b.status === 'paused' || b.status === 'active') await set('status', b.status);
      if (b.plan) await set('plan', clean(b.plan, 20));
      if ('model' in b) await set('model', b.model === 'sonnet' ? 'sonnet' : null);
      await audit(env, 'update', id, Object.keys(b).join(','));
    }
    // κατάστημα και Telegram (ίδιο domain με τα origins· chat id αριθμητικό)
    if ('shop' in b || 'tg_chat' in b) {
      await ensureShop(env);
      const cur: any = await env.DB.prepare('SELECT origins FROM tenants WHERE id = ?').bind(id).first();
      if ('shop' in b) {
        const base = b.shop && typeof b.shop.base === 'string' ? normOrigin(b.shop.base) : null;
        if (b.shop && (!base || !parseList(cur?.origins).includes(base))) return json({ error: 'shop_base_must_match_origins' }, 400);
        await env.DB.prepare('UPDATE tenants SET shop = ?, updated_at = ? WHERE id = ?').bind(b.shop ? JSON.stringify({ type: 'woocommerce', base }) : null, at, id).run();
      }
      if ('tg_chat' in b) {
        if (b.tg_chat && !/^-?\d{5,20}$/.test(String(b.tg_chat))) return json({ error: 'bad_tg_chat' }, 400);
        await env.DB.prepare('UPDATE tenants SET tg_chat = ?, updated_at = ? WHERE id = ?').bind(b.tg_chat ? String(b.tg_chat) : null, at, id).run();
      }
    }
    return json({ ok: true, tenant: await env.DB.prepare('SELECT id, name, site_key, origins, status FROM tenants WHERE id = ?').bind(id).first() });
  }

  const id = seg[2]; const t: any = id ? await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first() : null;
  if (!t) return json({ error: 'tenant_not_found' }, 404);
  const days = (d: number) => `-${Math.min(90, +(new URL(req.url).searchParams.get('days') || d))} days`;
  switch (`${req.method} ${seg[3] || ''}`) {
    case 'POST shop-sync': { const r = await syncCatalog(env as any, t); await audit(env, 'shop-sync', id, JSON.stringify(r)); return json({ ...r, orders: ordersEnabled(env as any, t) }, r.ok ? 200 : 502); }
    case 'POST tg-test': return json({ ok: await tgSend(env as any, t, `✅ Ο AI βοηθός του ${t.name} είναι συνδεδεμένος με αυτό το κανάλι. Εδώ θα έρχονται οι συζητήσεις και τα αιτήματα.`) });
    case 'POST crawl': {
      // Χωρίς cron: ουρά + άμεση επεξεργασία μέχρι ~30 σελίδες ανά κλήση· ξανακαλέστε όσο remaining > 0.
      const fresh = new URL(req.url).searchParams.get('continue') !== '1';
      const n = fresh ? await enqueueTenant(env, t) : 0;
      for (let i = 0; i < 5; i++) { const d = await crawlStep(env, 6).catch(() => 0); if (!d) break; }
      const remaining = (await env.DB.prepare('SELECT COUNT(*) AS n FROM crawl_queue WHERE tenant = ?').bind(id).first())?.n || 0;
      const pages = (await env.DB.prepare('SELECT COUNT(*) AS n FROM pages WHERE tenant = ?').bind(id).first())?.n || 0;
      await audit(env, 'crawl', id, `${n}/${remaining}`); return json({ ok: true, queued: n, remaining, pages });
    }
    case 'POST doc': {
      const b = await body(); const title = clean(b.title, 150) || 'Έγγραφο'; const text = clean(b.text, 100_000);
      if (text.length < 50) return json({ error: 'text_too_short' }, 400);
      const chunks = chunkText(text).slice(0, 60); const hash = (await sha256Hex(text)).slice(0, 12);
      await indexPage(env, id, `doc:${title}`, title, hash, chunks); await audit(env, 'doc', id, title);
      return json({ ok: true, chunks: chunks.length });
    }
    case 'GET convos': {
      const convos = (await env.DB.prepare("SELECT sid, started_at, last_at, country, path, msgs, lead FROM convos WHERE tenant = ? AND last_at >= datetime('now', ?) ORDER BY last_at DESC LIMIT 200").bind(id, days(7)).all()).results;
      const msgs = (await env.DB.prepare("SELECT sid, role, text, at FROM messages WHERE tenant = ? AND at >= datetime('now', ?) ORDER BY id LIMIT 2000").bind(id, days(7)).all()).results;
      return json({ convos, messages: msgs });
    }
    case 'GET leads': return json({ leads: (await env.DB.prepare("SELECT id, at, name, email, phone, note, source, notified FROM leads WHERE tenant = ? AND at >= datetime('now', ?) ORDER BY id DESC").bind(id, days(30)).all()).results });
    case 'GET install': return json({ snippet: `<script src="${publicUrl}/w.js" data-key="${t.site_key}" async></script>`, origins: parseList(t.origins) });
  }
  return json({ error: 'not_found' }, 404);
}
