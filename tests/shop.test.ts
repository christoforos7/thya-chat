import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { productRow, detectOrder } from '../src/shop.ts';
import { makeDB } from './d1.ts';

const ADMIN = 'a'.repeat(30);
const BASE = 'https://shop.example.gr';
let env: any, aiCalls: any[], tg: any[], wcCalls: string[];
const ctx = { waitUntil: (p: Promise<unknown>) => p };
const realFetch = globalThis.fetch;
const P = (id: number, name: string, price: string, extra: any = {}) => ({ id, name, permalink: `${BASE}/product/p${id}/`, on_sale: false, is_in_stock: true, short_description: '<p>Χειροποίητο κόσμημα</p>', categories: [{ name: extra.cat || 'Δαχτυλίδια' }], prices: { price, regular_price: price, currency_minor_unit: 2, currency_symbol: '€', ...(extra.prices || {}) }, ...extra });
const CATALOG = [P(1, 'Aira Silver ασημένιο δαχτυλίδι', '2100'), P(2, 'Aero Wing σκουλαρίκια', '3500', { cat: 'Σκουλαρίκια', on_sale: true, prices: { price: '2800', regular_price: '3500', currency_minor_unit: 2, currency_symbol: '€' } }), P(3, 'Luna χρυσό κολιέ', '4900', { cat: 'Κολιέ', is_in_stock: false })];
const ORDER = { id: 1234, status: 'processing', date_created: '2026-10-20T10:00:00', billing: { email: 'Maria@Example.com', phone: '6900000000', address_1: 'Οδός 1' }, shipping: { address_1: 'Οδός 1' }, line_items: [{ name: 'Aira Silver', quantity: 1 }], shipping_lines: [{ method_title: 'ACS Courier' }], meta_data: [{ key: '_acs_voucher', value: '7200123456' }, { key: '_secret_note', value: 'x' }], payment_method_title: 'Κάρτα' };

beforeEach(() => {
  aiCalls = []; tg = []; wcCalls = [];
  env = { DB: makeDB(), ADMIN_TOKEN: ADMIN, IP_SALT: 's', NEURON_CAP: '9000', TG_BOT_TOKEN: 'T', WC_KEY_SHOP: 'ck_x', WC_SECRET_SHOP: 'cs_x',
    AI: { run: async (model: string, input: any) => { aiCalls.push({ model, input }); return { response: 'Δείτε το Aira Silver: https://shop.example.gr/product/p1/', usage: { prompt_tokens: 100, completion_tokens: 20 } }; } } };
  globalThis.fetch = (async (u: any, init?: any) => {
    const url = String(u);
    if (url.startsWith('https://api.telegram.org/botT/sendMessage')) { tg.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
    if (url.startsWith('https://api.telegram.org/botT/getUpdates')) return new Response(JSON.stringify({ result: [{ my_chat_member: { chat: { id: -1001234567, type: 'supergroup', title: 'Thya chat' } } }] }));
    if (url.startsWith(`${BASE}/wp-json/wc/store/v1/products`)) { const pg = +new URL(url).searchParams.get('page')!; return new Response(JSON.stringify(pg === 1 ? CATALOG : []), { headers: { 'content-type': 'application/json' } }); }
    if (url.startsWith(`${BASE}/wp-json/wc/v3/orders/`)) { wcCalls.push(url); assert.match(init.headers.authorization, /^Basic /); return url.endsWith('/1234') ? new Response(JSON.stringify(ORDER)) : new Response('{"code":"woocommerce_rest_shop_order_invalid_id"}', { status: 404 }); }
    return new Response('nf', { status: 404 });
  }) as any;
});
test.after(() => { globalThis.fetch = realFetch; });

const call = (path: string, init: any = {}) => worker.fetch(new Request('https://chat.test' + path, init), env, ctx);
const admin = (path: string, body?: any) => call(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const chat = (key: string, msgs: string[], ip = '1.1.1.1') => call(`/v1/t/${key}/chat`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ sid: 'abc123', path: '/shop/', messages: msgs.map((content) => ({ role: 'user', content })) }) });
const sysOf = (i = -1) => aiCalls.at(i).input.messages[0].content as string;

async function setup(orders = true) {
  const r: any = await (await admin('/admin/tenants', { id: 'shop', name: 'Shop', origins: [BASE] })).json();
  const u = await admin('/admin/tenants', { id: 'shop', shop: { type: 'woocommerce', base: BASE }, tg_chat: '-1001234567' }); assert.equal(u.status, 200);
  const s: any = await (await admin('/admin/tenants/shop/shop-sync', {})).json(); assert.equal(s.ok, true); assert.equal(s.products, 3); assert.equal(s.orders, orders);
  return r.tenant.site_key as string;
}

test('τιμές και προσφορές από το Store API', () => {
  const x = productRow(CATALOG[1]); assert.match(x.price, /28,00 € \(αντί 35,00 €\)/); assert.equal(x.sale, 1);
  assert.equal(productRow(CATALOG[2]).in_stock, 0);
  assert.equal(detectOrder(['πού είναι η παραγγελία #1234; maria@example.com']).number, '1234');
  assert.equal(detectOrder(['Παραγγελία 5521']).number, '5521');
  assert.equal(detectOrder(['θέλω δαχτυλίδι']).asks, false);
});

