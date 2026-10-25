import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { crawlStep, enqueueTenant } from '../src/kb.ts';
import { makeDB } from './d1.ts';

const ADMIN = 'a'.repeat(30);
let env: any, aiCalls: any[], hooks: any[], site: Record<string, { status?: number; body: string; type?: string }>;
const ctx = { waitUntil: (p: Promise<unknown>) => p };
const realFetch = globalThis.fetch;
beforeEach(() => {
  aiCalls = []; hooks = []; site = {};
  env = { DB: makeDB(), ADMIN_TOKEN: ADMIN, IP_SALT: 's', NEURON_CAP: '9000', AI: { run: async (model: string, input: any) => { aiCalls.push({ model, input }); return { response: 'Έχουμε δωμάτια με τζάκι: https://www.x.gr/rooms — δες και https://evil.com/x', usage: { prompt_tokens: 2000, completion_tokens: 60 } }; } } };
  globalThis.fetch = (async (u: any, init?: any) => {
    const url = String(u);
    if (url.startsWith('https://hooks.example/')) { hooks.push(JSON.parse(init.body)); return new Response('ok'); }
    const p = site[url]; if (!p) return new Response('nf', { status: 404 });
    return new Response(p.body, { status: p.status || 200, headers: { 'content-type': p.type || 'text/html; charset=utf-8' } });
  }) as any;
});
const call = (path: string, init: any = {}) => worker.fetch(new Request('https://chat.test' + path, init), env, ctx);
const admin = (path: string, body?: any) => call(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const chat = (key: string, text: string, origin = 'https://www.x.gr', ip = '1.1.1.1') => call(`/v1/t/${key}/chat`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ sid: 'abc', messages: [{ role: 'user', content: text }] }) });

async function setup() {
  const r = await admin('/admin/tenants', { id: 'xhotel', name: 'Ξενοδοχείο Χ', origins: ['https://www.x.gr'], brand: { color: '#123456', chips: ['Τιμές;'] }, lead_webhook: 'https://hooks.example/1' });
  const j: any = await r.json(); assert.equal(r.status, 200); return j.tenant.site_key as string;
}

test.after(() => { globalThis.fetch = realFetch; });

