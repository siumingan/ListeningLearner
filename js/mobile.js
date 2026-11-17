/* ListeningLearner - app install (PWA), phone features, and "Use on phone" on the PC */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };

  function isPhone() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (coarse && window.innerWidth < 900);
  }
  function isLocalPC() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }
  function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  /* ---------- service worker (offline + installable) ---------- */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;
    if (LL.native && LL.native.available) return;   // the Android app already has its files built in
    navigator.serviceWorker.register('sw.js').catch(function () { /* app still works without it */ });
  }

  /* ---------- install button ---------- */
  let deferredPrompt = null;
  function setupInstall() {
    const btn = $('installBtn');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      btn.classList.remove('hidden');
    });
    btn.addEventListener('click', async function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(function () {});
        deferredPrompt = null;
        btn.classList.add('hidden');
      } else if (isIOS()) {
        LL.app.toast('On iPhone/iPad: tap the Share button ⬆, then "Add to Home Screen".');
      }
    });
    window.addEventListener('appinstalled', function () { btn.classList.add('hidden'); });
    if (isIOS() && !isStandalone()) btn.classList.remove('hidden');   // iOS has no install prompt: show the tip
  }

  /* ---------- links shared into the app (Android share sheet) ---------- */
  function sharedLinkFromUrl() {
    const q = new URLSearchParams(location.search);
    const candidates = [q.get('share_url'), q.get('share_text'), q.get('share_title')];
    for (const c of candidates) {
      const m = String(c || '').match(/https?:\/\/\S+/);
      if (m) return m[0];
    }
    return '';
  }
  function setupShareTarget() {
    const q = new URLSearchParams(location.search);
    const sharedFile = q.get('share_file');       // Android app: a shared audio/video file
    const link = sharedLinkFromUrl();
    if (!link && !sharedFile) return;
    history.replaceState(null, '', location.pathname);
    document.addEventListener('ll:server-checked', function () {
      if (sharedFile && /^\/files\/shared\/[^/]+$/.test(sharedFile)) openSharedFile(sharedFile, q.get('share_name') || 'shared file');
      else if (link) LL.app.openSharedLink(link);
    }, { once: true });
  }

  async function openSharedFile(path, name) {
    const tab = document.querySelector('.tab[data-tab="any"]');
    if (tab) tab.click();
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const file = new File([blob], name, { type: blob.type || '' });
      if (!LL.app.settings().openaiKey) {
        LL.app.toast('To make a transcript of "' + name + '", add your OpenAI API key in ⚙ Settings, then share it again.', true);
        return;
      }
      LL.pipeline.transcribeFile(file);
    } catch (e) {
      LL.app.toast('Could not open the shared file.', true);
    }
  }

  /* ---------- "Use on phone" (on the PC) ---------- */
  async function openPhoneDialog() {
    const body = $('phoneBody');
    body.innerHTML = '<p class="muted">Checking…</p>';
    $('phoneDialog').showModal();
    let info = null;
    try {
      const res = await LL.server.api('/api/phone');
      if (res.ok) info = await res.json();
    } catch (e) { /* basic mode */ }
    const esc = LL.app.escapeHtml;
    let html = '';
    if (info && info.lan && info.urls.length) {
      const url = info.urls[0];
      html += '<p><b>Your phone can use ListeningLearner now.</b> Connect it to the same Wi-Fi as this PC, then scan this code with the phone camera:</p>' +
        '<img class="qr" alt="QR code for the phone address" src="/api/phone-qr?u=' + encodeURIComponent(url) + '" onerror="this.remove()">' +
        '<p>Or type this address in the phone\'s browser:</p>' +
        info.urls.map(function (u) { return '<p class="phone-url"><code>' + esc(u) + '</code></p>'; }).join('') +
        '<p class="hint">Then add it to the home screen: <b>Android Chrome</b> ⋮ → <b>Add to Home screen</b>; <b>iPhone Safari</b> ⬆ Share → <b>Add to Home Screen</b>. ' +
        'The PC must be on, with the app window open. The key at the end of the address keeps other devices out.</p>';
    } else if (info) {
      html += '<p>To use the app on your phone with all features (downloads, AI on this PC, your library):</p>' +
        '<ol><li>Close the black app window.</li><li>Double-click <b>start-phone.bat</b> instead of start.bat.</li>' +
        '<li>Click <b>📱 Use on phone</b> again to get the QR code.</li></ol>' +
        '<p class="hint">If Windows asks about the firewall, allow access on <b>private</b> networks only.</p>';
    } else {
      html += '<p>Phone access needs the full version (Python). Install Python 3, then start the app with <b>start-phone.bat</b>.</p>';
    }
    html += '<p class="hint">Away from home? The app can also be put on a free HTTPS website and installed as a phone app that works anywhere ' +
      '(video files, YouTube, translation, clear voice, OpenAI transcription). See README → "Phone app".</p>';
    body.innerHTML = html;
  }

  function init() {
    registerServiceWorker();
    setupInstall();
    setupShareTarget();
    if (isPhone()) {
      document.body.classList.add('is-phone');
      $('pyCheckBtn').classList.add('hidden');
    }
    if (isLocalPC() && !isPhone()) {
      $('phoneBtn').classList.remove('hidden');
      $('phoneBtn').addEventListener('click', openPhoneDialog);
    }
  }

  window.LL = window.LL || {};
  window.LL.mobile = { isPhone: isPhone, isStandalone: isStandalone };
  document.addEventListener('DOMContentLoaded', init);
})();
