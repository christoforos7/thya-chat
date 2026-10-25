// Κοινά βοηθητικά: χρόνος, κανονικοποίηση κειμένου, hash, έλεγχος origin, ασφαλείς απαντήσεις.

export const nowIso = (ms = Date.now()) => new Date(ms).toISOString();
export const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// Αφαιρεί χαρακτήρες ελέγχου και κόβει σε μέγιστο μήκος.
export const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim().slice(0, n);

// Πεζά, χωρίς τόνους/διαλυτικά, τελικό σίγμα → σ (για αναζήτηση λέξεων στα ελληνικά).
export const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ');

export async function sha256Hex(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Σύγκριση μυστικών χωρίς διαρροή χρόνου.
export function safeEqual(a: string, b: string) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function parseList(s: unknown): string[] { try { const a = JSON.parse(String(s || '[]')); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } }
export function parseObj(s: unknown): Record<string, any> { try { const o = JSON.parse(String(s || '{}')); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } }

// Κανονική μορφή origin (scheme://host[:port]) — μόνο https (ή http://localhost για δοκιμές).
export function normOrigin(u: string): string | null {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:' || (x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1'))) return `${x.protocol}//${x.host}`.toLowerCase();
  } catch { /* */ }
  return null;
}
export function originAllowed(origin: string | null, allowed: string[]) {
  const o = origin ? normOrigin(origin) : null;
  return !!o && allowed.map((a) => normOrigin(a)).includes(o);
}

export const SEC_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-resource-policy': 'cross-origin',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEC_HEADERS, ...extra } });
}
export const cors = (origin: string) => ({ 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' });

// Τυχαίο αναγνωριστικό (base32 χωρίς μπερδεμένους χαρακτήρες).
export function randomId(n = 20) {
  const A = '23456789abcdefghjkmnpqrstuvwxyz'; const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => A[x % A.length]).join('');
}

// Email / τηλέφωνο μέσα σε ελεύθερο κείμενο.
export const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}/;
export const PHONE_RE = /(?:\+?\d[\d\s().-]{8,16}\d)/;
export function findContact(s: string) {
  const email = (s.match(EMAIL_RE) || [])[0] || '';
  const ph = (s.match(PHONE_RE) || [])[0] || '';
  const phone = ph.replace(/\D/g, '').length >= 10 ? ph.trim() : '';
  return { email, phone };
}
