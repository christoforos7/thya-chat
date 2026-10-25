// Ποιο μοντέλο απαντά. ΕΣΩΤΕΡΙΚΟ — δεν αναφέρεται ποτέ δημόσια (site, widget, απαντήσεις).
// - Πελάτες που πληρώνουν: Claude Haiku 5.5 (Anthropic API), αν υπάρχει ANTHROPIC_API_KEY και δεν ξεπεράστηκε το μηνιαίο όριο δαπάνης.
// - Δοκιμές (plan 'trial'), χωρίς κλειδί, πάνω από το όριο ή σε σφάλμα: Workers AI (δωρεάν ημερήσιο όριο).
// - tenants.model = 'sonnet' → Claude Sonnet 5.5 (πρόσθετη χρέωση στον πελάτη).
import type { Env } from './kb.ts';

export const CLAUDE = {
  haiku: { id: 'claude-haiku-5-5', in: 0.10, out: 0.50 },   // $ ανά εκατ. tokens (prompts ≤ 100k)
  sonnet: { id: 'claude-sonnet-5-5', in: 2, out: 10 },
} as const;
export const WAI_MODEL = (env: Env) => env.CHAT_MODEL || '@cf/google/gemma-4-26b-a4b-it';

export type Answer = { text: string; tin: number; tout: number; provider: 'claude' | 'workers-ai'; model: string; costUsd: number; err?: string };

// Απάντηση Workers AI: παλιά μορφή {response} ή OpenAI-style {choices}.
export function aiText(r: any): { text: string; tin: number; tout: number } {
  const text = typeof r?.response === 'string' ? r.response : r?.choices?.[0]?.message?.content ?? '';
  const u = r?.usage || {};
  return { text: String(text || '').trim(), tin: +u.prompt_tokens || 0, tout: +u.completion_tokens || 0 };
}

export async function monthSpend(env: Env, now = Date.now()) {
  const m = new Date(now).toISOString().slice(0, 7);
  return (await env.DB.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage_daily WHERE day LIKE ?').bind(m + '%').first())?.c || 0;
}

export async function pickProvider(env: Env, t: any, now = Date.now()): Promise<'claude' | 'workers-ai'> {
  if (!env.ANTHROPIC_API_KEY || t.plan === 'trial') return 'workers-ai';
  const cap = +(env.CLAUDE_MONTHLY_USD || 30);
  return (await monthSpend(env, now)) < cap ? 'claude' : 'workers-ai';
}

async function claude(env: Env, t: any, sys: string, msgs: { role: string; content: string }[]): Promise<Answer> {
  const m = t.model === 'sonnet' ? CLAUDE.sonnet : CLAUDE.haiku;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY as string, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || m.id, max_tokens: 450, temperature: 0.3, system: sys, messages: msgs }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`claude_${r.status}`);
  const j: any = await r.json();
  const text = (Array.isArray(j.content) ? j.content : []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
  const tin = +j?.usage?.input_tokens || 0, tout = +j?.usage?.output_tokens || 0;
  return { text, tin, tout, provider: 'claude', model: m.id, costUsd: (tin * m.in + tout * m.out) / 1e6 };
}

async function workersAi(env: Env, sys: string, msgs: { role: string; content: string }[]): Promise<Answer> {
  const r = await env.AI.run(WAI_MODEL(env), { messages: [{ role: 'system', content: sys }, ...msgs], max_tokens: 450, temperature: 0.3 });
  const { text, tin, tout } = aiText(r);
  return { text, tin, tout, provider: 'workers-ai', model: WAI_MODEL(env), costUsd: 0 };
}

// Πρώτα ο επιλεγμένος πάροχος· αν αποτύχει, ο άλλος (ώστε ο επισκέπτης να παίρνει πάντα απάντηση).
export async function answer(env: Env, t: any, sys: string, msgs: { role: string; content: string }[], now = Date.now()): Promise<Answer> {
  const first = await pickProvider(env, t, now);
  try {
    const a = first === 'claude' ? await claude(env, t, sys, msgs) : await workersAi(env, sys, msgs);
    if (a.text) return a;
    throw new Error('empty');
  } catch (e: any) {
    const err = String(e?.message || e).slice(0, 120);
    try {
      const b = first === 'claude' ? await workersAi(env, sys, msgs) : env.ANTHROPIC_API_KEY && t.plan !== 'trial' ? await claude(env, t, sys, msgs) : null;
      if (b) return { ...b, err };
    } catch (e2: any) { return { text: '', tin: 0, tout: 0, provider: first, model: '', costUsd: 0, err: `${err}; ${String(e2?.message || e2).slice(0, 80)}` }; }
    return { text: '', tin: 0, tout: 0, provider: first, model: '', costUsd: 0, err };
  }
}
