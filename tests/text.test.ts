import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, chunkText, sameSiteLinks, filterLinks, sitemapUrls, pageTitle } from '../src/text.ts';
import { originAllowed, findContact, norm } from '../src/util.ts';
import { ftsQuery } from '../src/kb.ts';

test('HTML → κείμενο χωρίς scripts, μενού, footer', () => {
  const t = htmlToText('<html><head><title>X</title></head><body><nav>Μενού</nav><main><h1>Δωμάτια</h1><p>Θέα &amp; τζάκι</p><script>alert(1)</script><ul><li>Wi-Fi</li></ul>' + 'λ'.repeat(450) + '</main><footer>©</footer></body></html>');
  assert.ok(t.includes('Δωμάτια') && t.includes('Θέα & τζάκι') && t.includes('• Wi-Fi'));
  assert.ok(!t.includes('Μενού') && !t.includes('alert') && !t.includes('©'));
  assert.equal(pageTitle('<title> Καλάβρυτα &amp; χιόνι </title>'), 'Καλάβρυτα & χιόνι');
});
test('κομμάτια ~900 χαρακτήρων', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Παράγραφος ${i}. ` + 'κείμενο '.repeat(20)).join('\n');
  const c = chunkText(text);
  assert.ok(c.length > 3 && c.every((x) => x.length <= 1100 && x.length >= 60));
});
test('σύνδεσμοι: μόνο ίδιο site, χωρίς αρχεία/admin/utm', () => {
  const l = sameSiteLinks('<a href="/a">a</a><a href="https://x.gr/b?utm_source=f">b</a><a href="https://other.gr/c">c</a><a href="/f.pdf">p</a><a href="/wp-admin/">w</a><a href="#top">t</a>', 'https://x.gr/');
  assert.deepEqual(l.sort(), ['https://x.gr/a', 'https://x.gr/b']);
  assert.deepEqual(sitemapUrls('<loc>https://x.gr/1</loc><loc>https://y.gr/2</loc>', 'x.gr'), ['https://x.gr/1']);
});
test('φίλτρο συνδέσμων στην απάντηση', () => {
  const r = filterLinks('Δες https://www.x.gr/rooms και https://evil.com/p και https://shop.x.gr/a', ['x.gr']);
  assert.ok(r.includes('https://www.x.gr/rooms') && r.includes('https://shop.x.gr/a') && !r.includes('evil.com'));
});
test('origin, στοιχεία επικοινωνίας, κανονικοποίηση', () => {
  assert.ok(originAllowed('https://www.x.gr', ['https://www.x.gr/']));
  assert.ok(!originAllowed('https://evil.com', ['https://www.x.gr']));
  assert.ok(!originAllowed(null, ['https://www.x.gr']));
  assert.ok(!originAllowed('http://www.x.gr', ['https://www.x.gr']));
  assert.deepEqual(findContact('το κινητό μου 694 123 4567 ή γράψε στο a.b@x.gr'), { email: 'a.b@x.gr', phone: '694 123 4567' });
  assert.deepEqual(findContact('έχω 3 παιδιά και 2 σκυλιά'), { email: '', phone: '' });
  assert.equal(norm('Δωμάτιο ΘΈΑΣ'), 'δωματιο θεασ');
  assert.ok(ftsQuery('Πόσο κοστίζει το δωμάτιο με θέα;').includes('δωματ*'));
});
