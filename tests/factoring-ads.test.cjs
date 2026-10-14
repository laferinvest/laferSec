const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../js/factoring-ads.js');
const root = path.resolve(__dirname, '..');

function harness(saved, hostname = 'www.lafersec.com.br', blocked = false, options = {}) {
  const stored = new Map(saved ? [[app.consentKey, JSON.stringify(saved)]] : []);
  const sessionStored = options.sessionStored || new Map();
  const scripts = [];
  const expiredCookies = [];
  const element = (dataset = {}) => ({ hidden: true, checked: false, dataset, attributes: {}, handlers: {}, addEventListener(event, handler) { this.handlers[event] = handler; }, getAttribute(name) { return this.attributes[name] || null; }, setAttribute(name, value) { this.attributes[name] = value; }, click() { this.handlers.click(); }, focus() {}, closest() { return null; } });
  const accept = element({ consent: 'accept' });
  const reject = element({ consent: 'reject' });
  const settings = element();
  const contact = element({ contact: 'whatsapp', placement: 'about' });
  const directProposal = element({ contact: 'whatsapp', placement: 'proposal' });
  contact.setAttribute('href', 'https://wa.me/5535997735926?text=' + encodeURIComponent('Olá! Gostaria de conversar sobre antecipação de duplicatas comerciais B2B.'));
  directProposal.setAttribute('href', 'https://wa.me/5535997735926?text=' + encodeURIComponent('Bom dia, equipe Lafer. Gostaria de obter mais informações sobre as suas taxas e operações'));
  const phone = element({ contact: 'phone', placement: 'footer' });
  const email = element({ contact: 'email', placement: 'about' });
  const cta = element({ cta: 'hero' });
  const elements = {
    'cookie-banner': element(),
    'cookie-dialog': { ...element(), open: false, showModal() { this.open = true; }, close() { this.open = false; if (this.handlers.close) this.handlers.close(); } },
    'consent-analytics': element(),
    'consent-advertising': element(),
    'save-consent': element()
  };
  if (options.form) {
    Object.assign(elements, {
      'proposal-form': { ...element(), reportValidity: () => options.valid !== false },
      'proposal-result': { ...element(), scrollIntoView() {} },
      'proposal-fallback': element(),
      'company-state': { ...element(), value: 'MG' },
      'company-revenue': { ...element(), value: 'from200' },
      'company-buyers': { ...element(), value: 'business' },
      'receivable-type': { ...element(), value: 'products' },
      'message-preview': element(),
      'result-guidance': element(),
      'edit-proposal': element(),
      'open-whatsapp': element()
    });
  }
  const doc = {
    title: 'Lafer Invest',
    head: { appendChild(script) { scripts.push(script); } },
    createElement() { return {}; },
    getElementById(id) { return elements[id] || null; },
    querySelectorAll(selector) {
      return ({ '[data-consent]': [accept, reject], '[data-cookie-settings]': [settings], '[data-contact]': [contact, directProposal, phone, email], '[data-cta]': [cta] })[selector] || [];
    }
  };
  Object.defineProperty(doc, 'cookie', { get: () => '_ga=test; _gcl_aw=test; necessary=keep', set: value => expiredCookies.push(value) });
  let reloads = 0;
  const navigations = [];
  const timers = new Map();
  let nextTimer = 0;
  const win = {
    document: doc,
    location: { hostname, origin: 'https://' + hostname, pathname: '/enterprise-factoring-ads.html', reload() { reloads++; }, assign(url) { navigations.push(url); } },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    crypto: require('node:crypto').webcrypto,
    sessionStorage: {
      getItem(key) { if (options.sessionBlocked) throw new Error('blocked'); return sessionStored.get(key) || null; },
      setItem(key, value) { if (options.sessionBlocked) throw new Error('blocked'); sessionStored.set(key, value); }
    },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('blocked'); return stored.get(key) || null; },
      setItem(key, value) { if (blocked) throw new Error('blocked'); stored.set(key, value); }
    }
  };
  app.init(win);
  return { win, scripts, elements, accept, reject, settings, contact, directProposal, phone, email, cta, stored, sessionStored, expiredCookies, navigations, timers, flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); }, get reloads() { return reloads; }, commands: () => win.dataLayer.map(args => Array.from(args)) };
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
      assert.equal(url.pathname, '/5535997735926');
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
  assert.match(result.message, /saber mais sobre as suas operações e taxas/);
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

