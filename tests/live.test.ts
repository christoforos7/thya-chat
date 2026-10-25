import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { hookSecret } from '../src/live.ts';
import { makeDB } from './d1.ts';

const ADMIN = 'a'.repeat(30);
const SITE = 'https://shop.example.gr';
const GROUP = '-1001234567';
let env: any, tg: any[], aiCalls: any[], nextId: number;
const ctx = { waitUntil: (p: Promise<unknown>) => p };
const realFetch = globalThis.fetch;
beforeEach(() => {
  tg = []; aiCalls = []; nextId = 100;
  env = { DB: makeDB(), ADMIN_TOKEN: ADMIN, IP_SALT: 's', NEURON_CAP: '9000', TG_BOT_TOKEN: 'T',
    AI: { run: async (_m: string, input: any) => { aiCalls.push(input); return { response: 'Απάντηση Naria', usage: { prompt_tokens: 10, completion_tokens: 5 } }; } } };
  globalThis.fetch = (async (u: any, init?: any) => {
    const url = String(u);
    if (url.startsWith('https://api.telegram.org/botT/')) { const method = url.split('/').pop(); const body = init?.body ? JSON.parse(init.body) : {}; tg.push({ method, body }); return new Response(JSON.stringify({ ok: true, result: method === 'sendMessage' ? { message_id: nextId++ } : true })); }
    return new Response('nf', { status: 404 });
  }) as any;
});
test.after(() => { globalThis.fetch = realFetch; });