test('διαχείριση: χωρίς σωστό token → 401· με token → νέος πελάτης με δημόσιο κλειδί', async () => {
  assert.equal((await call('/admin/tenants', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const key = await setup(); assert.match(key, /^pk_[a-z0-9]{24}$/);
  const inst: any = await (await admin('/admin/tenants/xhotel/install')).json();
  assert.ok(inst.snippet.includes(key) && inst.snippet.includes('/w.js'));
  const bad = await admin('/admin/tenants', { id: 'Bad Id', name: 'x', origins: ['https://a.gr'] }); assert.equal(bad.status, 400);
  const badStart = await admin('/admin/tenants', { id: 'y1', name: 'Y', origins: ['https://y.gr'], start_url: 'https://evil.com/' }); assert.equal(badStart.status, 400);
});

test('widget & config: μόνο από επιτρεπόμενο origin', async () => {
  const key = await setup();
  assert.equal((await call('/w.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  const ok = await call(`/v1/t/${key}/config`, { headers: { origin: 'https://www.x.gr' } });
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://www.x.gr');
  const cfg: any = await ok.json(); assert.equal(cfg.color, '#123456'); assert.deepEqual(cfg.chips, ['Τιμές;']); assert.equal(cfg.powered, null);
  assert.equal((await call(`/v1/t/${key}/config`, { headers: { origin: 'https://evil.com' } })).status, 403);
  assert.equal((await call(`/v1/t/pk_wrongwrongwrong/config`, { headers: { origin: 'https://www.x.gr' } })).status, 403);
  assert.equal((await chat(key, 'γεια', 'https://evil.com')).status, 403);
});

test('συζήτηση: γνώση από έγγραφο, φίλτρο συνδέσμων, καταγραφή, μετρητής neurons', async () => {
  const key = await setup();
  const d = await admin('/admin/tenants/xhotel/doc', { title: 'Δωμάτια', text: 'Τα δωμάτιά μας έχουν τζάκι και θέα στο βουνό. Πρωινό σερβίρεται 8:00–10:30. ' .repeat(3) });
  assert.equal(d.status, 200);
  const r = await chat(key, 'Έχετε δωμάτιο με τζάκι;'); const j: any = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.reply.includes('https://www.x.gr/rooms') && !j.reply.includes('evil.com'));
  const sys = aiCalls[0].input.messages[0].content;
  assert.ok(sys.includes('τζάκι') && sys.includes('ΠΗΓΕΣ') && sys.includes('Ξενοδοχείο Χ'));
  assert.equal(aiCalls[0].model, '@cf/google/gemma-4-26b-a4b-it');
  const u = env.DB.raw.prepare("SELECT replies, neurons FROM usage_daily WHERE tenant = 'xhotel'").get();
  assert.equal(u.replies, 1); assert.ok(u.neurons > 15 && u.neurons < 25);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM messages WHERE tenant = 'xhotel'").get().n, 2);
  assert.ok(!JSON.stringify(env.DB.raw.prepare('SELECT * FROM convos').all()).includes('1.1.1.1')); // ποτέ ολόκληρη IP
});

test('lead: τηλέφωνο μέσα στη συζήτηση και φόρμα με συγκατάθεση → webhook', async () => {
  const key = await setup();
  await chat(key, 'Θέλω κράτηση, καλέστε με στο 6941234567');
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM leads WHERE source = 'chat'").get().n, 1);
  assert.ok(hooks[0].text.includes('6941234567'));
  const post = (b: any) => call(`/v1/t/${key}/lead`, { method: 'POST', headers: { origin: 'https://www.x.gr', 'content-type': 'application/json', 'cf-connecting-ip': '2.2.2.2' }, body: JSON.stringify(b) });
  assert.equal((await post({ name: 'Μαρία', email: 'm@x.gr' })).status, 400); // χωρίς συγκατάθεση
  assert.equal((await post({ name: 'Μαρία', email: 'm@x.gr', consent: true })).status, 200);
  assert.equal(env.DB.raw.prepare("SELECT notified FROM leads WHERE source = 'form'").get().notified, 1);
});

test('όρια: ανά IP/ώρα και συνολικό δωρεάν όριο neurons', async () => {
  const key = await setup();
  for (let i = 0; i < 25; i++) assert.equal((await chat(key, 'γεια ' + i)).status, 200);
  assert.equal((await chat(key, 'κι άλλο')).status, 429);
  env.NEURON_CAP = '1'; // ξεπεράστηκε το ημερήσιο όριο
  const r: any = await (await chat(key, 'γεια', 'https://www.x.gr', '9.9.9.9')).json();
  assert.equal(r.limited, true);
  assert.equal(aiCalls.length, 25);
});

test('εκπαίδευση από το site: sitemap → σελίδες → γνώση· 404 σβήνει τη σελίδα', async () => {
  await setup();
  site['https://www.x.gr/sitemap.xml'] = { body: '<urlset><url><loc>https://www.x.gr/</loc></url><url><loc>https://www.x.gr/rooms</loc></url></urlset>', type: 'application/xml' };
  site['https://www.x.gr/'] = { body: '<title>Αρχική</title><main><p>Καλώς ήρθατε στο ξενοδοχείο μας στα Καλάβρυτα, δίπλα στο χιονοδρομικό κέντρο.</p></main>' };
  site['https://www.x.gr/rooms'] = { body: '<title>Δωμάτια</title><main><p>Δίκλινα και τετράκλινα δωμάτια με τζάκι, μπαλκόνι και θέα στο Χελμό.</p></main>' };
  const t = env.DB.raw.prepare("SELECT * FROM tenants WHERE id = 'xhotel'").get();
  assert.equal(await enqueueTenant(env, t), 2);
  assert.equal(await crawlStep(env, 8), 2);
  const tt = env.DB.raw.prepare("SELECT crawled_at, crawl_note FROM tenants WHERE id = 'xhotel'").get();
  assert.ok(tt.crawled_at && tt.crawl_note.startsWith('έτοιμο: 2 σελίδες'));
  const hit = env.DB.raw.prepare("SELECT c.url FROM chunks_fts f JOIN chunks c ON c.id = f.id WHERE chunks_fts MATCH 'τζακ*'").all();
  assert.deepEqual(hit.map((x: any) => x.url), ['https://www.x.gr/rooms']);
  delete site['https://www.x.gr/rooms'];
  await enqueueTenant(env, t); await crawlStep(env, 8);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM chunks WHERE url = 'https://www.x.gr/rooms'").get().n, 0);
});

test('Claude Haiku για όσους πληρώνουν: κόστος ανά απάντηση, εφεδρεία σε σφάλμα, δοκιμές στο δωρεάν', async () => {
  const key = await setup();
  await admin('/admin/tenants', { id: 'xhotel', plan: 'pro' });
  env.ANTHROPIC_API_KEY = 'test-key'; let claudeCalls: any[] = []; let fail = false;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async (u: any, init?: any) => {
    if (String(u) === 'https://api.anthropic.com/v1/messages') { claudeCalls.push(JSON.parse(init.body)); if (fail) return new Response('{}', { status: 529 }); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Ναι, έχουμε δωμάτια με τζάκι.' }], usage: { input_tokens: 4000, output_tokens: 250 } })); }
    return prevFetch(u, init);
  }) as any;
  let r: any = await (await chat(key, 'τζάκι;')).json();
  assert.equal(r.reply, 'Ναι, έχουμε δωμάτια με τζάκι.'); assert.equal(claudeCalls[0].model, 'claude-haiku-5-5'); assert.equal(aiCalls.length, 0);
  const u = env.DB.raw.prepare("SELECT cost_usd, neurons FROM usage_daily WHERE tenant = 'xhotel'").get();
  assert.ok(Math.abs(u.cost_usd - 0.000525) < 1e-9); assert.equal(u.neurons, 0);
  assert.equal(env.DB.raw.prepare("SELECT model FROM messages WHERE role = 'assistant'").get().model, 'claude-haiku-5-5');
  fail = true; r = await (await chat(key, 'και πρωινό;', 'https://www.x.gr', '3.3.3.3')).json();
  assert.ok(r.reply.includes('τζάκι')); assert.equal(aiCalls.length, 1); // εφεδρεία Workers AI
  fail = false; await admin('/admin/tenants', { id: 'xhotel', model: 'sonnet' });
  await chat(key, 'γεια', 'https://www.x.gr', '4.4.4.4'); assert.equal(claudeCalls.at(-1).model, 'claude-sonnet-5-5');
  await admin('/admin/tenants', { id: 'xhotel', plan: 'trial', model: null }); const before = claudeCalls.length;
  await chat(key, 'γεια', 'https://www.x.gr', '5.5.5.5'); assert.equal(claudeCalls.length, before); // δοκιμή → δωρεάν μοντέλο
  env.CLAUDE_MONTHLY_USD = '0.0000001'; await admin('/admin/tenants', { id: 'xhotel', plan: 'pro' });
  await chat(key, 'γεια', 'https://www.x.gr', '6.6.6.6'); assert.equal(claudeCalls.length, before); // όριο δαπάνης → δωρεάν μοντέλο
  const us: any = await (await admin('/admin/usage')).json(); assert.ok(us.claude_month_usd > 0 && 'claude_cap_usd' in us);
  globalThis.fetch = prevFetch;
});