test('every CTA and contact type emits one correctly classified event without contact payloads', () => {
  const h = harness();
  h.accept.click();
  h.cta.click();
  h.contact.click();
  h.directProposal.click();
  h.phone.click();
  h.email.click();
  const events = h.commands().filter(c => c[0] === 'event' && c[1] !== 'page_view');
  assert.deepEqual(events.map(c => [c[1], c[2].placement]), [
    ['lafer_cta_click', 'hero'], ['lafer_whatsapp_open', 'about'],
    ['lafer_whatsapp_open', 'proposal'], ['lafer_phone_open', 'footer'], ['lafer_email_open', 'about']
  ]);
  assert.equal(events[1][2].contact_flow, 'direct');
  assert.equal(events[2][2].contact_flow, 'direct');
  assert.ok(events.every(c => c[2].send_to === 'G-3Q66N7J22G'));
  assert.ok(!/text=|99773|@|from200|products/.test(JSON.stringify(events)));
});

test('incomplete form and WhatsApp before preparing a proposal never trigger contact events', () => {
  const h = harness(null, 'www.lafersec.com.br', false, { form: true, valid: false });
  h.accept.click();
  h.elements['open-whatsapp'].click();
  h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  assert.equal(h.commands().filter(c => c[0] === 'event' && c[1] !== 'page_view').length, 0);
  assert.equal(h.navigations.length, 0);
  assert.equal(h.elements['proposal-result'].hidden, true);
});

test('form preparation is not a lead; WhatsApp waits for event processing and navigates once', () => {
  const h = harness(null, 'www.lafersec.com.br', false, { form: true });
  h.accept.click();
  h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  assert.equal(h.elements['proposal-form'].hidden, true);
  assert.equal(h.elements['proposal-result'].hidden, false);
  assert.equal(h.commands().filter(c => c[1] === 'lafer_proposal_prepared').length, 1);
  assert.equal(h.commands().filter(c => c[1] === 'lafer_whatsapp_open').length, 0);
  h.elements['open-whatsapp'].click();
  h.elements['open-whatsapp'].click();
  const events = h.commands().filter(c => c[1] === 'lafer_whatsapp_open');
  assert.equal(events.length, 1);
  assert.equal(events[0][2].contact_flow, 'form');
  assert.equal(events[0][2].placement, 'proposal');
  assert.equal(h.navigations.length, 0);
  assert.equal(typeof events[0][2].event_callback, 'function');
  assert.equal(events[0][2].event_timeout, 800);
  events[0][2].event_callback();
  h.flushTimers();
  assert.equal(h.navigations.length, 1);
  assert.equal(new URL(h.navigations[0]).pathname, '/5535997735926');
  assert.ok(!/Estado|faturamento|Recebíveis|text=/.test(JSON.stringify(events)));
});

test('a blocked Google script cannot prevent WhatsApp opening after the fallback timeout', () => {
  const h = harness(null, 'www.lafersec.com.br', false, { form: true });
  h.accept.click();
  h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  h.elements['open-whatsapp'].click();
  assert.equal(h.navigations.length, 0);
  h.flushTimers();
  assert.equal(h.navigations.length, 1);
  h.commands().find(c => c[1] === 'lafer_whatsapp_open')[2].event_callback();
  assert.equal(h.navigations.length, 1);
});

test('without analytics consent or on localhost, the complete form still opens WhatsApp immediately', () => {
  for (const mode of ['reject', 'advertising', 'localhost']) {
    const h = harness(null, mode === 'localhost' ? '127.0.0.1' : 'www.lafersec.com.br', false, { form: true });
    if (mode === 'advertising') {
      h.elements['consent-advertising'].checked = true;
      h.elements['save-consent'].click();
    } else if (mode === 'localhost') h.accept.click();
    else h.reject.click();
    h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
    h.elements['open-whatsapp'].click();
    assert.equal(h.navigations.length, 1, mode);
    assert.equal(h.timers.size, 0, mode);
    assert.equal(h.commands().filter(c => c[0] === 'event').length, 0, mode);
  }
});

test('editing a proposal clears the previous draft and does not emit a WhatsApp event', () => {
  const h = harness(null, 'www.lafersec.com.br', false, { form: true });
  h.accept.click();
  h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  h.elements['edit-proposal'].click();
  h.elements['open-whatsapp'].click();
  assert.equal(h.elements['proposal-form'].hidden, false);
  assert.equal(h.elements['proposal-result'].hidden, true);
  assert.equal(h.commands().filter(c => c[1] === 'lafer_whatsapp_open').length, 0);
  assert.equal(h.navigations.length, 0);
});

