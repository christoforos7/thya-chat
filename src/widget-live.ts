// Το widget που μπαίνει σε οποιοδήποτε site με μία γραμμή:
//   <script src="https://<host>/w.js" data-key="pk_..." async></script>
// Shadow DOM (δεν επηρεάζει και δεν επηρεάζεται από το CSS του site), κείμενο πάντα με textContent (ποτέ innerHTML από το AI).
export const WIDGET_JS_LIVE = String.raw`(() => {
  'use strict';
  const me = document.currentScript || document.querySelector('script[data-key][src*="/w.js"]');
  if (!me || window.__thyaChat) return; window.__thyaChat = 1;
  const KEY = (me.getAttribute('data-key') || '').replace(/[^a-z0-9_]/gi, '');
  const BASE = new URL(me.src).origin;
  const API = BASE + '/v1/t/' + KEY;
  const en = /^en/i.test(document.documentElement.lang || navigator.language || '');
  const L = en ? { open: 'Chat with us', ph: 'Type your message…', send: 'Send', leave: 'Leave your details', name: 'Name', email: 'Email', phone: 'Phone', note: 'How can we help?', consent: 'I agree to be contacted about my request.', submit: 'Send details', thanks: 'Thank you! We will contact you soon.', err: 'Something went wrong. Please try again.', ai: 'AI assistant · may make mistakes', close: 'Close' }
                 : { open: 'Συνομιλία', ph: 'Γράψτε το μήνυμά σας…', send: 'Αποστολή', leave: 'Αφήστε τα στοιχεία σας', name: 'Όνομα', email: 'Email', phone: 'Τηλέφωνο', note: 'Πώς μπορούμε να βοηθήσουμε;', consent: 'Συμφωνώ να επικοινωνήσετε μαζί μου για το αίτημά μου.', submit: 'Αποστολή στοιχείων', thanks: 'Ευχαριστούμε! Θα επικοινωνήσουμε σύντομα.', err: 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.', ai: 'AI βοηθός · μπορεί να κάνει λάθη', close: 'Κλείσιμο' };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  let sid = ss.get('ic_sid'); if (!sid) { sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); ss.set('ic_sid', sid); }
  let hist = []; try { hist = JSON.parse(ss.get('ic_hist_' + KEY) || '[]'); } catch (e) {}
  const el = (t, a, ...k) => { const e = document.createElement(t); if (a) for (const [x, v] of Object.entries(a)) { if (x === 'class') e.className = v; else if (x.startsWith('on')) e.addEventListener(x.slice(2), v); else e.setAttribute(x, v); } for (const c of k.flat()) if (c != null) e.append(c); return e; };
  // κείμενο με ασφαλείς συνδέσμους (μόνο https), χωρίς HTML
  const nice = (u) => { try { const x = new URL(u); const p = decodeURIComponent(x.pathname).replace(/\/$/, ''); return x.hostname.replace(/^www\./, '') + (p.length > 32 ? p.slice(0, 30) + '…' : p); } catch (e) { return u; } };
  const link = (u, label) => el('a', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow' }, label || nice(u));
  // κείμενο → **έντονα**, [κείμενο](https://…) και γυμνοί σύνδεσμοι https· χωρίς HTML
  const rich = (s) => { const f = document.createDocumentFragment(); const re = /\*\*([^*\n]{1,200})\*\*|\[([^\]\n]{1,120})\]\((https:\/\/[^\s)<>"']+)\)|(https:\/\/[^\s)<>"']+)/g; let i = 0, m; while ((m = re.exec(s))) { f.append(s.slice(i, m.index)); if (m[1]) f.append(el('strong', null, m[1])); else if (m[2]) f.append(link(m[3], m[2])); else { const u = m[4].replace(/[.,;:!?]+$/, ''); f.append(link(u)); re.lastIndex = m.index + u.length; } i = re.lastIndex; } f.append(s.slice(i)); return f; };

  fetch(API + '/config').then((r) => r.ok ? r.json() : null).then((cfg) => { if (cfg && cfg.ok) mount(cfg); }).catch(() => {});

  function mount(cfg) {
    const c = /^#[0-9a-f]{3,8}$/i.test(cfg.color || '') ? cfg.color : '#0E5C7A';
    const left = cfg.position === 'left';
    const host = el('div', { id: 'thya-chat' }); host.style.cssText = 'position:fixed;z-index:2147483000;bottom:20px;' + (left ? 'left' : 'right') + ':20px';
    const root = host.attachShadow({ mode: 'closed' });
    root.append(el('style', null, ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.b{width:60px;height:60px;border-radius:50%;border:0;background:' + c + ';color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}' +
      '.b svg{width:28px;height:28px}.p{position:absolute;bottom:72px;' + (left ? 'left' : 'right') + ':0;width:min(380px,calc(100vw - 32px));height:min(580px,calc(100vh - 110px));background:#fff;color:#1b2733;border-radius:18px;box-shadow:0 16px 48px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden}' +
      '.p.on{display:flex}.h{background:' + c + ';color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}.h b{flex:1;font-size:15px}.h small{display:block;font-weight:400;opacity:.85;font-size:11px}.x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}' +
      '.m{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f5f7fa}.q,.a{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
      '.q{align-self:flex-end;background:' + c + ';color:#fff;border-bottom-right-radius:4px}.a{align-self:flex-start;background:#fff;border:1px solid #e3e8ef;border-bottom-left-radius:4px}.a a{color:' + c + '}.t{opacity:.6;font-style:italic}' +
      '.ch{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px;background:#f5f7fa}.ch button{border:1px solid ' + c + ';color:' + c + ';background:#fff;border-radius:99px;padding:6px 10px;font-size:12.5px;cursor:pointer}' +
      '.f{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e8ef}.f input{flex:1;border:1px solid #cfd7e2;border-radius:10px;padding:10px;font-size:16px;outline:none}.f input:focus{border-color:' + c + '}' +
      '.s{border:0;background:' + c + ';color:#fff;border-radius:10px;padding:0 14px;font-size:14px;cursor:pointer}.lv{background:none;border:0;color:' + c + ';font-size:12.5px;cursor:pointer;padding:6px 14px;text-align:left;text-decoration:underline}' +
      '.ft{font-size:10.5px;color:#7a8696;padding:4px 14px 8px;display:flex;justify-content:space-between;gap:8px}.ft a{color:#7a8696}' +
      '.lf{display:none;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid #e3e8ef}.lf.on{display:flex}.lf input,.lf textarea{border:1px solid #cfd7e2;border-radius:10px;padding:9px;font-size:16px}.lf label{font-size:12px;display:flex;gap:6px;align-items:flex-start}'));
    const msgs = el('div', { class: 'm', role: 'log', 'aria-live': 'polite' });
    const add = (role, text) => { const d = el('div', { class: role === 'user' ? 'q' : 'a' }); d.append(role === 'user' ? text : rich(text)); msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; };
    const inp = el('input', { type: 'text', maxlength: '1000', placeholder: L.ph, 'aria-label': L.ph });
    const chips = el('div', { class: 'ch' }, (cfg.chips || []).slice(0, 4).map((x) => el('button', { type: 'button', onclick: () => send(x) }, x)));
    let busy = false;
    async function send(text) {
      text = String(text || inp.value).trim(); if (!text || busy) return; busy = true; inp.value = ''; chips.remove();
      add('user', text); hist.push({ role: 'user', content: text });
      const wait = add('assistant', '…'); wait.classList.add('t');
      try {
        const r = await fetch(API + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid, messages: hist.slice(-12), path: location.pathname, lang: en ? 'en' : 'el' }) });
        const j = await r.json().catch(() => ({}));
        const ans = j.reply || (r.status === 429 ? (en ? 'Too many messages, please try again later.' : 'Πολλά μηνύματα, δοκιμάστε σε λίγο.') : L.err);
        wait.remove(); add('assistant', ans); if (j.reply) hist.push({ role: 'assistant', content: j.reply });
        ss.set('ic_hist_' + KEY, JSON.stringify(hist.slice(-12)));
      } catch (e) { wait.remove(); add('assistant', L.err); }
      busy = false; inp.focus();
    }
    const fN = el('input', { placeholder: L.name, maxlength: '100' }), fE = el('input', { placeholder: L.email, type: 'email', maxlength: '200' }), fP = el('input', { placeholder: L.phone, type: 'tel', maxlength: '40' }), fT = el('textarea', { placeholder: L.note, rows: '2', maxlength: '1000' }), fC = el('input', { type: 'checkbox' });
    const lf = el('form', { class: 'lf', onsubmit: async (e) => { e.preventDefault(); if (!fC.checked) { fC.focus(); return; }
      try { const r = await fetch(API + '/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid, name: fN.value, email: fE.value, phone: fP.value, note: fT.value, consent: true }) }); if (!r.ok) throw 0; lf.classList.remove('on'); add('assistant', L.thanks); } catch (x) { add('assistant', L.err); } } },
      fN, fE, fP, fT, el('label', null, fC, L.consent), el('button', { class: 's', type: 'submit', style: 'padding:10px' }, L.submit));
    const panel = el('div', { class: 'p', role: 'dialog', 'aria-label': cfg.name },
      el('div', { class: 'h' }, el('b', null, cfg.name, el('small', null, L.ai)), el('button', { class: 'x', type: 'button', 'aria-label': L.close, onclick: () => panel.classList.remove('on') }, '×')),
      msgs, chips, el('button', { class: 'lv', type: 'button', onclick: () => lf.classList.toggle('on') }, L.leave), lf,
      el('form', { class: 'f', onsubmit: (e) => { e.preventDefault(); send(); } }, inp, el('button', { class: 's', type: 'submit' }, L.send)),
      el('div', { class: 'ft' }, cfg.privacy ? el('a', { href: cfg.privacy, target: '_blank', rel: 'noopener' }, en ? 'Privacy' : 'Απόρρητο') : el('span'), cfg.powered ? el('a', { href: cfg.powered.url, target: '_blank', rel: 'noopener' }, 'Powered by ' + cfg.powered.name) : el('span')));
    const btn = el('button', { class: 'b', type: 'button', 'aria-label': L.open, onclick: () => { panel.classList.toggle('on'); if (panel.classList.contains('on')) inp.focus(); } });
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    if (hist.length) hist.forEach((m) => add(m.role, m.content)); else add('assistant', cfg.greeting || (en ? 'Hi! How can I help?' : 'Γεια σας! Πώς μπορώ να βοηθήσω;'));
    root.append(panel, btn); document.body.append(host);
  }
})();`;
