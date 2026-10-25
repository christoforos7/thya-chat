// Καταστήματα (WooCommerce): κατάλογος προϊόντων, κατάσταση παραγγελίας και ειδοποιήσεις σε ομάδα Telegram.
// - Κατάλογος: από το ΔΗΜΟΣΙΟ Store API του καταστήματος (/wp-json/wc/store/v1/products), χωρίς κλειδιά, κάθε ώρα στη D1.
// - Παραγγελίες: WooCommerce REST API με κλειδί ΜΟΝΟ ανάγνωσης (secrets WC_KEY_<ID>, WC_SECRET_<ID>).
//   Απαντά μόνο αν ο αριθμός ΚΑΙ το email ταιριάζουν με την παραγγελία· αλλιώς «δεν βρέθηκε» (χωρίς διαρροή).
//   Στον βοηθό φτάνουν μόνο κατάσταση, ημερομηνία, προϊόντα, τρόπος αποστολής και αριθμός αποστολής — ποτέ διεύθυνση/τηλέφωνο/πληρωμή.
// - Telegram: ένα κοινό κανάλι/ομάδα ανά πελάτη (tenants.tg_chat) με το bot του Thya (secret TG_BOT_TOKEN).
import type { Env } from './kb.ts';
import { ftsQuery } from './kb.ts';
import { clean, norm, nowIso, parseObj, EMAIL_RE } from './util.ts';
import { htmlToText } from './text.ts';

export type ShopEnv = Env & { TG_BOT_TOKEN?: string; [k: string]: any };

export const SHOP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shop_products (tenant TEXT NOT NULL, id INTEGER NOT NULL, name TEXT NOT NULL, url TEXT, price TEXT, sale INTEGER NOT NULL DEFAULT 0, in_stock INTEGER NOT NULL DEFAULT 1, cats TEXT, descr TEXT, image TEXT, updated TEXT NOT NULL, PRIMARY KEY (tenant, id))`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS shop_fts USING fts5(tenant UNINDEXED, pid UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2')`,
];
const ALTERS = ['ALTER TABLE shop_products ADD COLUMN image TEXT', 'ALTER TABLE tenants ADD COLUMN shop TEXT', 'ALTER TABLE tenants ADD COLUMN tg_chat TEXT', 'ALTER TABLE tenants ADD COLUMN shop_synced TEXT'];
let ready = false;
export async function ensureShop(env: Env) {
  if (ready) return;
  for (const q of SHOP_SCHEMA) await env.DB.prepare(q).run();
  for (const q of ALTERS) await env.DB.prepare(q).run().catch(() => {});
  ready = true;
}

export function shopCfg(t: any): { base: string } | null {
  const s = parseObj(t?.shop);
  if (s.type !== 'woocommerce' || typeof s.base !== 'string' || !/^https:\/\/[a-z0-9.-]+$/i.test(s.base)) return null;
  return { base: s.base.replace(/\/+$/, '') };
}
const envKey = (t: any) => String(t.id).toUpperCase().replace(/[^A-Z0-9]/g, '_');

