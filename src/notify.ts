// Ειδοποίηση για νέο lead: webhook του πελάτη (Microsoft Teams / Slack / Make — μόνο https), κοινό κανάλι Telegram (tenants.tg_chat) και,
// προαιρετικά, ένα εσωτερικό webhook (NOTIFY_WEBHOOK). Ποτέ δεν ρίχνει την απάντηση αν αποτύχει.
import type { Env } from './kb.ts';
import { tgSend } from './shop.ts';

export type Lead = { id?: number; name: string; email: string; phone: string; note: string; source: string };

export function leadText(t: any, l: Lead) {
  return [`Νέο αίτημα από τον AI βοηθό του ${t.name}`, l.name && `Όνομα: ${l.name}`, l.phone && `Τηλέφωνο: ${l.phone}`, l.email && `Email: ${l.email}`, `Από: ${l.source}`, l.note && `\n${l.note.slice(0, 1200)}`].filter(Boolean).join('\n');
}
const okHook = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:'; } catch { return false; } };

export async function notifyLead(env: Env, t: any, l: Lead) {
  const text = leadText(t, l);
  const hooks = [t.lead_webhook, env.NOTIFY_WEBHOOK].filter((u) => u && okHook(u));
  let sent = false;
  for (const u of hooks) {
    try { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(8000) }); if (r.ok && u === t.lead_webhook) sent = true; } catch { /* */ }
  }
  if (await tgSend(env as any, t, `⭐ ${text}`)) sent = true;
  if (sent && l.id) await env.DB.prepare('UPDATE leads SET notified = 1 WHERE id = ?').bind(l.id).run().catch(() => {});
}