test('διαχείριση: κατάστημα μόνο στο ίδιο domain, σωστό chat id, ομάδες του bot', async () => {
  await admin('/admin/tenants', { id: 'shop', name: 'Shop', origins: [BASE] });
  assert.equal((await admin('/admin/tenants', { id: 'shop', shop: { type: 'woocommerce', base: 'https://evil.com' } })).status, 400);
  assert.equal((await admin('/admin/tenants', { id: 'shop', tg_chat: 'abc' })).status, 400);
  const c: any = await (await admin('/admin/tg-chats')).json(); assert.equal(c.chats[0].id, '-1001234567');
  await admin('/admin/tenants', { id: 'shop', tg_chat: '-1001234567' });
  const t: any = await (await admin('/admin/tenants/shop/tg-test', {})).json(); assert.equal(t.ok, true); assert.equal(tg[0].chat_id, '-1001234567');
});

test('προτάσεις: τα σχετικά προϊόντα με τιμή/διαθεσιμότητα μπαίνουν στις πηγές· απάντηση και στο Telegram', async () => {
  const key = await setup();
  const r: any = await (await chat(key, ['ψάχνω ασημένιο δαχτυλίδι'])).json();
  assert.match(r.reply, /Aira Silver/);
  const sys = sysOf(); assert.match(sys, /Aira Silver ασημένιο δαχτυλίδι — 21,00 €/); assert.match(sys, /διαθέσιμο/); assert.match(sys, /Κατηγορίες: .*Σκουλαρίκια/);
  assert.equal(tg.length, 1); assert.match(tg[0].text, /👤 ψάχνω ασημένιο δαχτυλίδι/); assert.match(tg[0].text, /🤖 Δείτε/);
  await chat(key, ['έχετε προσφορές;']); assert.match(sysOf(), /Aero Wing.*ΠΡΟΣΦΟΡΑ/);
});

test('παραγγελία: αριθμός + σωστό email → κατάσταση και αριθμός αποστολής, χωρίς διεύθυνση/τηλέφωνο· δεν γίνεται lead', async () => {
  const key = await setup();
  await chat(key, ['Πού είναι η παραγγελία μου #1234;', 'maria@example.com']);
  const sys = sysOf();
  assert.match(sys, /Σε επεξεργασία/); assert.match(sys, /7200123456/); assert.match(sys, /ACS Courier/);
  assert.doesNotMatch(sys, /Οδός|6900000000|Κάρτα|_secret_note/);
  assert.equal((env.DB.raw.prepare('SELECT COUNT(*) n FROM leads').get() as any).n, 0);
  assert.match(tg.at(-1).text, /📦 παραγγελία/);
});

test('παραγγελία: λάθος email ή ανύπαρκτος αριθμός → ίδια απάντηση «δεν βρέθηκε», χωρίς στοιχεία', async () => {
  const key = await setup();
  await chat(key, ['παραγγελία #1234 other@example.com']);
  assert.match(sysOf(), /δεν βρέθηκε/); assert.doesNotMatch(sysOf(), /Σε επεξεργασία|7200123456/);
  await chat(key, ['παραγγελία #9999 maria@example.com']);
  assert.match(sysOf(), /δεν βρέθηκε/);
  await chat(key, ['πού είναι η παραγγελία μου;']);
  assert.match(sysOf(), /ΚΑΙ τον αριθμό παραγγελίας ΚΑΙ το email/);
});

test('παραγγελία: όριο ελέγχων ανά επισκέπτη (6/ώρα)', async () => {
  const key = await setup();
  for (let i = 0; i < 8; i++) await chat(key, [`παραγγελία #${2000 + i} a${i}@example.com`], '9.9.9.9');
  assert.equal(wcCalls.length, 6);
});

test('χωρίς κλειδιά παραγγελιών: παραπέμπει στα στοιχεία· τηλέφωνο στη συζήτηση → lead και ⭐ στο Telegram', async () => {
  delete env.WC_KEY_SHOP; const key = await setup(false);
  await chat(key, ['παραγγελία #1234 maria@example.com']);
  assert.match(sysOf(), /δεν έχεις πρόσβαση σε παραγγελίες/); assert.equal(wcCalls.length, 0);
  await chat(key, ['θέλω να με πάρετε τηλέφωνο 6912345678 για ειδική παραγγελία']);
  assert.equal((env.DB.raw.prepare('SELECT COUNT(*) n FROM leads').get() as any).n >= 1, true);
  assert.ok(tg.some((m) => m.text.startsWith('⭐')));
});

test('συντήρηση χωρίς cron: το πολύ μία φορά ανά 10 λεπτά· ανανεώνει τον κατάλογο όταν παλιώσει', async () => {
  const { maintenance } = await import('../src/index.ts');
  await setup();
  env.DB.raw.prepare("UPDATE tenants SET shop_synced = '2000-01-01T00:00:00Z'").run();
  assert.equal(await maintenance(env), true);
  assert.equal(await maintenance(env), false);
  assert.notEqual((env.DB.raw.prepare('SELECT shop_synced s FROM tenants').get() as any).s, '2000-01-01T00:00:00Z');
});