const call = (path: string, init: any = {}) => worker.fetch(new Request('https://chat.test' + path, init), env, ctx);
const admin = (path: string, body?: any) => call(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const chat = (key: string, text: string, sid = 'visitor1') => call(`/v1/t/${key}/chat`, { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1' }, body: JSON.stringify({ sid, messages: [{ role: 'user', content: text }] }) });
const pollReq = (key: string, sid = 'visitor1', after = 0) => call(`/v1/t/${key}/poll?sid=${sid}&after=${after}`, { headers: { origin: SITE } });
const hook = async (message: any, secret?: string) => call('/tg/hook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret ?? await hookSecret(env) }, body: JSON.stringify({ update_id: 1, message }) });
const msg = (text: string, replyTo?: number, chat = GROUP) => ({ message_id: 900 + Math.floor(Math.random() * 99), chat: { id: Number(chat), type: 'supergroup' }, from: { first_name: 'Κατερίνα' }, text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) });

async function setup() {
  const r: any = await (await admin('/admin/tenants', { id: 'shop', name: 'Shop', origins: [SITE], tg_chat: GROUP })).json();
  return r.tenant.site_key as string;
}

test('webhook: λάθος μυστικό → 401· άλλη ομάδα → αγνοείται', async () => {
  await setup();
  assert.equal((await hook(msg('/naria test'), 'wrong')).status, 401);
  await hook(msg('/naria κάτι', undefined, '-999'));
  assert.equal(tg.length, 0);
});

test('ζωντανή απάντηση: reply στο μήνυμα της συζήτησης → φτάνει στον επισκέπτη· η Naria σιωπά· «συνέχισε» την επαναφέρει', async () => {
  const key = await setup();
  await chat(key, 'Έχετε το Aira σε χρυσό;');
  const sent = tg.find((x) => x.method === 'sendMessage'); assert.ok(sent);
  const turnMsgId = 100;
  await hook(msg('Καλησπέρα! Ναι, έρχεται την Πέμπτη 🙂', turnMsgId));
  assert.ok(tg.some((x) => x.method === 'setMessageReaction'));
  const p: any = await (await pollReq(key)).json();
  assert.equal(p.msgs.length, 1); assert.equal(p.msgs[0].text, 'Κατερίνα: Καλησπέρα! Ναι, έρχεται την Πέμπτη 🙂'); assert.equal(p.human, true);
  // ο επισκέπτης γράφει ξανά: χωρίς AI, πάει στην ομάδα με δυνατότητα reply
  const before = aiCalls.length;
  const r: any = await (await chat(key, 'Τέλεια, να το κρατήσετε;')).json();
  assert.equal(r.live, true); assert.equal(r.reply, null); assert.equal(aiCalls.length, before);
  const live = tg.filter((x) => x.method === 'sendMessage').pop(); assert.match(live.body.text, /ζωντανά[\s\S]*να το κρατήσετε/);
  // poll μετά το τελευταίο id → τίποτα νέο
  assert.equal(((await (await pollReq(key, 'visitor1', p.msgs[0].id)).json()) as any).msgs.length, 0);
  // «συνέχισε» ως reply → η Naria ξαναπαίρνει
  await hook(msg('/naria συνέχισε', turnMsgId));
  const r2: any = await (await chat(key, 'Και σε ασημί;')).json();
  assert.equal(r2.reply, 'Απάντηση Naria');
});

test('άλλος επισκέπτης δεν βλέπει τα μηνύματα· η σίγαση λήγει μετά από 15\'', async () => {
  const key = await setup();
  await chat(key, 'γεια', 'visitorA');
  await hook(msg('Γεια σας!', 100));
  assert.equal(((await (await pollReq(key, 'visitorB')).json()) as any).msgs.length, 0);
  env.DB.raw.prepare('UPDATE takeover SET until = ?').run(Date.now() - 1000);
  const r: any = await (await chat(key, 'είστε εκεί;', 'visitorA')).json();
  assert.equal(r.reply, 'Απάντηση Naria');
});

test('/naria: σημειώσεις → μπαίνουν αμέσως στις οδηγίες· λίστα και σβήσιμο', async () => {
  const key = await setup();
  await hook(msg('/naria Black Friday -20% σε όλα έως 30/11'));
  assert.match(tg.pop().body.text, /Το έμαθα/);
  await hook(msg('/naria@NariaThyaBot Κλειστά 24–26/12'));
  await chat(key, 'έχετε προσφορές;');
  const sys = aiCalls.at(-1).messages[0].content as string;
  assert.match(sys, /ΝΕΑ ΣΤΟΙΧΕΙΑ ΑΠΟ ΤΟ ΚΑΤΑΣΤΗΜΑ[\s\S]*Κλειστά 24–26\/12[\s\S]*Black Friday -20%/);
  await hook(msg('/naria λίστα'));
  assert.match(tg.filter((x) => x.method === 'sendMessage').pop().body.text, /1\. Black Friday[\s\S]*2\. Κλειστά/);
  await hook(msg('/naria σβήσε 1'));
  assert.match(tg.filter((x) => x.method === 'sendMessage').pop().body.text, /Σβήστηκε: Black Friday/);
  await chat(key, 'προσφορές;');
  assert.doesNotMatch(aiCalls.at(-1).messages[0].content, /Black Friday/);
});

test('σύνδεση webhook από τη διαχείριση', async () => {
  await setup();
  const r: any = await (await admin('/admin/tg-webhook', {})).json();
  assert.equal(r.ok, true); assert.equal(r.url, 'https://chat.test/tg/hook');
  const sw = tg.find((x) => x.method === 'setWebhook'); assert.equal(sw.body.secret_token, await hookSecret(env));
  assert.ok(tg.some((x) => x.method === 'setMyCommands'));
});

test('ομάδα: η φωτογραφία της Kelly σερβίρεται και περνά στις ρυθμίσεις του widget', async () => {
  const key = await setup();
  await admin('/admin/tenants', { id: 'shop', brand: { name: 'Naria', team: [{ names: ['Kelly', 'Κέλλυ'], display: 'Kelly', avatar: '/a/kelly.webp' }] } });
  const cfg: any = await (await call(`/v1/t/${key}/config`, { headers: { origin: SITE } })).json();
  assert.deepEqual(cfg.team, [{ names: ['Kelly', 'Κέλλυ'], display: 'Kelly', avatar: 'https://chat.test/a/kelly.webp' }]);
  const a = await call('/a/kelly.webp'); assert.equal(a.status, 200);
});
