/* ListeningLearner - connection to the Android app (window.LLNative, provided by NativeBridge.kt)
 * In a normal browser LLNative does not exist and LL.native.available is false. */
(function (root) {
  'use strict';
  const N = root.LLNative;
  const listeners = new Set();

  // the Android app calls this with a JSON string for every event (download progress, speech...)
  root.LLNativeEvent = function (json) {
    let ev;
    try { ev = JSON.parse(json); } catch (e) { return; }
    listeners.forEach(function (fn) { try { fn(ev); } catch (e) { /* keep other listeners running */ } });
  };

  function parse(s, fallback) { try { return JSON.parse(s); } catch (e) { return fallback; } }
  function newId() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  const api = {
    available: !!N,
    on: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
    status: function () { return N ? parse(N.status(), {}) : {}; },

    /** Start a download; returns the job id. Events: {type:'job', jobId, status, step, progress, message, item?, error?} */
    download: function (url, options) {
      const id = newId();
      N.download(id, url, JSON.stringify(options || {}));
      return id;
    },
    cancel: function (id) { if (N) N.cancel(id); },
    updateDownloader: function () { if (N) N.updateDownloader(); },
    listItems: function () { return N ? parse(N.listItems(), []) : []; },
    deleteItem: function (id) { return N ? N.deleteItem(id) : false; },
    saveTranscript: function (id, srt, lang) { return N ? parse(N.saveTranscript(id, srt, lang || ''), null) : null; },

    // text-to-speech
    ttsAvailable: function () { try { return !!(N && N.ttsAvailable()); } catch (e) { return false; } },
    hasVoice: function (lang) { try { return !!(N && N.hasVoice(lang)); } catch (e) { return false; } },
    speak: function (id, text, lang, rate) { N.speak(id, text, lang || '', rate || 1); },
    stopSpeaking: function () { if (N) N.stopSpeaking(); },
    newId: newId
  };

  root.LL = root.LL || {};
  root.LL.native = api;
})(window);
