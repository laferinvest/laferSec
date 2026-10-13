const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../js/factoring-ads.js');
const root = path.resolve(__dirname, '..');

function harness(saved, hostname = 'www.lafersec.com.br', blocked = false) {
  const stored = new Map(saved ? [[app.consentKey, JSON.stringify(saved)]] : []);
  const scripts = [];
  const expiredCookies = [];
  const element = (dataset = {}) => ({ hidden: true, checked: false, dataset, handlers: {}, addEventListener(event, handler) { this.handlers[event] = handler; }, click() { this.handlers.click(); }, focus() {}, closest() { return null; } });
  const accept = element({ consent: 'accept' });
  const reject = element({ consent: 'reject' });
  const settings = element();
  const contact = element({ contact: 'whatsapp', placement: 'about' });
  const elements = {
    'cookie-banner': element(),
    'cookie-dialog': { ...element(), open: false, showModal() { this.open = true; }, close() { this.open = false; if (this.handlers.close) this.handlers.close(); } },
    'consent-analytics': element(),
    'consent-advertising': element(),
    'save-consent': element()
  };
  const doc = {
    title: 'Lafer Invest',
    head: { appendChild(script) { scripts.push(script); } },
    createElement() { return {}; },
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) {
      return ({ '[data-consent]': [accept, reject], '[data-cookie-settings]': [settings], '[data-contact]': [contact], '[data-cta]': [] })[selector] || [];
    }
  };
  Object.defineProperty(doc, 'cookie', { get: () => '_ga=test; _gcl_aw=test; necessary=keep', set: value => expiredCookies.push(value) });
  let reloads = 0;
  const win = {
    document: doc,
    location: { hostname, origin: 'https://' + hostname, pathname: '/enterprise-factoring-ads.html', reload() { reloads++; } },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('blocked'); return stored.get(key) || null; },
      setItem(key, value) { if (blocked) throw new Error('blocked'); stored.set(key, value); }
    }
  };
  app.init(win);
  return { win, scripts, elements, accept, reject, settings, contact, stored, expiredCookies, get reloads() { return reloads; }, commands: () => win.dataLayer.map(args => Array.from(args)) };
}

test('no optional tags before consent; rejection remains usable and persists', () => {
  const h = harness();
  assert.equal(h.scripts.length, 0);
  assert.equal(h.elements['cookie-banner'].hidden, false);
  h.reject.click();
  assert.equal(h.scripts.length, 0);
  assert.equal(h.elements['cookie-banner'].hidden, true);
  assert.equal(JSON.parse(h.stored.get(app.consentKey)).advertising, false);
  assert.equal(h.commands().filter(c => c[0] === 'event').length, 0);
});

test('analytics-only consent never configures Ads or ad personalization', () => {
  const h = harness();
  h.settings.click();
  assert.equal(h.elements['consent-analytics'].checked, false);
  assert.equal(h.elements['consent-advertising'].checked, false);
  h.elements['consent-analytics'].checked = true;
  h.elements['save-consent'].click();
  assert.equal(h.scripts.length, 1);
  assert.deepEqual(h.commands().filter(c => c[0] === 'config').map(c => c[1]), ['G-3Q66N7J22G']);
  assert.ok(h.commands().filter(c => c[0] === 'consent').every(c => c[2].ad_personalization === 'denied'));
  h.contact.click();
  const event = h.commands().find(c => c[1] === 'lafer_whatsapp_open');
  assert.equal(event[2].placement, 'about');
  assert.equal(event[2].send_to, 'G-3Q66N7J22G');
  assert.ok(!JSON.stringify(event).includes('text='));
});

test('advertising-only consent never configures Analytics or sends analytics contact events', () => {
  const h = harness();
  h.elements['consent-advertising'].checked = true;
  h.elements['save-consent'].click();
  assert.deepEqual(h.commands().filter(c => c[0] === 'config').map(c => c[1]), ['AW-17741205271']);
  h.contact.click();
  assert.equal(h.commands().filter(c => c[0] === 'event').length, 0);
});

test('accepting twice does not duplicate scripts/pageviews; revocation removes measurement cookies and reloads', () => {
  const h = harness();
  h.accept.click();
  h.accept.click();
  assert.equal(h.scripts.length, 1);
  assert.equal(h.commands().filter(c => c[0] === 'event' && c[1] === 'page_view').length, 1);
  h.reject.click();
  assert.equal(h.reloads, 1);
  assert.ok(h.expiredCookies.some(c => c.startsWith('_ga=')));
  assert.ok(h.expiredCookies.every(c => !c.startsWith('necessary=')));
  const returning = harness(JSON.parse(h.stored.get(app.consentKey)));
  assert.equal(returning.scripts.length, 0);
  assert.equal(returning.elements['cookie-banner'].hidden, true);
});

