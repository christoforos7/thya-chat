// Ζωντανή συνομιλία από την ομάδα Telegram + σημειώσεις της επιχείρησης (/naria).
// - Reply σε μήνυμα της Naria στην ομάδα → το κείμενο φτάνει στο παράθυρο του επισκέπτη ως «<όνομα> · ομάδα».
//   Η Naria σιωπά σε αυτή τη συζήτηση για TAKEOVER_MIN λεπτά (κάθε νέο reply ανανεώνει τον χρόνο). «/naria συνέχισε» (ως reply) την επαναφέρει.
// - /naria <κείμενο> → νέα σημείωση που η Naria χρησιμοποιεί αμέσως (υπερισχύει του site). /naria λίστα · /naria σβήσε N.
// - Το webhook ελέγχεται με μυστικό (X-Telegram-Bot-Api-Secret-Token)· δεκτά μόνο μηνύματα από την ομάδα του πελάτη (tenants.tg_chat).
import type { ShopEnv } from './shop.ts';
import { sha256Hex, clean, nowIso, json, norm } from './util.ts';

export const TAKEOVER_MIN = 15;
export const LIVE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tg_map (tenant TEXT NOT NULL, chat TEXT NOT NULL, msg INTEGER NOT NULL, sid TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (chat, msg))`,
  `CREATE TABLE IF NOT EXISTS live_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, sid TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_live ON live_msgs (tenant, sid, id)`,
  `CREATE TABLE IF NOT EXISTS takeover (tenant TEXT NOT NULL, sid TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY (tenant, sid))`,
  `CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL)`,
];
let ready = false;
export async function ensureLive(env: ShopEnv) { if (ready) return; for (const q of LIVE_SCHEMA) await env.DB.prepare(q).run(); ready = true; }

// Μυστικό του webhook: παράγεται από το ADMIN_TOKEN (δεν χρειάζεται νέο secret).
export const hookSecret = async (env: ShopEnv) => (await sha256Hex(`tg-webhook|${env.ADMIN_TOKEN || ''}`)).slice(0, 40);

const tg = async (env: ShopEnv, method: string, body: unknown) => {
  try { const r = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }); return await r.json().catch(() => ({})); } catch { return {}; }
};

export async function mapMsg(env: ShopEnv, t: any, msgId: number | null, sid: string) {
  if (!msgId) return; await ensureLive(env);
  await env.DB.prepare('INSERT OR REPLACE INTO tg_map (tenant, chat, msg, sid, at) VALUES (?, ?, ?, ?, ?)').bind(t.id, String(t.tg_chat), msgId, sid, nowIso()).run();
}
export async function humanActive(env: ShopEnv, t: any, sid: string, now = Date.now()) {
  await ensureLive(env);
  const r: any = await env.DB.prepare('SELECT until FROM takeover WHERE tenant = ? AND sid = ?').bind(t.id, sid).first();
  return !!r && r.until > now;
}
export async function notesText(env: ShopEnv, t: any) {
  await ensureLive(env);
  const rows: any[] = (await env.DB.prepare('SELECT text, at FROM notes WHERE tenant = ? ORDER BY id DESC LIMIT 20').bind(t.id).all()).results || [];
  if (!rows.length) return '';
  return `ΝΕΑ ΣΤΟΙΧΕΙΑ ΑΠΟ ΤΟ ΚΑΤΑΣΤΗΜΑ (τα πιο πρόσφατα, υπερισχύουν όλων των άλλων):\n${rows.map((r) => `- ${r.text}`).join('\n')}`;
}
export async function poll(env: ShopEnv, t: any, sid: string, after: number) {
  await ensureLive(env);
  const rows: any[] = (await env.DB.prepare('SELECT id, text, at FROM live_msgs WHERE tenant = ? AND sid = ? AND id > ? ORDER BY id LIMIT 20').bind(t.id, sid, after).all()).results || [];
  return { msgs: rows, human: await humanActive(env, t, sid) };
}

const cmdRe = /^\/naria(?:@\w+)?(?:\s+([\s\S]*))?$/i;
export async function handleTelegram(req: Request, env: ShopEnv): Promise<Response> {
  const ok = () => json({ ok: true });
  if ((req.headers.get('x-telegram-bot-api-secret-token') || '') !== (await hookSecret(env))) return json({ error: 'unauthorized' }, 401);
  const u: any = await req.json().catch(() => null);
  const m = u?.message; if (!m?.chat?.id || typeof m.text !== 'string') return ok();
  const t: any = await env.DB.prepare('SELECT * FROM tenants WHERE tg_chat = ? AND status = ?').bind(String(m.chat.id), 'active').first();
  if (!t) return ok();
  await ensureLive(env);
  const say = (text: string) => tg(env, 'sendMessage', { chat_id: String(m.chat.id), text, reply_to_message_id: m.message_id, disable_web_page_preview: true });
  const who = clean(m.from?.first_name || 'Ομάδα', 40);
  const replyTo = m.reply_to_message?.message_id;
  const mapped: any = replyTo ? await env.DB.prepare('SELECT sid FROM tg_map WHERE chat = ? AND msg = ?').bind(String(m.chat.id), replyTo).first() : null;
  const cm = m.text.trim().match(cmdRe);

  if (cm) {
    const arg = clean(cm[1] || '', 600);
    const k = norm(arg);
    if (/^(συνεχ|resume)/.test(k)) {
      if (!mapped) { await say('Κάνε reply σε μήνυμα της συζήτησης που θέλεις να συνεχίσει η Naria.'); return ok(); }
      await env.DB.prepare('DELETE FROM takeover WHERE tenant = ? AND sid = ?').bind(t.id, mapped.sid).run();
      await say('🤖 Η Naria συνεχίζει τη συζήτηση.'); return ok();
    }
    if (!arg || /^(λιστα|list|help|βοηθ)/.test(k)) {
      const rows: any[] = (await env.DB.prepare('SELECT id, text FROM notes WHERE tenant = ? ORDER BY id').bind(t.id).all()).results || [];
      await say(rows.length ? `📝 Όσα ξέρει η Naria από εσάς:\n${rows.map((r, i) => `${i + 1}. ${r.text}`).join('\n')}\n\nΣβήσιμο: /naria σβήσε <αριθμός>` : '📝 Δεν υπάρχουν σημειώσεις.\nΠρόσθεσε με: /naria <κείμενο>\nπ.χ. /naria Black Friday -20% σε όλα έως 30/11');
      return ok();
    }
    const del = k.match(/^(σβησε|διαγραφη|delete|del)\s+(\d{1,3})$/);
    if (del) {
      const rows: any[] = (await env.DB.prepare('SELECT id, text FROM notes WHERE tenant = ? ORDER BY id').bind(t.id).all()).results || [];
      const x = rows[+del[2] - 1];
      if (!x) { await say('Δεν βρέθηκε αυτός ο αριθμός. Δες τη λίστα με /naria λίστα'); return ok(); }
      await env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(x.id).run();
      await say(`🗑️ Σβήστηκε: ${x.text}`); return ok();
    }
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM notes WHERE tenant = ?').bind(t.id).first())?.n || 0;
    if (n >= 20) { await say('Υπάρχουν ήδη 20 σημειώσεις. Σβήσε κάποια πρώτα (/naria λίστα).'); return ok(); }
    await env.DB.prepare('INSERT INTO notes (tenant, text, at) VALUES (?, ?, ?)').bind(t.id, arg.slice(0, 300), nowIso()).run();
    await say('✅ Το έμαθα. Θα το λέω στους πελάτες από τώρα.'); return ok();
  }

  // Ζωντανή απάντηση: reply σε μήνυμα συζήτησης
  if (mapped) {
    const text = clean(m.text, 1500); if (!text) return ok();
    const now = Date.now();
    await env.DB.prepare('INSERT INTO live_msgs (tenant, sid, text, at) VALUES (?, ?, ?, ?)').bind(t.id, mapped.sid, `${who}: ${text}`, nowIso(now)).run();
    await env.DB.prepare('INSERT INTO takeover (tenant, sid, until) VALUES (?, ?, ?) ON CONFLICT(tenant, sid) DO UPDATE SET until = excluded.until').bind(t.id, mapped.sid, now + TAKEOVER_MIN * 60_000).run();
    await env.DB.prepare('INSERT INTO messages (tenant, sid, role, text, at) VALUES (?, ?, ?, ?, ?)').bind(t.id, mapped.sid, 'human', `${who}: ${text}`, nowIso(now)).run().catch(() => {});
    await tg(env, 'setMessageReaction', { chat_id: String(m.chat.id), message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] });
  }
  return ok();
}

// Σύνδεση του bot με τον Worker (μία φορά): webhook + λίστα εντολών.
export async function setupWebhook(env: ShopEnv, publicUrl: string) {
  if (!env.TG_BOT_TOKEN) return { ok: false, error: 'no_bot_token' };
  const url = `${publicUrl.replace(/\/$/, '')}/tg/hook`;
  const a: any = await tg(env, 'setWebhook', { url, secret_token: await hookSecret(env), allowed_updates: ['message'], drop_pending_updates: false });
  const b: any = await tg(env, 'setMyCommands', { commands: [{ command: 'naria', description: 'Μάθε κάτι στη Naria · λίστα · σβήσε N · συνέχισε' }] });
  return { ok: !!a.ok, webhook: a.description || null, commands: !!b.ok, url };
}
