// Από HTML σε καθαρό κείμενο, σύνδεσμοι, sitemap και κομμάτια (chunks) για τη γνώση του βοηθού.

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', euro: '€', middot: '·', ndash: '–', mdash: '—', hellip: '…' };
export const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
  return ENT[e.toLowerCase()] ?? m;
});

export function pageTitle(html: string) {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || '';
  return decode(t.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200);
}

// Κείμενο της σελίδας χωρίς scripts, styles, μενού και footer (εκεί είναι συνήθως επαναλαμβανόμενα πράγματα).
// Cloudflare Email Obfuscation: data-cfemail="<hex>" → το πραγματικό email (1ο byte = κλειδί XOR).
export function cfDecode(hex: string) {
  if (!/^[0-9a-f]{4,400}$/i.test(hex) || hex.length % 2) return '';
  const k = parseInt(hex.slice(0, 2), 16); let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
  return /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/.test(out) ? out : '';
}
const cfEmails = (h: string) => h
  .replace(/<a\b[^>]*data-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/a>/gi, (_m, x) => ` ${cfDecode(x)} `)
  .replace(/<span\b[^>]*data-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/span>/gi, (_m, x) => ` ${cfDecode(x)} `)
  .replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, (_m, x) => { const e = cfDecode(x); return e ? `mailto:${e}` : ''; });

export function htmlToText(html: string) {
  let s = cfEmails(html).replace(/<!--[\s\S]*?-->/g, ' ');
  for (const t of ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'nav', 'footer', 'form', 'select', 'head']) s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}>`, 'gi'), ' ');
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(s)?.[1];
  if (main && main.length > 400) s = main;
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, '\n').replace(/<li\b[^>]*>/gi, '\n• ').replace(/<[^>]+>/g, ' ');
  return decode(s).replace(/\[email[\s\u00a0]*protected\]/gi, '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

// Σύνδεσμοι της ίδιας τοποθεσίας (χωρίς #, χωρίς αρχεία).
const SKIP = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|webm|css|js|json|xml|txt)(\?|$)/i;
export function sameSiteLinks(html: string, base: string) {
  const b = new URL(base); const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)/gi)) {
    try {
      const u = new URL(decode(m[1]), b);
      if (u.host !== b.host || !/^https?:$/.test(u.protocol) || SKIP.test(u.pathname)) continue;
      if (/\/(wp-admin|wp-login|cart|checkout|my-account|login|logout|feed)\b/i.test(u.pathname)) continue;
      u.hash = ''; if ([...u.searchParams.keys()].some((k) => /^(utm_|fbclid|gclid|add-to-cart|replytocom)/i.test(k))) u.search = '';
      out.add(u.toString());
    } catch { /* */ }
  }
  return [...out];
}
export function sitemapUrls(xml: string, host: string) {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) { try { const u = new URL(decode(m[1])); if (u.host === host) out.push(u.toString()); } catch { /* */ } }
  return out;
}

// Κομμάτια ~900 χαρακτήρων με επικάλυψη, σε όρια παραγράφων/προτάσεων. Πετάει πολύ μικρά.
export function chunkText(text: string, size = 900, overlap = 120) {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = []; let cur = '';
  const push = () => { const c = cur.trim(); if (c.length >= 60) out.push(c); };
  for (const p of paras) {
    if (p.length > size) { // πολύ μεγάλη παράγραφος → σε προτάσεις
      for (const s of p.split(/(?<=[.;!?·])\s+/)) { if ((cur + ' ' + s).length > size && cur) { push(); cur = cur.slice(-overlap) + ' ' + s; } else cur += (cur ? ' ' : '') + s; }
      continue;
    }
    if ((cur + '\n' + p).length > size && cur) { push(); cur = cur.slice(-overlap) + '\n' + p; } else cur += (cur ? '\n' : '') + p;
  }
  push();
  return out;
}

// Κρατά μόνο τους συνδέσμους προς επιτρεπόμενα domains· τους άλλους τους κάνει απλό κείμενο.
export function filterLinks(text: string, allowedHosts: string[]) {
  const hosts = allowedHosts.map((h) => h.toLowerCase().replace(/^www\./, ''));
  return text.replace(/https?:\/\/[^\s)<>"']+/g, (u) => {
    try { const h = new URL(u).hostname.toLowerCase().replace(/^www\./, ''); if (hosts.some((a) => h === a || h.endsWith('.' + a))) return u; } catch { /* */ }
    return '[σύνδεσμος αφαιρέθηκε]';
  });
}