// ---------------- κατάλογος ----------------
export function money(minor: unknown, digits: unknown, sym = '€') {
  const n = Number(minor); const d = Number.isFinite(+(digits as number)) ? +(digits as number) : 2;
  if (!Number.isFinite(n)) return '';
  return (n / 10 ** d).toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + sym;
}
export function productRow(p: any) {
  const pr = p?.prices || {}; const d = pr.currency_minor_unit; const sym = pr.currency_symbol || '€';
  let price = '';
  if (pr.price_range && pr.price_range.min_amount != null && pr.price_range.min_amount !== pr.price_range.max_amount) price = `${money(pr.price_range.min_amount, d, sym)} – ${money(pr.price_range.max_amount, d, sym)}`;
  else if (pr.price != null && pr.price !== '') price = money(pr.price, d, sym);
  const sale = !!p.on_sale && pr.regular_price && pr.regular_price !== pr.price;
  if (sale) price += ` (αντί ${money(pr.regular_price, d, sym)})`;
  return {
    id: +p.id, name: clean(htmlToText(String(p.name || '')), 160), url: /^https:\/\//.test(p.permalink || '') ? String(p.permalink) : null, price,
    sale: sale ? 1 : 0, in_stock: p.is_in_stock === false ? 0 : 1,
    cats: (Array.isArray(p.categories) ? p.categories : []).map((c: any) => clean(htmlToText(String(c?.name || '')), 60)).filter(Boolean).join(', '),
    descr: clean(htmlToText(String(p.short_description || p.description || '')), 300),
    image: (() => { const im = Array.isArray(p.images) ? p.images[0] : null; const u = im && (im.thumbnail || im.src); return typeof u === 'string' && /^https:\/\//.test(u) ? u : null; })(),
  };
}

export async function syncCatalog(env: ShopEnv, t: any, maxPages = 10) {
  const cfg = shopCfg(t); if (!cfg) return { ok: false, error: 'no_shop' };
  await ensureShop(env);
  const rows: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetch(`${cfg.base}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { headers: { accept: 'application/json', 'user-agent': 'Thya-Chat/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { if (page === 1) return { ok: false, error: `store_api_${r.status}` }; break; }
    const list: any = await r.json().catch(() => null);
    if (!Array.isArray(list) || !list.length) break;
    for (const p of list) { const x = productRow(p); if (x.id && x.name) rows.push(x); }
    if (list.length < 100) break;
  }
  if (!rows.length) return { ok: false, error: 'empty_catalog' };
  const at = nowIso(); const db = env.DB;
  const stmts = [db.prepare('DELETE FROM shop_products WHERE tenant = ?').bind(t.id), db.prepare('DELETE FROM shop_fts WHERE tenant = ?').bind(t.id)];
  for (const x of rows) {
    stmts.push(db.prepare('INSERT OR REPLACE INTO shop_products (tenant, id, name, url, price, sale, in_stock, cats, descr, image, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(t.id, x.id, x.name, x.url, x.price, x.sale, x.in_stock, x.cats, x.descr, x.image, at));
    stmts.push(db.prepare('INSERT INTO shop_fts (tenant, pid, body) VALUES (?, ?, ?)').bind(t.id, x.id, norm(`${x.name}\n${x.cats}\n${x.descr}`)));
  }
  stmts.push(db.prepare('UPDATE tenants SET shop_synced = ? WHERE id = ?').bind(at, t.id));
  if (db.batch) await db.batch(stmts); else for (const s of stmts) await s.run();
  return { ok: true, products: rows.length };
}

const fmt = (x: any) => `- ${x.name} — ${x.price || 'τιμή στη σελίδα'}${x.sale ? ' · ΠΡΟΣΦΟΡΑ' : ''} · ${x.in_stock ? 'διαθέσιμο' : 'εξαντλημένο'}${x.cats ? ` · ${x.cats}` : ''}${x.url ? `\n  ${x.url}` : ''}${x.descr ? `\n  ${x.descr.slice(0, 160)}` : ''}`;

// Τα πιο σχετικά προϊόντα για την ερώτηση + οι κατηγορίες, ως κείμενο για τον βοηθό.
// Πρόθεση «προσφορές/εκπτώσεις»: απάντηση από την τρέχουσα κατάσταση του καταλόγου, όχι από αναζήτηση λέξεων.
export const OFFER_RE = /προσφορ|εκπτωσ|εκπτωτ|κουπον|κωδικ\p{L}* εκπτ|sale|offer|discount|coupon|black ?friday|μειωμεν/u;
const NEW_CAT_RE = /νεες αφιξεισ|new in|νεα/;

// Τα πιο σχετικά προϊόντα για την ερώτηση + οι κατηγορίες, ως κείμενο για τον βοηθό.
export async function productContext(env: ShopEnv, t: any, query: string, k = 8) { return (await productInfo(env, t, query, k)).text; }
export async function productInfo(env: ShopEnv, t: any, query: string, k = 8): Promise<{ text: string; rows: any[] }> {
  if (!shopCfg(t)) return { text: '', rows: [] };
  await ensureShop(env);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM shop_products WHERE tenant = ?').bind(t.id).first())?.n || 0;
  if (!n) return { text: '', rows: [] };
  const cats = (await env.DB.prepare('SELECT cats FROM shop_products WHERE tenant = ? AND cats IS NOT NULL').bind(t.id).all()).results || [];
  const catSet = [...new Set(cats.flatMap((c: any) => String(c.cats).split(', ')).filter(Boolean))].slice(0, 30);
  const head = `ΚΑΤΑΣΤΗΜΑ: ${n} προϊόντα. Κατηγορίες: ${catSet.join(', ') || '—'}.`;
  const q = norm(query);

  if (OFFER_RE.test(q)) {
    const sale: any[] = (await env.DB.prepare('SELECT * FROM shop_products WHERE tenant = ? AND sale = 1 AND in_stock = 1 ORDER BY updated DESC LIMIT ?').bind(t.id, k).all()).results || [];
    if (sale.length) {
      return { rows: sale, text: [head, `ΠΡΟΪΟΝΤΑ ΣΕ ΠΡΟΣΦΟΡΑ ΤΩΡΑ (μετράνε ως ΠΗΓΕΣ):\n${sale.map(fmt).join('\n')}`,
        'ΠΡΟΣΦΟΡΕΣ: παρουσίασε με ενθουσιασμό 2–3 από αυτά με την τιμή προσφοράς, την αρχική τιμή και τον σύνδεσμο. Ρώτα αν ψάχνει κάτι συγκεκριμένο ή για δώρο.'].join('\n') };
    }
    const all: any[] = (await env.DB.prepare('SELECT * FROM shop_products WHERE tenant = ? AND in_stock = 1 ORDER BY updated DESC').bind(t.id).all()).results || [];
    const fresh = all.filter((x) => NEW_CAT_RE.test(norm(x.cats || ''))).slice(0, 4);
    const pick = (fresh.length ? fresh : all.slice(0, 4));
    return { rows: pick, text: [head, `ΝΕΕΣ ΑΦΙΞΕΙΣ / ΠΡΟΤΑΣΕΙΣ (μετράνε ως ΠΗΓΕΣ):\n${pick.map(fmt).join('\n')}`,
      'ΠΡΟΣΦΟΡΕΣ — ΑΥΤΗ ΤΗ ΣΤΙΓΜΗ δεν τρέχει έκπτωση σε προϊόντα. Απάντησε σαν το ίδιο το κατάστημα (α΄ πληθυντικός: «αυτή τη στιγμή δεν έχουμε…»), ζεστά και με σιγουριά, σε 2–4 σύντομες προτάσεις:',
      '1) πες απλά ότι αυτή την περίοδο δεν τρέχει κάποια έκπτωση· 2) θύμισε τα σταθερά πλεονεκτήματα (π.χ. δωρεάν αποστολή, Gift Card αν υπάρχει στις κατηγορίες)· 3) πρότεινε 1–2 από τις ΝΕΕΣ ΑΦΙΞΕΙΣ με τιμή και σύνδεσμο· 4) πρότεινε να αφήσει το email του για να ενημερωθεί πρώτος/πρώτη για την επόμενη προσφορά.',
      'ΑΠΑΓΟΡΕΥΕΤΑΙ στις προσφορές: «δεν έχω στοιχεία», «δεν γνωρίζω», «δεν θέλω να σας δώσω λάθος πληροφορία», παραπομπή σε τηλέφωνο για προσφορές, ή επινόηση έκπτωσης/κουπονιού.'].join('\n') };
  }

  const fq = ftsQuery(query);
  let rows: any[] = [];
  if (fq) {
    try { rows = (await env.DB.prepare('SELECT p.* FROM shop_fts f JOIN shop_products p ON p.tenant = f.tenant AND p.id = f.pid WHERE shop_fts MATCH ? AND f.tenant = ? ORDER BY p.in_stock DESC, rank LIMIT ?').bind(fq, t.id, k).all()).results || []; } catch { rows = []; }
  }
  if (!rows.length && /δωρ|gift|νε[αο]|new/.test(q)) {
    rows = (await env.DB.prepare('SELECT * FROM shop_products WHERE tenant = ? AND in_stock = 1 ORDER BY sale DESC, updated DESC LIMIT ?').bind(t.id, k).all()).results || [];
  }
  return { rows, text: [
    head,
    rows.length ? `ΣΧΕΤΙΚΑ ΠΡΟΪΟΝΤΑ (τρέχουσες τιμές και διαθεσιμότητα· μετράνε ως ΠΗΓΕΣ):\n${rows.map(fmt).join('\n')}` : 'ΣΧΕΤΙΚΑ ΠΡΟΪΟΝΤΑ: κανένα δεν ταιριάζει ακριβώς — ρώτα τι ψάχνει (είδος, υλικό, χρώμα, για δώρο σε ποιον, προϋπολογισμό) ή πρότεινε κατηγορία.',
    'ΠΡΟΤΑΣΕΙΣ ΠΡΟΪΟΝΤΩΝ: πρότεινε 1–3 προϊόντα από τα ΣΧΕΤΙΚΑ ΠΡΟΪΟΝΤΑ με τον σύνδεσμό τους, όνομα και τιμή όπως είναι γραμμένα. Μην προτείνεις εξαντλημένα, εκτός αν ρωτήσει για αυτά. Ποτέ προϊόν, τιμή ή έκπτωση που δεν υπάρχει εδώ.',
  ].join('\n') };
}

// Κάρτες για το widget: τα προϊόντα (από όσα είδε ο βοηθός) που αναφέρει η απάντηση, με φωτογραφία και τιμή.
export function productCards(rows: any[], reply: string, max = 3) {
  const r = norm(reply); const out: any[] = []; const seen = new Set<number>();
  for (const x of rows) {
    if (out.length >= max || seen.has(x.id) || !x.url) continue;
    const byUrl = reply.includes(x.url) || (() => { try { return reply.includes(decodeURI(x.url)); } catch { return false; } })();
    const byName = x.name && x.name.length >= 4 && r.includes(norm(x.name));
    if (byUrl || byName) { seen.add(x.id); out.push({ name: x.name, price: x.price || '', url: x.url, image: x.image || null, in_stock: !!x.in_stock }); }
  }
  return out;
}

// ---------------- παραγγελίες ----------------
const ORDER_RE = /(?:#\s?|(?:παραγγελ\p{L}*|order|αρ\.?|αριθμ\p{L}*|no\.?)\s*(?:αρ\.?|no\.?|#|:)?\s*)(\d{2,9})\b/iu;
export function detectOrder(texts: string[]) {
  const s = texts.join('\n');
  const asks = /παραγγελ|order|αποστολ|δεμα|courier|tracking|voucher|πότε (θα )?(έρθει|φτάσει)|ποτε (θα )?(ερθει|φτασει)|που ειναι|πού είναι/i.test(s) || /παραγγελ|αποστολ|δεμα/.test(norm(s));
  const num = (s.match(ORDER_RE) || [])[1] || '';
  const email = ((s.match(EMAIL_RE) || [])[0] || '').toLowerCase();
  return { asks: asks || !!num, number: num, email };
}
const STATUS: Record<string, string> = {
  pending: 'Σε αναμονή πληρωμής', processing: 'Σε επεξεργασία (ετοιμάζεται)', 'on-hold': 'Σε αναμονή (θα επικοινωνήσουμε αν χρειαστεί)',
  completed: 'Ολοκληρώθηκε / έχει αποσταλεί', cancelled: 'Ακυρώθηκε', refunded: 'Έγινε επιστροφή χρημάτων', failed: 'Η πληρωμή απέτυχε',
  'checkout-draft': 'Δεν ολοκληρώθηκε', shipped: 'Απεστάλη', delivered: 'Παραδόθηκε',
};
export function ordersEnabled(env: ShopEnv, t: any) { const k = envKey(t); return !!(shopCfg(t) && env[`WC_KEY_${k}`] && env[`WC_SECRET_${k}`]); }

export async function lookupOrder(env: ShopEnv, t: any, number: string, email: string): Promise<{ found: boolean; text: string }> {
  const cfg = shopCfg(t); const k = envKey(t);
  const key = env[`WC_KEY_${k}`], sec = env[`WC_SECRET_${k}`];
  if (!cfg || !key || !sec || !/^\d{2,9}$/.test(number) || !email) return { found: false, text: '' };
  let o: any = null;
  try {
    const r = await fetch(`${cfg.base}/wp-json/wc/v3/orders/${number}`, { headers: { authorization: 'Basic ' + btoa(`${key}:${sec}`), accept: 'application/json', 'user-agent': 'Thya-Chat/1.0' }, signal: AbortSignal.timeout(12000) });
    if (r.ok) o = await r.json();
  } catch { o = null; }
  if (!o || String(o?.billing?.email || '').trim().toLowerCase() !== email.trim().toLowerCase()) return { found: false, text: '' };
  const d = o.date_created ? new Date(o.date_created + (/Z|[+-]\d\d:?\d\d$/.test(o.date_created) ? '' : 'Z')) : null;
  const date = d && !isNaN(+d) ? d.toLocaleDateString('el-GR', { timeZone: 'Europe/Athens' }) : '';
  const items = (Array.isArray(o.line_items) ? o.line_items : []).slice(0, 8).map((x: any) => `${clean(x.name, 80)} ×${+x.quantity || 1}`).join(', ');
  const ship = (Array.isArray(o.shipping_lines) ? o.shipping_lines : []).map((x: any) => clean(x.method_title, 60)).filter(Boolean).join(', ');
  const track: string[] = [];
  for (const m of Array.isArray(o.meta_data) ? o.meta_data : []) {
    if (!/track|voucher|courier|acs|elta|geniki|speedex|boxnow|box_now/i.test(String(m?.key || ''))) continue;
    const v = m.value;
    if (typeof v === 'string' && v.length <= 80 && /[A-Za-z0-9]/.test(v)) track.push(clean(v, 80));
    else if (Array.isArray(v)) for (const x of v) { const n = x?.tracking_number || x?.voucher; if (n) track.push(`${clean(x.tracking_provider || x.custom_tracking_provider || '', 40)} ${clean(n, 60)}`.trim()); }
  }
  const text = [`ΠΑΡΑΓΓΕΛΙΑ #${number} (επιβεβαιωμένη με το email του πελάτη):`, `Κατάσταση: ${STATUS[o.status] || clean(o.status, 40)}`, date && `Ημερομηνία: ${date}`, items && `Προϊόντα: ${items}`, ship && `Αποστολή: ${ship}`, track.length ? `Αριθμός αποστολής: ${[...new Set(track)].slice(0, 3).join(' · ')}` : ''].filter(Boolean).join('\n');
  return { found: true, text };
}

export function orderBlock(enabled: boolean, res: { found: boolean; text: string } | null, det: { asks: boolean; number: string; email: string }) {
  if (!det.asks) return '';
  if (!enabled) return 'ΠΑΡΑΓΓΕΛΙΕΣ: δεν έχεις πρόσβαση σε παραγγελίες. Για κατάσταση παραγγελίας ζήτα να αφήσει όνομα, αριθμό παραγγελίας και τηλέφωνο ή email, και πες ότι το κατάστημα θα επικοινωνήσει.';
  if (res?.found) return `${res.text}\nΔώσε αυτά τα στοιχεία σύντομα και φιλικά. Μην υποσχεθείς ημερομηνία παράδοσης που δεν γράφεται εδώ.`;
  if (det.number && det.email) return 'ΠΑΡΑΓΓΕΛΙΕΣ: ο συνδυασμός αριθμού παραγγελίας και email δεν βρέθηκε. Ζήτα να ελέγξει τον αριθμό και το email που έδωσε στην παραγγελία, ή να αφήσει τα στοιχεία του για να τον βοηθήσει το κατάστημα. Μην πεις αν υπάρχει παραγγελία με αυτόν τον αριθμό.';
  return 'ΠΑΡΑΓΓΕΛΙΕΣ: για να δεις την κατάσταση χρειάζεσαι ΚΑΙ τον αριθμό παραγγελίας ΚΑΙ το email που δόθηκε στην παραγγελία. Ζήτα ό,τι λείπει (ο αριθμός υπάρχει στο email επιβεβαίωσης).';
}

// ---------------- Telegram ----------------
const tgOk = (t: any) => /^-?\d{5,20}$/.test(String(t?.tg_chat || ''));
export async function tgSend(env: ShopEnv, t: any, text: string) {
  if (!env.TG_BOT_TOKEN || !tgOk(t)) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: String(t.tg_chat), text: text.slice(0, 3900), disable_web_page_preview: true }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const j: any = await r.json().catch(() => ({}));
    return (j?.result?.message_id as number) || true; // message_id για αντιστοίχιση reply → συζήτηση
  } catch { return false; }
}
export function turnText(t: any, x: { q: string; reply: string; country?: string; path?: string; sid: string; order?: boolean; lead?: boolean }) {
  const host = (() => { try { return new URL(JSON.parse(t.origins)[0]).hostname; } catch { return t.name; } })();
  const head = `💬 ${host}${x.path ? ` · ${x.path.slice(0, 60)}` : ''}${x.country ? ` · ${x.country}` : ''} · #${x.sid.slice(0, 6)}${x.order ? ' · 📦 παραγγελία' : ''}${x.lead ? ' · ⭐ στοιχεία' : ''}`;
  return `${head}\n👤 ${x.q.slice(0, 1200)}\n🤖 ${x.reply.slice(0, 1800)}`;
}
// Βοήθεια εγκατάστασης: ποιες ομάδες/κανάλια έχουν μιλήσει πρόσφατα στο bot (για το chat id).
export async function tgChats(env: ShopEnv) {
  if (!env.TG_BOT_TOKEN) return { error: 'no_bot_token' };
  const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getUpdates?allowed_updates=${encodeURIComponent('[]')}`, { signal: AbortSignal.timeout(8000) });
  const j: any = await r.json().catch(() => ({}));
  const seen = new Map<string, any>();
  for (const u of j.result || []) { const c = u.message?.chat || u.my_chat_member?.chat || u.chat_member?.chat || u.channel_post?.chat || u.edited_message?.chat; if (c?.id) seen.set(String(c.id), { id: String(c.id), type: c.type, title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') }); }
  let bot: any = null; let hook: any = null;
  try { const m: any = await (await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(8000) })).json(); bot = m.ok ? { username: m.result?.username, name: m.result?.first_name } : { error: m.description || 'getMe_failed' }; } catch { bot = { error: 'getMe_unreachable' }; }
  try { const w: any = await (await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getWebhookInfo`, { signal: AbortSignal.timeout(8000) })).json(); hook = { webhook_set: !!w.result?.url, pending: w.result?.pending_update_count ?? null }; } catch { hook = null; }
  return { chats: [...seen.values()], updates: (j.result || []).length, kinds: [...new Set((j.result || []).map((u: any) => Object.keys(u).filter((k) => k !== 'update_id')[0]))], updates_ok: j.ok === true, telegram_error: j.ok === false ? String(j.description || '').slice(0, 120) : null, bot, ...(hook || {}) };
}

// Όταν το widget δείχνει κάρτες, οι σύνδεσμοι των ίδιων προϊόντων στο κείμενο περισσεύουν: [όνομα](url) → όνομα, γυμνό url → αφαιρείται.
export function stripCardLinks(reply: string, cards: { url: string }[]) {
  let out = reply;
  for (const c of cards) {
    const us = [c.url]; try { const d = decodeURI(c.url); if (d !== c.url) us.push(d); } catch { /* */ }
    for (const u of us) {
      const e = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('\\[([^\\]\\n]{1,120})\\]\\(' + e + '\\)', 'g'), '$1');
      out = out.replace(new RegExp('[ \\t]*[(\\-–:]?[ \\t]*' + e + '[ \\t]*\\)?', 'g'), '');
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