test('actual landing contact links and CTA targets match the event classifications', () => {
  const html = fs.readFileSync(path.join(root, 'enterprise-factoring-ads.html'), 'utf8');
  const contacts = [...html.matchAll(/<a\b[^>]*\bdata-contact="[^"]+"[^>]*>/g)].map(m => m[0]);
  assert.equal(contacts.length, 6);
  for (const contact of contacts) {
    const kind = contact.match(/data-contact="([^"]+)"/)[1];
    const href = contact.match(/href="([^"]+)"/)[1];
    assert.match(contact, /data-placement="(?:about|proposal|footer)"/);
    assert.equal(kind, href.startsWith('https://wa.me/') ? 'whatsapp' : href.startsWith('tel:') ? 'phone' : 'email');
  }
  const ctas = [...html.matchAll(/<a\b[^>]*\bdata-cta="[^"]+"[^>]*>/g)].map(m => m[0]);
  assert.equal(ctas.length, 6);
  assert.ok(ctas.every(cta => cta.includes('href="#solicitar-proposta"')));
});

test('contact references are short, random and contain no company details or tracking parameters', () => {
  const crypto = require('node:crypto').webcrypto;
  const references = new Set(Array.from({ length: 1000 }, () => app.createContactReference(crypto)));
  assert.equal(references.size, 1000);
  for (const reference of references) assert.match(reference, /^LAF-[2-9A-HJ-NP-Z]{10}$/);
  assert.match(app.createContactReference(null), /^LAF-[2-9A-HJ-NP-Z]{10}$/);
  assert.throws(() => app.withContactReference('Olá', 'LAF-FAKE\nInjected'));
  assert.throws(() => app.whatsappWithReference('https://example.com/', 'LAF-23456789AB'));
});

test('form preview and outgoing WhatsApp message contain the same reference exactly once', () => {
  const h = harness(null, 'www.lafersec.com.br', false, { form: true });
  h.reject.click();
  h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  const preview = h.elements['message-preview'].textContent;
  const reference = h.sessionStored.get(app.referenceKey);
  assert.match(reference, /^LAF-[2-9A-HJ-NP-Z]{10}$/);
  assert.ok(preview.endsWith('Referência: ' + reference));
  h.elements['open-whatsapp'].click();
  assert.equal(new URL(h.navigations[0]).searchParams.get('text'), preview);
  h.elements['edit-proposal'].click();
  h.elements['receivable-type'].value = 'services';
  h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  const edited = h.elements['message-preview'].textContent;
  assert.ok(edited.endsWith('Referência: ' + reference));
  assert.equal((edited.match(/Referência:/g) || []).length, 1);
  assert.match(edited, /Duplicatas comerciais de serviços/);
});

test('direct links and form share a reference in the same tab, including a reload', () => {
  const sessionStored = new Map();
  const h = harness(null, 'www.lafersec.com.br', false, { form: true, sessionStored });
  assert.equal(sessionStored.size, 0, 'Do not allocate a reference before contact interaction');
  h.contact.click();
  h.directProposal.click();
  h.directProposal.click();
  const reference = sessionStored.get(app.referenceKey);
  const directMessage = new URL(h.directProposal.getAttribute('href')).searchParams.get('text');
  assert.ok(directMessage.startsWith('Bom dia, equipe Lafer. Gostaria de obter mais informações sobre as suas taxas e operações'));
  assert.ok(directMessage.endsWith('Referência: ' + reference));
  assert.equal((directMessage.match(/Referência:/g) || []).length, 1);
  assert.ok(new URL(h.contact.getAttribute('href')).searchParams.get('text').endsWith('Referência: ' + reference));
  const returning = harness(null, 'www.lafersec.com.br', false, { form: true, sessionStored });
  returning.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  assert.ok(returning.elements['message-preview'].textContent.endsWith('Referência: ' + reference));
});

test('blocked session storage and malformed stored references never break contact preparation', () => {
  const sessionStored = new Map([[app.referenceKey, 'LAF-injected\nState: other']]);
  const malformed = harness(null, 'www.lafersec.com.br', false, { form: true, sessionStored });
  malformed.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  assert.match(sessionStored.get(app.referenceKey), /^LAF-[2-9A-HJ-NP-Z]{10}$/);
  const blocked = harness(null, '127.0.0.1', true, { form: true, sessionBlocked: true });
  assert.doesNotThrow(() => blocked.contact.click());
  blocked.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  blocked.elements['open-whatsapp'].click();
  assert.ok(new URL(blocked.navigations[0]).searchParams.get('text').includes('Referência: LAF-'));
  assert.equal(blocked.scripts.length, 0);
});

test('custom analytics events do not include the reference, WhatsApp message or click identifiers', () => {
  const h = harness(null, 'www.lafersec.com.br', false, { form: true });
  h.accept.click();
  h.contact.click();
  h.elements['proposal-form'].handlers.submit({ preventDefault() {} });
  h.elements['open-whatsapp'].click();
  const payload = JSON.stringify(h.commands());
  assert.ok(!payload.includes(h.sessionStored.get(app.referenceKey)));
  assert.ok(!/Referência|gclid|gbraid|wbraid/.test(payload));
});
