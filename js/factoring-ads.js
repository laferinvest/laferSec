(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) api.init(root);
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  var CONSENT_KEY = 'lafer_privacy_v1';
  var CONSENT_DAYS = 180;
  var REFERENCE_KEY = 'lafer_contact_reference_v1';
  var REFERENCE_PATTERN = /^LAF-[2-9A-HJ-NP-Z]{10}$/;
  var ANALYTICS_ID = 'G-3Q66N7J22G';
  var ADS_ID = 'AW-17741205271';
  var LIVE_HOSTS = ['lafersec.com.br', 'www.lafersec.com.br'];
  var labels = {
    state: { MG: 'Minas Gerais', SP: 'São Paulo', other: 'Outro estado' },
    revenue: { under: 'Abaixo de R$ 200 mil', from200: 'De R$ 200 mil a R$ 1 milhão', from1m: 'De R$ 1 milhão a R$ 5 milhões', from5m: 'De R$ 5 milhões a R$ 10 milhões', over10m: 'Acima de R$ 10 milhões' },
    buyers: { business: 'Outras empresas', both: 'Empresas e pessoas físicas', consumer: 'Somente pessoas físicas' },
    receivable: { products: 'Duplicatas comerciais de produtos', services: 'Duplicatas comerciais de serviços', both: 'Duplicatas de produtos e serviços', checks: 'Cheques', other: 'Outro tipo de recebível' }
  };

  function readConsent(storage, now) {
    try {
      var value = JSON.parse(storage.getItem(CONSENT_KEY));
      if (!value || value.version !== 1 || typeof value.analytics !== 'boolean' || typeof value.advertising !== 'boolean' || !Number.isFinite(value.savedAt) || now < value.savedAt || now - value.savedAt >= CONSENT_DAYS * 86400000) return null;
      return value;
    } catch (_) { return null; }
  }

  function consentSignals(choice) {
    return {
      analytics_storage: choice && choice.analytics ? 'granted' : 'denied',
      ad_storage: choice && choice.advertising ? 'granted' : 'denied',
      ad_user_data: choice && choice.advertising ? 'granted' : 'denied',
      ad_personalization: 'denied'
    };
  }

  function measurementLocation(location, choice) {
    // Keep attribution/debugging parameters, never copy arbitrary query data or fragments.
    var incoming = new URLSearchParams(location.search || '');
    var retained = new URLSearchParams();
    var keys = [];
    if (choice && choice.analytics) keys = keys.concat(['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content', '_dbg']);
    if (choice && choice.advertising) keys = keys.concat(['gclid', 'gbraid', 'wbraid', 'dclid', 'gad_source', 'gad_campaignid']);
    keys.forEach(function (key) {
      var value = incoming.get(key);
      if (value) retained.set(key, value);
    });
    var query = retained.toString();
    return location.origin + location.pathname + (query ? '?' + query : '');
  }

  function createContactReference(cryptoApi) {
    var alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var bytes = new Uint8Array(10);
    try {
      if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') throw new Error('Unavailable');
      cryptoApi.getRandomValues(bytes);
    } catch (_) {
      // A contact reference is not a password or an authentication token.
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return 'LAF-' + Array.from(bytes, function (byte) { return alphabet[byte & 31]; }).join('');
  }

  function withContactReference(message, reference) {
    if (!REFERENCE_PATTERN.test(reference)) throw new Error('Referência de atendimento inválida.');
    return message.replace(/\n*Referência: LAF-[2-9A-HJ-NP-Z]{10}\s*$/, '') + '\n\nReferência: ' + reference;
  }

  function whatsappWithReference(href, reference) {
    var url = new URL(href);
    if (url.origin !== 'https://wa.me' || url.pathname !== '/5535997735926') throw new Error('Destino de atendimento inválido.');
    url.searchParams.set('text', withContactReference(url.searchParams.get('text') || '', reference));
    return url.toString();
  }

  function prepareProposal(input, reference) {
    Object.keys(labels).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(labels[key], input[key])) throw new Error('Selecione todas as informações da empresa.');
    });
    var notes = [];
    if (input.state === 'other') notes.push('Atendemos empresas de Minas Gerais e São Paulo.');
    if (input.revenue === 'under') notes.push('O faturamento mensal mínimo atendido é de R$ 200 mil.');
    if (input.buyers === 'consumer') notes.push('Compramos apenas recebíveis de vendas para outras empresas.');
    if (input.receivable === 'checks' || input.receivable === 'other') notes.push('Trabalhamos apenas com duplicatas comerciais de produtos e serviços. Não compramos cheques.');
    var message = [
      'Olá, equipe Lafer! Gostaria de saber mais sobre as suas operações e taxas.',
      '',
      'Estado da empresa: ' + labels.state[input.state],
      'Faturamento mensal: ' + labels.revenue[input.revenue],
      'Minha empresa vende para: ' + labels.buyers[input.buyers],
      'Recebíveis: ' + labels.receivable[input.receivable]
    ].join('\n');
    if (reference) message = withContactReference(message, reference);
    return {
      message: message,
      guidance: notes.length ? notes.join(' ') + ' Se quiser esclarecer o enquadramento da sua empresa, converse com a equipe.' : 'Confira a mensagem abaixo e continue no WhatsApp. A equipe analisará os recebíveis e informará as condições; esta etapa não representa aprovação.',
      url: 'https://wa.me/5535997735926?text=' + encodeURIComponent(message)
    };
  }

  function init(win) {
    var doc = win.document;
    var storage;
    try { storage = win.localStorage; } catch (_) { storage = { getItem: function () { return null; }, setItem: function () {} }; }
    var choice = readConsent(storage, Date.now());
    var tagLoaded = false;
    var analyticsConfigured = false;
    var advertisingConfigured = false;
    var live = LIVE_HOSTS.indexOf(win.location.hostname) !== -1;
    var prepared = null;
    var whatsappOpening = false;
    var lastConsentOpener = null;
    var contactReference = null;

    function getContactReference() {
      if (contactReference) return contactReference;
      try {
        var savedReference = win.sessionStorage.getItem(REFERENCE_KEY);
        if (REFERENCE_PATTERN.test(savedReference)) contactReference = savedReference;
      } catch (_) { /* Contact preparation also works with browser storage blocked. */ }
      if (!contactReference) {
        contactReference = createContactReference(win.crypto);
        try { win.sessionStorage.setItem(REFERENCE_KEY, contactReference); } catch (_) {}
      }
      return contactReference;
    }

    // Use the existing public measurement IDs, without the legacy GTM timer/scroll conversions.
    // No Google script or measurement request is made until an optional purpose is accepted.
    win.dataLayer = win.dataLayer || [];
    function gtag() { win.dataLayer.push(arguments); }
    gtag('consent', 'default', consentSignals(null));
    gtag('set', 'ads_data_redaction', true);
    gtag('set', 'url_passthrough', false);

    function loadMeasurement() {
      if (!live || !choice || (!choice.analytics && !choice.advertising)) return;
      gtag('consent', 'update', consentSignals(choice));
      if (!tagLoaded) {
        tagLoaded = true;
        gtag('js', new Date());
        var script = doc.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + (choice.analytics ? ANALYTICS_ID : ADS_ID);
        doc.head.appendChild(script);
      }
      var attributedLocation = measurementLocation(win.location, choice);
      if (choice.analytics && !analyticsConfigured) {
        analyticsConfigured = true;
        gtag('config', ANALYTICS_ID, {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          cookie_expires: CONSENT_DAYS * 86400,
          cookie_update: false,
          page_location: attributedLocation,
          page_referrer: ''
        });
        gtag('event', 'page_view', { send_to: ANALYTICS_ID, page_location: attributedLocation, page_title: doc.title, page_referrer: '' });
      }
      if (choice.advertising && !advertisingConfigured) {
        advertisingConfigured = true;
        gtag('config', ADS_ID, { allow_ad_personalization_signals: false, page_location: attributedLocation });
      }
    }

    // Never send the form answers, WhatsApp message, contact data or a "qualified lead" event.
    function track(name, placement, flow, onProcessed) {
      if (!live || !choice || !choice.analytics) return false;
      var params = { send_to: ANALYTICS_ID, page_location: measurementLocation(win.location, choice), placement: placement };
      if (flow) params.contact_flow = flow;
      if (onProcessed) {
        params.event_callback = onProcessed;
        params.event_timeout = 800;
      }
      gtag('event', name, params);
      return true;
    }

    function clearMeasurementCookies() {
      var cookies = doc.cookie.split(';');
      var domains = ['', win.location.hostname, '.' + win.location.hostname, '.lafersec.com.br'];
      cookies.forEach(function (cookie) {
        var name = cookie.split('=')[0].trim();
        if (!/^(_ga($|_)|_gid$|_gat($|_)|_gcl_)/.test(name)) return;
        domains.forEach(function (domain) {
          doc.cookie = name + '=; Max-Age=0; path=/; SameSite=Lax' + (domain ? '; domain=' + domain : '');
        });
      });
    }

    var banner = doc.getElementById('cookie-banner');
    var dialog = doc.getElementById('cookie-dialog');
    var analyticsInput = doc.getElementById('consent-analytics');
    var advertisingInput = doc.getElementById('consent-advertising');

    function applyChoice(analytics, advertising) {
      var previous = choice;
      choice = { version: 1, analytics: analytics, advertising: advertising, savedAt: Date.now() };
      try { storage.setItem(CONSENT_KEY, JSON.stringify(choice)); } catch (_) { /* The current visit still honors the choice when storage is blocked. */ }
      gtag('consent', 'update', consentSignals(choice));
      if (banner) banner.hidden = true;
      if (dialog && dialog.open) dialog.close();
      var revoked = previous && ((previous.analytics && !analytics) || (previous.advertising && !advertising));
      if (revoked) {
        clearMeasurementCookies();
        // A fresh document also removes already-loaded scripts, rather than leaving a tag running.
        if (tagLoaded) { win.location.reload(); return; }
      }
      if (!analytics && !advertising) clearMeasurementCookies();
      loadMeasurement();
    }

    doc.querySelectorAll('[data-consent]').forEach(function (button) {
      button.addEventListener('click', function () { var accepted = button.dataset.consent === 'accept'; applyChoice(accepted, accepted); });
    });
    doc.querySelectorAll('[data-cookie-settings]').forEach(function (button) {
      button.hidden = false;
      button.addEventListener('click', function () {
        if (!dialog) return;
        lastConsentOpener = button;
        analyticsInput.checked = !!(choice && choice.analytics);
        advertisingInput.checked = !!(choice && choice.advertising);
        dialog.showModal();
      });
    });
    var saveButton = doc.getElementById('save-consent');
    if (saveButton) saveButton.addEventListener('click', function () { applyChoice(analyticsInput.checked, advertisingInput.checked); });
    if (dialog) dialog.addEventListener('close', function () { if (lastConsentOpener && !lastConsentOpener.closest('[hidden]')) lastConsentOpener.focus(); });
    if (banner) banner.hidden = !!choice;
    loadMeasurement();

    doc.querySelectorAll('[data-cta]').forEach(function (link) {
      link.addEventListener('click', function () { track('lafer_cta_click', link.dataset.cta); });
    });
    doc.querySelectorAll('[data-contact]').forEach(function (link) {
      link.addEventListener('click', function () {
        if (link.dataset.contact === 'whatsapp') link.setAttribute('href', whatsappWithReference(link.getAttribute('href'), getContactReference()));
        track('lafer_' + link.dataset.contact + '_open', link.dataset.placement, 'direct');
      });
    });

    var form = doc.getElementById('proposal-form');
    var result = doc.getElementById('proposal-result');
    if (form && result) {
      form.hidden = false;
      doc.getElementById('proposal-fallback').hidden = true;
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!form.reportValidity()) return;
        prepared = prepareProposal({ state: doc.getElementById('company-state').value, revenue: doc.getElementById('company-revenue').value, buyers: doc.getElementById('company-buyers').value, receivable: doc.getElementById('receivable-type').value }, getContactReference());
        doc.getElementById('message-preview').textContent = prepared.message;
        doc.getElementById('result-guidance').textContent = prepared.guidance;
        form.hidden = true;
        result.hidden = false;
        result.focus({ preventScroll: true });
        result.scrollIntoView({ behavior: 'auto', block: 'center' });
        track('lafer_proposal_prepared', 'proposal');
      });
      doc.getElementById('edit-proposal').addEventListener('click', function () {
        result.hidden = true;
        form.hidden = false;
        prepared = null;
        doc.getElementById('company-state').focus();
      });
      doc.getElementById('open-whatsapp').addEventListener('click', function () {
        if (!prepared || whatsappOpening) return;
        whatsappOpening = true;
        var destination = prepared.url;
        var navigated = false;
        var fallback = null;
        function openWhatsApp() {
          if (navigated) return;
          navigated = true;
          if (fallback !== null) win.clearTimeout(fallback);
          whatsappOpening = false;
          win.location.assign(destination);
        }
        // A button avoids exposing the prepared message to automatic outbound-link analytics.
        // Give the tag time to process the event before leaving, with a fallback if it is blocked.
        if (track('lafer_whatsapp_open', 'proposal', 'form', openWhatsApp)) {
          if (!navigated) fallback = win.setTimeout(openWhatsApp, 800);
        } else openWhatsApp();
      });
    }

    var proposal = doc.getElementById('solicitar-proposta');
    if (proposal && 'IntersectionObserver' in win) {
      var observer = new win.IntersectionObserver(function (entries) { entries.forEach(function (entry) { entry.target.classList.toggle('is-visible', entry.isIntersecting); }); }, { threshold: 0.05 });
      observer.observe(proposal);
      var hero = doc.getElementById('inicio');
      if (hero) observer.observe(hero);
    }
  }

  return { init: init, readConsent: readConsent, consentSignals: consentSignals, prepareProposal: prepareProposal, createContactReference: createContactReference, withContactReference: withContactReference, whatsappWithReference: whatsappWithReference, consentKey: CONSENT_KEY, referenceKey: REFERENCE_KEY };
});
