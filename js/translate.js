/* ListeningLearner - translation providers
 *
 * mymemory : free, no key, small daily quota (good for trying the app)
 * google   : Google Cloud Translation API (v2) with your API key
 * libre    : a LibreTranslate server (self-hosted or hosted), optional key
 */
(function (root) {
  'use strict';

  const cache = new Map();

  function cacheKey(provider, text, source, target) {
    return provider + '|' + source + '|' + target + '|' + text;
  }

  function decodeEntities(s) {
    if (typeof document === 'undefined') return s;
    const el = document.createElement('textarea');
    el.innerHTML = s;
    return el.value;
  }

  async function viaMyMemory(text, source, target, settings) {
    const params = new URLSearchParams({ q: text, langpair: source + '|' + target });
    if (settings.myMemoryEmail) params.set('de', settings.myMemoryEmail);
    const res = await fetch('https://api.mymemory.translated.net/get?' + params.toString());
    if (!res.ok) throw new Error('MyMemory error ' + res.status);
    const data = await res.json();
    if (data.responseStatus && Number(data.responseStatus) !== 200) {
      throw new Error('MyMemory: ' + (data.responseDetails || 'request failed'));
    }
    const out = data && data.responseData && data.responseData.translatedText;
    if (!out) throw new Error('MyMemory returned no translation');
    if (/MYMEMORY WARNING/i.test(out)) throw new Error('MyMemory free daily quota used up. Add an email in Settings or switch provider.');
    return decodeEntities(out);
  }

  async function viaGoogle(text, source, target, settings) {
    if (!settings.googleTranslateKey) throw new Error('Add a Google Cloud Translation API key in Settings.');
    const res = await fetch('https://translation.googleapis.com/language/translate/v2?key=' +
      encodeURIComponent(settings.googleTranslateKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: source, target: target, format: 'text' })
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error('Google Translate: ' + ((data.error && data.error.message) || res.status));
    return data.data.translations[0].translatedText;
  }

  async function viaLibre(text, source, target, settings) {
    const base = (settings.libreUrl || '').replace(/\/+$/, '');
    if (!base) throw new Error('Add a LibreTranslate server URL in Settings.');
    const body = { q: text, source: source.split('-')[0], target: target.split('-')[0], format: 'text' };
    if (settings.libreKey) body.api_key = settings.libreKey;
    const res = await fetch(base + '/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error('LibreTranslate: ' + (data.error || res.status));
    return data.translatedText;
  }

  const PROVIDERS = { mymemory: viaMyMemory, google: viaGoogle, libre: viaLibre };

  /** Translate one line. Results are cached per provider/language pair. */
  async function translate(text, source, target, settings) {
    const provider = settings.translateProvider || 'mymemory';
    if (!text) return '';
    if (source && target && source.toLowerCase() === target.toLowerCase()) return text;
    const key = cacheKey(provider, text, source, target);
    if (cache.has(key)) return cache.get(key);
    const fn = PROVIDERS[provider];
    if (!fn) throw new Error('Unknown translation provider: ' + provider);
    const promise = fn(text.replace(/\n/g, ' '), source, target, settings).catch(function (e) {
      if (e instanceof TypeError) throw new Error('Translation service unreachable. Check the internet connection.');
      throw e;
    });
    cache.set(key, promise);
    try {
      const out = await promise;
      cache.set(key, out);
      return out;
    } catch (e) {
      cache.delete(key);
      throw e;
    }
  }

  root.LL = root.LL || {};
  root.LL.translate = { translate: translate, providers: Object.keys(PROVIDERS) };
})(typeof window !== 'undefined' ? window : globalThis);
