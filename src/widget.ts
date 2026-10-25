// Το widget που μπαίνει σε οποιοδήποτε site με μία γραμμή:
//   <script src="https://<host>/w.js" data-key="pk_..." async></script>
// Shadow DOM (δεν επηρεάζει και δεν επηρεάζεται από το CSS του site), κείμενο πάντα με textContent (ποτέ innerHTML από το AI).
// Εμφάνιση: avatar, κεφαλίδα σε απαλό κρεμ με χρυσή γραμμή, «γράφει…», κάρτες προϊόντων, μήνυμα-πρόσκληση, πλήρης οθόνη στο κινητό.
export const WIDGET_JS = String.raw`(() => {
  'use strict';
  const me = document.currentScript || document.querySelector('script[data-key][src*="/w.js"]');
  if (!me || window.__thyaChat) return; window.__thyaChat = 1;
  const KEY = (me.getAttribute('data-key') || '').replace(/[^a-z0-9_]/gi, '');
  const BASE = new URL(me.src).origin;
  const API = BASE + '/v1/t/' + KEY;
  const en = /^en/i.test(document.documentElement.lang || navigator.language || '');
  const L = en ? { open: 'Chat with us', ph: 'Type your message…', send: 'Send', leave: 'Leave your details', name: 'Name', email: 'Email', phone: 'Phone', note: 'How can we help?', consent: 'I agree to be contacted about my request.', submit: 'Send details', thanks: 'Thank you! We will contact you soon.', err: 'Something went wrong. Please try again.', ai: 'AI assistant', close: 'Close', view: 'View', out: 'Out of stock', dismiss: 'Dismiss' }
                 : { open: 'Συνομιλία', ph: 'Γράψτε το μήνυμά σας…', send: 'Αποστολή', leave: 'Αφήστε τα στοιχεία σας', name: 'Όνομα', email: 'Email', phone: 'Τηλέφωνο', note: 'Πώς μπορούμε να βοηθήσουμε;', consent: 'Συμφωνώ να επικοινωνήσετε μαζί μου για το αίτημά μου.', submit: 'Αποστολή στοιχείων', thanks: 'Ευχαριστούμε! Θα επικοινωνήσουμε σύντομα.', err: 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.', ai: 'AI βοηθός', close: 'Κλείσιμο', view: 'Δες το', out: 'Εξαντλημένο', dismiss: 'Κλείσιμο' };
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  let sid = ss.get('ic_sid'); if (!sid) { sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); ss.set('ic_sid', sid); }
  let hist = []; try { hist = JSON.parse(ss.get('ic_hist_' + KEY) || '[]'); } catch (e) {}
  const el = (t, a, ...k) => { const e = document.createElement(t); if (a) for (const [x, v] of Object.entries(a)) { if (x === 'class') e.className = v; else if (x.startsWith('on')) e.addEventListener(x.slice(2), v); else e.setAttribute(x, v); } for (const c of k.flat()) if (c != null) e.append(c); return e; };
  const nice = (u) => { try { const x = new URL(u); const p = decodeURIComponent(x.pathname).replace(/\/$/, ''); return x.hostname.replace(/^www\./, '') + (p.length > 32 ? p.slice(0, 30) + '…' : p); } catch (e) { return u; } };
  const safe = (u) => typeof u === 'string' && /^https:\/\//.test(u) ? u : null;
  const link = (u, label) => el('a', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow' }, label || nice(u));
  // κείμενο → **έντονα**, [κείμενο](https://…) και γυμνοί σύνδεσμοι https· χωρίς HTML
  const rich = (s) => { const f = document.createDocumentFragment(); const re = /\*\*([^*\n]{1,200})\*\*|\[([^\]\n]{1,120})\]\((https:\/\/[^\s)<>"']+)\)|(https:\/\/[^\s)<>"']+)/g; let i = 0, m; while ((m = re.exec(s))) { f.append(s.slice(i, m.index)); if (m[1]) f.append(el('strong', null, m[1])); else if (m[2]) f.append(link(m[3], m[2])); else { const u = m[4].replace(/[.,;:!?]+$/, ''); f.append(link(u)); re.lastIndex = m.index + u.length; } i = re.lastIndex; } f.append(s.slice(i)); return f; };

  fetch(API + '/config').then((r) => r.ok ? r.json() : null).then((cfg) => { if (cfg && cfg.ok) mount(cfg); }).catch(() => {});

  function mount(cfg) {
    const c = /^#[0-9a-f]{3,8}$/i.test(cfg.color || '') ? cfg.color : '#0E5C7A';
    const left = cfg.position === 'left'; const side = left ? 'left' : 'right';
    const av = safe(cfg.avatar);
    const host = el('div', { id: 'thya-chat' }); host.style.cssText = 'position:fixed;z-index:2147483000;bottom:20px;' + side + ':20px';
    const root = host.attachShadow({ mode: 'closed' });
    const SANS = 'Manrope,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif', SERIF = '"Cormorant Garamond","Playfair Display",Georgia,"Times New Roman",serif';
    root.append(el('style', null,
      ':host{all:initial}*{box-sizing:border-box;font-family:' + SANS + '}' +
      '@keyframes pop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}@keyframes dot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}@keyframes glow{0%,100%{box-shadow:0 8px 24px rgba(60,40,10,.28),0 0 0 0 ' + c + '55}50%{box-shadow:0 8px 24px rgba(60,40,10,.28),0 0 0 8px ' + c + '00}}' +
      // κουμπί εκκίνησης
      '.b{position:relative;width:64px;height:64px;border-radius:50%;border:0;padding:3px;cursor:pointer;background:linear-gradient(135deg,#e9d3a8,' + c + ' 55%,#8a6428);animation:glow 2.6s ease-in-out 3;box-shadow:0 8px 24px rgba(60,40,10,.28);transition:transform .2s}.b:hover{transform:scale(1.05)}' +
      '.b img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;border:2px solid #fffaf2}.b .ic{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff}.b .ic svg{width:28px;height:28px}' +
      '.on-dot{position:absolute;bottom:3px;' + (left ? 'left' : 'right') + ':3px;width:13px;height:13px;border-radius:50%;background:#3fb27f;border:2px solid #fff}' +
      // μήνυμα-πρόσκληση
      '.tz{position:absolute;bottom:76px;' + side + ':0;width:max-content;max-width:min(250px,calc(100vw - 40px));background:#fff;color:#3a2f22;border:1px solid #efe3cd;border-radius:16px;padding:11px 30px 11px 14px;font-size:13.5px;line-height:1.4;box-shadow:0 10px 30px rgba(60,40,10,.18);cursor:pointer;animation:pop .35s ease-out}' +
      '.tz:after{content:"";position:absolute;bottom:-7px;' + (left ? 'left' : 'right') + ':24px;width:12px;height:12px;background:#fff;border-right:1px solid #efe3cd;border-bottom:1px solid #efe3cd;transform:rotate(45deg)}.tz button{position:absolute;top:6px;right:8px;border:0;background:none;color:#9b8a70;font-size:16px;cursor:pointer;line-height:1}' +
      // παράθυρο
      '.p{position:absolute;bottom:80px;' + side + ':0;width:min(390px,calc(100vw - 32px));height:min(600px,calc(100vh - 120px));background:#fffdf9;color:#2b241c;border-radius:22px;box-shadow:0 20px 60px rgba(60,40,10,.25);display:none;flex-direction:column;overflow:hidden;border:1px solid #efe3cd}' +
      '.p.on{display:flex;animation:pop .28s ease-out}' +
      '.h{background:linear-gradient(180deg,#fbf5ea,#f6ecdb);padding:14px 16px;display:flex;align-items:center;gap:12px;border-bottom:2px solid ' + c + '}' +
      '.av{position:relative;width:44px;height:44px;flex:none}.av img{width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid ' + c + '}.av .on-dot{bottom:0;right:0;left:auto;width:11px;height:11px}' +
      '.hn{flex:1;min-width:0}.hn b{display:block;font-family:' + SERIF + ';font-size:21px;font-weight:600;letter-spacing:.3px;color:#2b241c;line-height:1.1}.hn small{display:block;font-size:11px;color:#8a7a62;margin-top:2px}' +
      '.x{background:none;border:0;color:#8a7a62;font-size:24px;cursor:pointer;line-height:1;padding:4px}' +
      '.m{flex:1;overflow:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px;background:#fffdf9;scroll-behavior:smooth}' +
      '.row{flex:none;display:flex;gap:8px;align-items:flex-end;max-width:92%;animation:pop .25s ease-out}.row.u{align-self:flex-end;flex-direction:row-reverse}.row img.mini{width:26px;height:26px;border-radius:50%;object-fit:cover;flex:none;border:1px solid #efe3cd}' +
      '.q,.a{padding:10px 13px;border-radius:18px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}' +
      '.q{background:' + c + ';color:#fff;border-bottom-right-radius:6px}.a{background:#fff;border:1px solid #efe3cd;border-bottom-left-radius:6px;box-shadow:0 2px 8px rgba(60,40,10,.05)}.a a{color:#8a6428;font-weight:600}.a strong{font-weight:700;color:#2b241c}' +
      '.hm{display:flex;flex-direction:column;gap:3px}.hm small{font-size:10.5px;font-weight:700;color:#8a6428;letter-spacing:.3px;padding-left:4px}.a.hu{background:#fbf3e4;border-color:#e3cfa6}.nb{position:absolute;top:-2px;' + (left ? 'right' : 'left') + ':-2px;min-width:20px;height:20px;border-radius:99px;background:#c0392b;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;border:2px solid #fff;padding:0 5px}.nb.on{display:flex}' +
      '.typing{display:flex;gap:4px;padding:13px 14px}.typing i{width:7px;height:7px;border-radius:50%;background:' + c + ';animation:dot 1.2s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}' +
      // κάρτες προϊόντων
      '.cards{flex:none;display:flex;gap:10px;overflow-x:auto;padding:2px 2px 6px 34px;scroll-snap-type:x mandatory;animation:pop .3s ease-out}.cards::-webkit-scrollbar{height:4px}.cards::-webkit-scrollbar-thumb{background:#e6d6b8;border-radius:4px}' +
      '.card{flex:none;width:150px;background:#fff;border:1px solid #efe3cd;border-radius:14px;overflow:hidden;text-decoration:none;color:#2b241c;scroll-snap-align:start;box-shadow:0 4px 14px rgba(60,40,10,.07);transition:transform .15s}.card:hover{transform:translateY(-2px)}' +
      '.card .ph{width:100%;height:120px;background:#f6efe2 center/cover no-repeat}.card .cb{padding:8px 10px 10px}.card .cn{font-size:12.5px;font-weight:600;line-height:1.3;max-height:2.6em;overflow:hidden}.card .cp{font-size:13px;color:#8a6428;font-weight:700;margin:4px 0 7px}.card .cv{display:block;text-align:center;font-size:12px;font-weight:600;background:' + c + ';color:#fff;border-radius:99px;padding:6px 0}.card .so{font-size:11px;color:#b0412f;font-weight:600}' +
      '.ch{display:flex;flex-wrap:wrap;gap:7px;padding:0 14px 10px;background:#fffdf9}.ch button{border:1px solid #e3cfa6;color:#6e5226;background:#fff;border-radius:99px;padding:7px 12px;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .15s}.ch button:hover{background:' + c + ';border-color:' + c + ';color:#fff}' +
      '.f{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #efe3cd;background:#fff;align-items:center}.f input{flex:1;border:1px solid #e6d8bf;border-radius:99px;padding:11px 16px;font-size:16px;outline:none;background:#fffdf9;color:#2b241c}.f input:focus{border-color:' + c + ';box-shadow:0 0 0 3px ' + c + '22}' +
      '.s{border:0;background:' + c + ';color:#fff;border-radius:99px;width:42px;height:42px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}.s svg{width:18px;height:18px}' +
      '.lv{background:none;border:0;color:#8a6428;font-size:12px;font-weight:600;cursor:pointer;padding:2px 16px 8px;text-align:left}' +
      '.ft{font-size:10.5px;color:#a3957f;padding:6px 16px 9px;display:flex;justify-content:space-between;align-items:center;gap:8px;background:#fff}.ft a{color:#a3957f}.ft .pw{text-decoration:none;font-weight:600;letter-spacing:.2px}.ft .pw:hover{color:#8a6428}' +
      '.lf{display:none;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid #efe3cd;background:#fff}.lf.on{display:flex}.lf input,.lf textarea{border:1px solid #e6d8bf;border-radius:12px;padding:10px;font-size:16px;background:#fffdf9}.lf label{font-size:12px;display:flex;gap:6px;align-items:flex-start;color:#6b5d48}.lf .sb{border:0;background:' + c + ';color:#fff;border-radius:99px;padding:11px;font-size:14px;font-weight:600;cursor:pointer}' +
      // κινητό: πλήρης οθόνη
      '@media (max-width:520px){.p{position:fixed;inset:0;width:100vw;height:100dvh;max-height:none;border-radius:0;bottom:0;border:0}.p.on~.b,.p.on~.tz{display:none}}' +
      '@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}'));

    const img = (cls) => av ? el('img', { class: cls || '', src: av, alt: '' }) : null;
    const msgs = el('div', { class: 'm', role: 'log', 'aria-live': 'polite' });
    const scroll = () => { msgs.scrollTop = msgs.scrollHeight; };
    const add = (role, text) => {
      const b = el('div', { class: role === 'user' ? 'q' : 'a' }); b.append(role === 'user' ? text : rich(text));
      const r = el('div', { class: 'row' + (role === 'user' ? ' u' : '') }, role === 'user' ? null : img('mini'), b); msgs.append(r); scroll(); return r;
    };
    const addHuman = (text) => {
      const i = String(text).indexOf(': '); const who = i > 0 && i < 40 ? String(text).slice(0, i) : ''; const body = i > 0 && i < 40 ? String(text).slice(i + 2) : String(text);
      const b = el('div', { class: 'a hu' }); b.append(rich(body));
      const r = el('div', { class: 'row' }, img('mini'), el('div', { class: 'hm' }, el('small', null, (who ? who + ' · ' : '') + (en ? 'THYA team' : 'ομάδα THYA')), b)); msgs.append(r); scroll(); return r;
    };
    const cards = (list) => {
      if (!Array.isArray(list) || !list.length) return;
      const box = el('div', { class: 'cards' });
      for (const p of list.slice(0, 3)) {
        const u = safe(p.url); if (!u) continue;
        const ph = el('div', { class: 'ph' }); const im = safe(p.image); if (im) ph.style.backgroundImage = 'url("' + im.replace(/["\\]/g, '') + '")';
        box.append(el('a', { class: 'card', href: u, target: '_blank', rel: 'noopener noreferrer' }, ph,
          el('div', { class: 'cb' }, el('div', { class: 'cn' }, String(p.name || '').slice(0, 80)), el('div', { class: 'cp' }, String(p.price || '').slice(0, 40)),
            p.in_stock === false ? el('div', { class: 'so' }, L.out) : el('span', { class: 'cv' }, L.view))));
      }
      if (box.childNodes.length) { msgs.append(box); scroll(); }
    };
    const inp = el('input', { type: 'text', maxlength: '1000', placeholder: L.ph, 'aria-label': L.ph });
    const chips = el('div', { class: 'ch' }, (cfg.chips || []).slice(0, 4).map((x) => el('button', { type: 'button', onclick: () => send(x) }, x)));
    let busy = false;
    async function send(text) {
      text = String(text || inp.value).trim(); if (!text || busy) return; busy = true; inp.value = ''; chips.remove();
      add('user', text); hist.push({ role: 'user', content: text });
      const wait = el('div', { class: 'row' }, img('mini'), el('div', { class: 'a typing', 'aria-label': '…' }, el('i'), el('i'), el('i'))); msgs.append(wait); scroll();
      try {
        const r = await fetch(API + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid, messages: hist.slice(-12), path: location.pathname, lang: en ? 'en' : 'el' }) });
        const j = await r.json().catch(() => ({}));
        const ans = j.reply || (r.status === 429 ? (en ? 'Too many messages, please try again later.' : 'Πολλά μηνύματα, δοκιμάστε σε λίγο.') : L.err);
        wait.remove(); if (j.live) { human = true; startPoll(); } else { add('assistant', ans); cards(j.products); if (j.reply) hist.push({ role: 'assistant', content: j.reply }); }
        ss.set('ic_hist_' + KEY, JSON.stringify(hist.slice(-12)));
      } catch (e) { wait.remove(); add('assistant', L.err); }
      busy = false; inp.focus(); startPoll();
    }
    const fN = el('input', { placeholder: L.name, maxlength: '100' }), fE = el('input', { placeholder: L.email, type: 'email', maxlength: '200' }), fP = el('input', { placeholder: L.phone, type: 'tel', maxlength: '40' }), fT = el('textarea', { placeholder: L.note, rows: '2', maxlength: '1000' }), fC = el('input', { type: 'checkbox' });
    const lf = el('form', { class: 'lf', onsubmit: async (e) => { e.preventDefault(); if (!fC.checked) { fC.focus(); return; }
      try { const r = await fetch(API + '/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid, name: fN.value, email: fE.value, phone: fP.value, note: fT.value, consent: true }) }); if (!r.ok) throw 0; lf.classList.remove('on'); add('assistant', L.thanks); } catch (x) { add('assistant', L.err); } } },
      fN, fE, fP, fT, el('label', null, fC, L.consent), el('button', { class: 'sb', type: 'submit' }, L.submit));
    const sendBtn = el('button', { class: 's', type: 'submit', 'aria-label': L.send }); sendBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    const close = () => panel.classList.remove('on');
    const panel = el('div', { class: 'p', role: 'dialog', 'aria-label': cfg.name },
      el('div', { class: 'h' }, av ? el('div', { class: 'av' }, img(), el('span', { class: 'on-dot' })) : null,
        el('div', { class: 'hn' }, el('b', null, cfg.name), el('small', null, cfg.subtitle || L.ai)),
        el('button', { class: 'x', type: 'button', 'aria-label': L.close, onclick: close }, '×')),
      msgs, chips, el('button', { class: 'lv', type: 'button', onclick: () => lf.classList.toggle('on') }, L.leave), lf,
      el('form', { class: 'f', onsubmit: (e) => { e.preventDefault(); send(); } }, inp, sendBtn),
      el('div', { class: 'ft' }, el('span', null, cfg.privacy ? el('a', { href: cfg.privacy, target: '_blank', rel: 'noopener' }, en ? 'Privacy' : 'Απόρρητο') : null, cfg.privacy && cfg.subtitle ? ' · ' : '', cfg.subtitle ? L.ai : ''), cfg.powered ? el('a', { class: 'pw', href: cfg.powered.url, target: '_blank', rel: 'noopener' }, 'Powered by ' + cfg.powered.name) : null));
    let tz = null;
    const hideTz = () => { if (tz) { tz.remove(); tz = null; } ss.set('ic_tz_' + KEY, '1'); };
    const toggle = () => { hideTz(); panel.classList.toggle('on'); if (panel.classList.contains('on')) { inp.focus(); scroll(); } };
    const btn = el('button', { class: 'b', type: 'button', 'aria-label': L.open, onclick: toggle });
    if (av) btn.append(el('img', { src: av, alt: '' }), el('span', { class: 'on-dot' }));
    else { const ic = el('span', { class: 'ic' }); ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'; btn.append(ic); }
    const hello = () => { const h = new Date().getHours(); return en ? (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') : (h >= 4 && h < 12 ? 'Καλημέρα' : 'Καλησπέρα'); };
    const greet = String(cfg.greeting || (en ? 'Hi! How can I help?' : 'Γεια σας! Πώς μπορώ να βοηθήσω;')).replace(/\{χαιρετισμός\}|\{greeting\}/g, hello());
    if (hist.length) hist.forEach((m) => m.human ? addHuman(m.content) : add(m.role, m.content)); else add('assistant', greet);
    const nb = el('span', { class: 'nb' }); btn.append(nb); let unread = 0;
    // ζωντανή συνομιλία: νέα μηνύματα από την ομάδα (μόνο όταν ο επισκέπτης έχει γράψει, έως 30' αδράνειας)
    let human = false, lastId = +(ss.get('ic_live_' + KEY) || 0) || 0, timer = null, lastAct = Date.now();
    async function pollOnce() {
      try {
        const r = await fetch(API + '/poll?sid=' + encodeURIComponent(sid) + '&after=' + lastId, { cache: 'no-store' });
        const j = await r.json().catch(() => null); if (!j) return;
        human = !!j.human;
        for (const m of j.msgs || []) {
          lastId = Math.max(lastId, +m.id || 0); ss.set('ic_live_' + KEY, String(lastId)); lastAct = Date.now();
          addHuman(m.text); hist.push({ role: 'assistant', content: m.text, human: true }); ss.set('ic_hist_' + KEY, JSON.stringify(hist.slice(-12)));
          if (!panel.classList.contains('on')) { unread++; nb.textContent = String(unread); nb.classList.add('on'); }
        }
      } catch (e) {}
    }
    function startPoll() {
      lastAct = Date.now(); if (timer) return;
      const tick = async () => {
        if (Date.now() - lastAct > 30 * 60_000) { timer = null; return; }
        if (!document.hidden) await pollOnce();
        timer = setTimeout(tick, panel.classList.contains('on') || human ? 3000 : 10000);
      };
      timer = setTimeout(tick, 1500);
    }
    btn.addEventListener('click', () => { unread = 0; nb.classList.remove('on'); });
    if (hist.length) startPoll();
    root.append(panel, btn); document.body.append(host);
    // μήνυμα-πρόσκληση: μία φορά ανά επίσκεψη, μετά από 6''
    if (cfg.teaser && !ss.get('ic_tz_' + KEY) && !hist.length) setTimeout(() => {
      if (panel.classList.contains('on') || ss.get('ic_tz_' + KEY)) return;
      tz = el('div', { class: 'tz', role: 'button', tabindex: '0', onclick: toggle }, String(cfg.teaser), el('button', { type: 'button', 'aria-label': L.dismiss, onclick: (e) => { e.stopPropagation(); hideTz(); } }, '×'));
      root.append(tz);
    }, 6000);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('on')) close(); });
  }
})();`;
