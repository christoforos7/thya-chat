# Naria — AI βοηθός του thya.gr

Αυτόνομο project, μόνο για το κατάστημα κοσμημάτων **thya.gr**: δικός του Worker, δική του βάση D1, δικό του bot Telegram.

| Κομμάτι | Τι κάνει |
|---|---|
| Worker `thya-chat` → `https://chat.thya.gr` | widget, συζήτηση, διαχείριση, cron |
| D1 `thya-chat` | ρυθμίσεις, γνώση από το site, κατάλογος, συζητήσεις, αιτήματα, χρήση |
| Claude Haiku (Anthropic API) | απαντήσεις· μηνιαίο όριο `CLAUDE_MONTHLY_USD` (προεπιλογή 30 $), από εκεί και πάνω Workers AI |
| Workers AI | εφεδρεία, δωρεάν ημερήσιο όριο (`NEURON_CAP`) |

**Εσωτερικό:** το μοντέλο και ο πάροχος AI δεν αναφέρονται ποτέ δημόσια.

## Τι κάνει ο βοηθός
- **Προτείνει κοσμήματα** από τον κατάλογο WooCommerce (δημόσιο Store API, κάθε ώρα): τιμή, προσφορά, διαθεσιμότητα, σύνδεσμος.
- **Αποστολές, επιστροφές, όροι, συχνές ερωτήσεις** από τις σελίδες του thya.gr (επανεκπαίδευση κάθε εβδομάδα).
- **Κατάσταση παραγγελίας** μόνο με αριθμό **και** email παραγγελίας (κλειδί WooCommerce μόνο ανάγνωσης). Λάθος συνδυασμός → «δεν βρέθηκε», χωρίς διαρροή. Ποτέ διεύθυνση, τηλέφωνο ή πληρωμή. 6 έλεγχοι/ώρα ανά επισκέπτη.
- **Στοιχεία πελάτη** για ειδικές παραγγελίες ή δώρα (με συγκατάθεση στη φόρμα).
- **Κοινή ομάδα Telegram:** κάθε συζήτηση (💬), έλεγχος παραγγελίας (📦) και αίτημα (⭐).

## Ασφάλεια
- Μόνο από `https://www.thya.gr` / `https://thya.gr` (origin + δημόσιο κλειδί). Όρια 25 μηνύματα/ώρα, 80/ημέρα ανά επισκέπτη.
- Ποτέ ολόκληρη IP: hash με αλάτι που αλλάζει κάθε μέρα. Συζητήσεις 90 ημέρες, αιτήματα 12 μήνες.
- Πηγές και μηνύματα = δεδομένα, όχι εντολές· σύνδεσμοι μόνο προς το thya.gr.
- Διαχείριση με `ADMIN_TOKEN` (≥ 24 χαρακτήρες, κλείδωμα μετά από 10 λάθη/ώρα).

## Εγκατάσταση
1. Cloudflare → Workers & Pages → Create → Import repository `christoforos7/thya-chat` (deploy: `npx wrangler deploy`).
2. Βάση: η D1 `thya-chat` έχει ήδη το σχήμα (25/10/2026). Για νέα βάση: `npx wrangler d1 execute thya-chat --remote --file schema.sql`.
3. Worker → Settings → Domains & Routes → Custom domain `chat.thya.gr`.
4. Secrets (Worker → Settings → Variables and Secrets):
   `ADMIN_TOKEN`, `IP_SALT`, `ANTHROPIC_API_KEY`, `TG_BOT_TOKEN`, `WC_KEY_THYA`, `WC_SECRET_THYA`.
5. Telegram: νέο bot στο @BotFather → ομάδα με τους υπεύθυνους + το bot → γράψτε ένα μήνυμα στην ομάδα → `GET /admin/tg-chats` για το chat id.
6. Ρυθμίσεις: `config/thya.json` (συμπληρώστε `tg_chat`) και:
```sh
A="Authorization: Bearer $ADMIN_TOKEN"; H=https://chat.thya.gr
curl -X POST $H/admin/tenants -H "$A" -H 'content-type: application/json' -d @config/thya.json
curl -X POST $H/admin/tenants/thya/shop-sync -H "$A"   # κατάλογος
curl -X POST $H/admin/tenants/thya/crawl -H "$A"       # σελίδες του site
curl -X POST $H/admin/tenants/thya/tg-test -H "$A"     # δοκιμή στην ομάδα
curl $H/admin/tenants/thya/install -H "$A"             # κώδικας για το WordPress
```
7. WordPress (thya.gr): WPCode → footer: `<script src="https://chat.thya.gr/w.js" data-key="pk_..." async></script>`

## Διαχείριση
```sh
curl "$H/admin/tenants/thya/convos?days=7" -H "$A"   # συζητήσεις
curl "$H/admin/tenants/thya/leads?days=30" -H "$A"   # αιτήματα
curl "$H/admin/usage?days=14" -H "$A"                # χρήση / κόστος
```

## Ανάπτυξη
`npm test` (node:sqlite με την ίδια SQL).