test('a saved analytics choice is honored on the next page without loading Ads', () => {
  const h = harness({ version: 1, analytics: true, advertising: false, savedAt: Date.now() });
  assert.equal(h.elements['cookie-banner'].hidden, true);
  assert.equal(h.scripts.length, 1);
  assert.deepEqual(h.commands().filter(c => c[0] === 'config').map(c => c[1]), ['G-3Q66N7J22G']);
});

test('local preview and blocked browser storage never cause unwanted measurements or errors', () => {
  const local = harness(null, '127.0.0.1');
  local.accept.click();
  local.contact.click();
  assert.equal(local.scripts.length, 0);
  assert.equal(local.commands().filter(c => c[0] === 'event').length, 0);
  const blocked = harness(null, 'www.lafersec.com.br', true);
  assert.doesNotThrow(() => blocked.reject.click());
  assert.equal(blocked.scripts.length, 0);
});

test('expired, corrupt, future and unknown-version consent records are not accepted', () => {
  const now = Date.now();
  const record = { version: 1, analytics: true, advertising: true, savedAt: now };
  for (const value of [null, 'broken', { ...record, savedAt: now - 180 * 86400000 }, { ...record, savedAt: now + 1000 }, { ...record, version: 2 }, { ...record, advertising: 'yes' }]) {
    assert.equal(app.readConsent({ getItem: () => typeof value === 'string' ? value : JSON.stringify(value) }, now), null);
  }
});

test('MG and SP product/service B2B requests prepare an encoded draft, never claim approval', () => {
  for (const state of ['MG', 'SP']) {
    for (const receivable of ['products', 'services', 'both']) {
      const result = app.prepareProposal({ state, revenue: 'from200', buyers: 'business', receivable });
      const url = new URL(result.url);
      assert.equal(url.origin, 'https://wa.me');
      assert.equal(url.pathname, '/5535998252372');
      assert.equal(url.searchParams.get('text'), result.message);
      assert.match(result.guidance, /não representa aprovação/);
      assert.match(result.message, /R\$ 200 mil/);
    }
  }
});

test('unsupported profiles get accurate service guidance and still have a human-contact path', () => {
  const result = app.prepareProposal({ state: 'other', revenue: 'under', buyers: 'consumer', receivable: 'checks' });
  assert.match(result.guidance, /Minas Gerais e São Paulo/);
  assert.match(result.guidance, /faturamento mensal mínimo/);
  assert.match(result.guidance, /Não compramos cheques/);
  assert.match(result.message, /tirar uma dúvida/);
  assert.ok(result.url.startsWith('https://wa.me/'));
});

test('incomplete or injected form options cannot become an outgoing request', () => {
  assert.throws(() => app.prepareProposal({ state: 'MG', revenue: '', buyers: 'business', receivable: 'products' }));
  assert.throws(() => app.prepareProposal({ state: 'MG', revenue: 'from200', buyers: 'business', receivable: '<script>' }));
  assert.throws(() => app.prepareProposal({ state: '__proto__', revenue: 'from200', buyers: 'business', receivable: 'products' }));
});

test('ad lengths, sitelink targets and static page dependencies are ready for upload', () => {
  const campaign = JSON.parse(fs.readFileSync(path.join(root, 'campanhas/factoring-anuncio-1.json'), 'utf8'));
  assert.equal(campaign.headlines.length, 15);
  assert.equal(campaign.descriptions.length, 4);
  campaign.headlines.forEach(h => assert.ok(h.length <= 30, h));
  campaign.descriptions.forEach(d => assert.ok(d.length <= 90, d));
  campaign.callouts.forEach(c => assert.ok(c.length <= 25, c));
  const landing = fs.readFileSync(path.join(root, 'enterprise-factoring-ads.html'), 'utf8');
  campaign.sitelinks.forEach(s => {
    assert.ok(s.text.length <= 25 && s.description_1.length <= 35 && s.description_2.length <= 35, s.text);
    assert.ok(landing.includes('id="' + s.fragment + '"'), s.fragment);
    assert.equal(new URL(s.final_url).pathname, '/enterprise-factoring-ads.html');
  });
  for (const page of ['enterprise-factoring-ads.html', 'politica-de-privacidade.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(ids.length, new Set(ids).size, 'Duplicate IDs: ' + page);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = match[1];
      if (/^(https?:|mailto:|tel:)/.test(url)) continue;
      const [file, fragment] = url.split('#');
      const target = file ? fs.readFileSync(path.join(root, file)) : Buffer.from(html);
      if (fragment) assert.ok(target.toString().includes('id="' + fragment + '"'), page + ' -> ' + url);
    }
    assert.ok(!html.includes('GTM-K2QRH89T'), 'Do not load legacy GTM alongside direct tags');
    assert.ok(!html.includes('fonts.googleapis.com'));
  }
});
