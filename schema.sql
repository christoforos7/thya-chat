-- Thya Chat — AI βοηθός του thya.gr (D1: thya-chat).
-- Κάθε πελάτης (tenant) έχει δικό του δημόσιο κλειδί, επιτρεπόμενα domains, γνώση, συζητήσεις και leads.
-- Ποτέ ολόκληρη IP: μόνο hash με αλάτι (GDPR). Διατήρηση συζητήσεων 90 ημέρες.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,                 -- π.χ. 't_kalavryta'
  name TEXT NOT NULL,                  -- επωνυμία πελάτη
  site_key TEXT NOT NULL UNIQUE,       -- δημόσιο κλειδί του widget (pk_...)
  origins TEXT NOT NULL,               -- JSON πίνακας επιτρεπόμενων origins, π.χ. ["https://www.example.gr"]
  start_url TEXT,                      -- από πού ξεκινά η εκπαίδευση (συνήθως η αρχική ή το sitemap)
  status TEXT NOT NULL DEFAULT 'active', -- active | paused
  plan TEXT NOT NULL DEFAULT 'pilot',
  brand TEXT,                          -- JSON {name, color, greeting, chips[], position, powered}
  langs TEXT,                          -- JSON πίνακας γλωσσών (κενό = όλες)
  instructions TEXT,                   -- επιπλέον οδηγίες του πελάτη (τόνος, τι να μη λέει)
  facts TEXT,                          -- σταθερά στοιχεία (ωράριο, τηλέφωνο, διεύθυνση) που υπερισχύουν του site
  lead_webhook TEXT,                   -- προαιρετικό: Teams/Slack/Make webhook για νέα leads
  lead_email TEXT,                     -- email πελάτη για leads (όταν ενεργοποιηθεί)
  daily_cap INTEGER NOT NULL DEFAULT 200, -- μέγιστες απαντήσεις/ημέρα
  model TEXT,                          -- ΕΣΩΤΕΡΙΚΟ: κενό = προεπιλογή, 'sonnet' = πρόσθετο πακέτο
  max_pages INTEGER NOT NULL DEFAULT 60,
  crawled_at TEXT,
  crawl_note TEXT,
  shop TEXT,                           -- JSON {type:'woocommerce', base:'https://...'} για καταστήματα (κατάλογος + παραγγελίες)
  tg_chat TEXT,                        -- κοινό κανάλι/ομάδα Telegram για συζητήσεις και αιτήματα
  shop_synced TEXT,                    -- τελευταίος συγχρονισμός καταλόγου
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  tenant TEXT NOT NULL, url TEXT NOT NULL, title TEXT, hash TEXT, chunks INTEGER NOT NULL DEFAULT 0, fetched_at TEXT,
  PRIMARY KEY (tenant, url)
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,                 -- <tenant>:<hash σελίδας>:<α/α>, ίδιο με το id στο Vectorize
  tenant TEXT NOT NULL, url TEXT NOT NULL, title TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_url ON chunks (tenant, url);
-- Αναζήτηση λέξεων (δεύτερη πηγή όταν το Vectorize δεν είναι διαθέσιμο)
-- Το κείμενο μπαίνει κανονικοποιημένο (πεζά, χωρίς τόνους) — ο tokenizer δεν βγάζει τους ελληνικούς τόνους.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, tenant UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE IF NOT EXISTS convos (
  tenant TEXT NOT NULL, sid TEXT NOT NULL, started_at TEXT NOT NULL, last_at TEXT NOT NULL,
  ip_hash TEXT, country TEXT, path TEXT, lang TEXT, msgs INTEGER NOT NULL DEFAULT 0, lead INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant, sid)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, sid TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
  at TEXT NOT NULL, tokens_in INTEGER, tokens_out INTEGER, err TEXT, model TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_at ON messages (tenant, at);
CREATE INDEX IF NOT EXISTS idx_messages_sid ON messages (tenant, sid, id);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, sid TEXT, name TEXT, email TEXT, phone TEXT, note TEXT,
  consent INTEGER NOT NULL DEFAULT 0, source TEXT, at TEXT NOT NULL, notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_at ON leads (tenant, at);

CREATE TABLE IF NOT EXISTS usage_daily (
  tenant TEXT NOT NULL, day TEXT NOT NULL, replies INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant, day)
);

CREATE TABLE IF NOT EXISTS rl (h TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rl ON rl (h, ts);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, tenant TEXT, detail TEXT
);

-- Ουρά εκπαίδευσης (σελίδες που περιμένουν ανάγνωση)
CREATE TABLE IF NOT EXISTS crawl_queue (tenant TEXT NOT NULL, url TEXT NOT NULL, added_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant, url));

-- Καταστήματα: αντίγραφο του δημόσιου καταλόγου (WooCommerce Store API), ανανέωση κάθε ώρα.
CREATE TABLE IF NOT EXISTS shop_products (tenant TEXT NOT NULL, id INTEGER NOT NULL, name TEXT NOT NULL, url TEXT, price TEXT, sale INTEGER NOT NULL DEFAULT 0, in_stock INTEGER NOT NULL DEFAULT 1, cats TEXT, descr TEXT, updated TEXT NOT NULL, PRIMARY KEY (tenant, id));
CREATE VIRTUAL TABLE IF NOT EXISTS shop_fts USING fts5(tenant UNINDEXED, pid UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
