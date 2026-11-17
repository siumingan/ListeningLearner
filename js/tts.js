/* ListeningLearner - text-to-speech using the browser's built-in voices (Web Speech API) */
(function (root) {
  'use strict';

  const synth = root.speechSynthesis;
  let voices = [];

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices() || [];
  }
  if (synth) {
    loadVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
    else synth.onvoiceschanged = loadVoices;
  }

  // In the Android app the WebView has no speechSynthesis: Android's own voice engine is used instead
  function useNative() { return !(synth && typeof root.SpeechSynthesisUtterance === 'function') && !!(root.LL && LL.native && LL.native.available); }

  function isSupported() {
    if (synth && typeof root.SpeechSynthesisUtterance === 'function') return true;
    return !!(root.LL && LL.native && LL.native.ttsAvailable());
  }

  /** Best voice for a BCP-47 tag: exact match, then same language, prefer natural/online voices. */
  function pickVoice(lang) {
    if (useNative()) return LL.native.hasVoice(lang) ? { name: 'Android voice (' + lang + ')' } : null;
    if (!voices.length) loadVoices();
    if (!lang) return null;
    const want = lang.toLowerCase().replace('_', '-');
    const base = want.split('-')[0];
    const score = function (v) {
      const vl = (v.lang || '').toLowerCase().replace('_', '-');
      let s = 0;
      if (vl === want) s += 10; else if (vl.split('-')[0] === base) s += 5; else return -1;
      if (/natural|neural|online|google|premium|enhanced/i.test(v.name)) s += 2;
      return s;
    };
    let best = null, bestScore = -1;
    for (const v of voices) {
      const s = score(v);
      if (s > bestScore) { best = v; bestScore = s; }
    }
    return bestScore >= 0 ? best : null;
  }

  function hasVoiceFor(lang) { return !!pickVoice(lang); }

  /**
   * Speak text. Returns a promise that resolves when speech ends.
   * opts: { lang, rate, onBoundary(charIndex, charLength) }
   */
  let nativePending = null;   // { off, resolve } of the line being spoken
  function finishNative() {
    if (!nativePending) return;
    const p = nativePending;
    nativePending = null;
    p.off();
    p.resolve();
  }
  function speakNative(text, opts) {
    finishNative();
    return new Promise(function (resolve, reject) {
      const id = LL.native.newId();
      const off = LL.native.on(function (ev) {
        if (ev.type !== 'tts' || ev.id !== id) return;
        if (ev.event === 'boundary' && opts.onBoundary) opts.onBoundary(ev.start, ev.end - ev.start);
        if (ev.event === 'end') finishNative();
        if (ev.event === 'error') {
          nativePending = null; off();
          reject(new Error('Text-to-speech failed. Check the voice data in Android settings.'));
        }
      });
      nativePending = { off: off, resolve: resolve };
      LL.native.speak(id, text, opts.lang, opts.rate || 1);
    });
  }

  function speak(text, opts) {
    opts = opts || {};
    if (useNative()) {
      if (!LL.native.ttsAvailable()) return Promise.reject(new Error('Android text-to-speech is not ready. Check Settings → Text-to-speech on the phone.'));
      return speakNative(text, opts);
    }
    return new Promise(function (resolve, reject) {
      if (!isSupported()) { reject(new Error('This browser has no text-to-speech support.')); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (opts.lang) u.lang = opts.lang;
      const v = pickVoice(opts.lang);
      if (v) u.voice = v;
      u.rate = opts.rate || 1;
      u.onend = function () { resolve(); };
      u.onerror = function (e) {
        if (e.error === 'canceled' || e.error === 'interrupted') resolve();
        else reject(new Error('Speech error: ' + e.error));
      };
      if (opts.onBoundary) {
        u.onboundary = function (e) {
          if (e.name === 'word' || e.name === undefined) opts.onBoundary(e.charIndex, e.charLength || 0);
        };
      }
      synth.speak(u);
    });
  }

  function stop() {
    if (synth) synth.cancel();
    if (root.LL && LL.native && LL.native.available) {
      LL.native.stopSpeaking();
      finishNative();
    }
  }

  root.LL = root.LL || {};
  root.LL.tts = { isSupported, speak, stop, hasVoiceFor, pickVoice };
})(typeof window !== 'undefined' ? window : globalThis);
