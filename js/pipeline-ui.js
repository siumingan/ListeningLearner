/* ListeningLearner - "Any site: download & transcribe" screen
 * Talks to the local Python server (server.py): /api/health, /api/jobs, /api/upload, /api/library
 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  let serverOk = false;
  let polling = null;

  function app() { return LL.app; }
  function esc(s) { return LL.app.escapeHtml(s == null ? '' : s); }

  function init() {
    const langSel = $('pipeLang');
    LL.languages.LANGUAGES.forEach(function (l) {
      const o = document.createElement('option');
      o.value = l.code; o.textContent = l.name;
      langSel.appendChild(o);
    });
    const s = app().settings();
    langSel.value = s.pipeLang || 'auto';
    $('pipeEngine').value = s.pipeEngine || 'local';
    $('pipeModel').value = s.pipeModel || 'small';
    $('pipeKeepVideo').checked = !!s.pipeKeepVideo;
    updateEngine();

    ['pipeLang', 'pipeEngine', 'pipeModel'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        app().settings()[id] = this.value; app().saveSettings(); updateEngine();
      });
    });
    $('pipeKeepVideo').addEventListener('change', function () {
      app().settings().pipeKeepVideo = this.checked; app().saveSettings();
    });
    $('pipeForm').addEventListener('submit', function (e) { e.preventDefault(); startFromLink(); });
    $('pipeFile').addEventListener('change', startFromFile);
    $('sysCheckBtn').addEventListener('click', runSystemCheck);
    $('pyCheckBtn').addEventListener('click', checkPython);
    document.addEventListener('keydown', function (e) {
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|SELECT|TEXTAREA/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      if ($('settingsDialog').open) return;
      if (e.key === 'p' || e.key === 'P') checkPython();
    });

    checkServer().then(function () { document.dispatchEvent(new Event('ll:server-checked')); });
  }

  function updateEngine() {
    $('pipeModelWrap').classList.toggle('hidden', $('pipeEngine').value !== 'local');
  }

  async function checkServer() {
    const box = $('pipeOffline');
    try {
      const res = await LL.server.api('/api/health');
      if (res.status === 401) {
        serverOk = false;
        box.innerHTML = 'This phone isn\'t connected to your PC: the access key is missing or wrong. ' +
          'Open the address (or scan the QR code) shown on the PC under <b>📱 Use on phone</b>.';
        box.classList.remove('hidden');
        setEnabled(false);
        return;
      }
      if (!res.ok) throw new Error('no api');
      const h = await res.json();
      serverOk = true;
      const missing = [];
      if (!h.ytdlp) missing.push('the downloader (yt-dlp)');
      if (!h.whisper) missing.push('local AI transcription (faster-whisper)');
      if (missing.length) {
        box.innerHTML = 'Not installed yet: ' + missing.join(' and ') + '. Close the app and run <b>start.bat</b> again to install.';
        box.classList.remove('hidden');
      } else {
        box.classList.add('hidden');
      }
      setEnabled(true);
      loadLibrary();
      resumeRunningJob();
    } catch (e) {
      serverOk = false;
      if (LL.native && LL.native.available) enableNativeMode();
      else enableStandaloneMode();
    }
  }

  /* ---------- Without the PC server (phone app, or PC in basic mode) ----------
   * Downloading from links needs the PC. Files on this device can still be
   * transcribed with OpenAI, straight from the browser. */
  function enableStandaloneMode() {
    const box = $('pipeOffline');
    const phone = LL.mobile && LL.mobile.isPhone();
    box.innerHTML = (phone
      ? '<b>Phone mode.</b> Downloading from links needs your PC (start it with <b>start-phone.bat</b> and open the address it shows). '
      : 'Downloading from links needs the full version: install Python 3 and start the app with <b>start.bat</b>. ') +
      'Here you can still transcribe an audio or video file from this device with <b>OpenAI</b> (API key in ⚙ Settings, files up to 25 MB).';
    box.classList.remove('hidden');
    $('pipeUrl').disabled = true;
    $('pipeGo').disabled = true;
    $('pipeFile').disabled = false;
    $('pipeEngine').value = 'openai';
    $('pipeEngine').querySelector('option[value=local]').disabled = true;
    $('pipeKeepVideo').closest('label').classList.add('hidden');
    updateEngine();
    $('libList').innerHTML = '<li class="muted">The library lives on your PC. Items transcribed here can be saved as .srt files.</li>';
  }

  /* ---------- OpenAI transcription straight from the browser / phone ---------- */
  /** Returns { cues, language, srt }. Throws an Error with a readable message. */
  async function openaiTranscribe(file) {
    const s = app().settings();
    if (!s.openaiKey) throw new Error('Add your OpenAI API key in ⚙ Settings to make transcripts.');
    if (file.size > 25 * 1024 * 1024) {
      throw new Error('This file is ' + Math.round(file.size / 1048576) + ' MB; OpenAI accepts up to 25 MB. Use a shorter clip or audio only.');
    }
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('model', 'whisper-1');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    fd.append('timestamp_granularities[]', 'segment');
    const lang = $('pipeLang').value;
    if (lang !== 'auto') fd.append('language', lang.split('-')[0]);
    let data;
    try {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + s.openaiKey }, body: fd
      });
      data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
    } catch (err) {
      throw new Error('OpenAI transcription failed: ' + err.message);
    }
    const cues = LL.lines.fromOpenAI(data);
    if (!cues.length) throw new Error('No speech was found in this file.');
    const language = LL.lines.langFromName(data.language) || (lang !== 'auto' ? lang : '');
    return { cues: cues, language: language, srt: LL.lines.toSrt(cues) };
  }

  async function transcribeInBrowser(file) {
    if (!app().settings().openaiKey) {
      app().toast('Add your OpenAI API key in ⚙ Settings first.', true);
      return;
    }
    showJob({ status: 'running', step: 2, progress: 0.1, message: 'Sending to OpenAI' });
    let r;
    try { r = await openaiTranscribe(file); } catch (err) { showJob({ status: 'error', error: err.message }); return; }
    showJob({ status: 'done', step: 3, progress: 1, item: { title: file.name } });
    app().loadLocalItem(file, r.cues, r.language, file.name);
    const li = document.createElement('li');
    li.className = 'lib-item';
    li.innerHTML = '<div class="lib-main"><div class="lib-name">🎧 ' + esc(file.name) + '</div><div class="muted small">' +
      esc((r.language ? LL.languages.nameOf(r.language) + ' · ' : '') + r.cues.length + ' lines · AI (OpenAI)') + '</div></div>';
    if (!nativeMode) {   // WebView can't save downloads; browsers can
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.srt], { type: 'text/plain' }));
      a.download = file.name.replace(/\.[^.]+$/, '') + '.srt';
      a.className = 'btn small';
      a.textContent = '⬇ Save .srt';
      const actions = document.createElement('div');
      actions.className = 'lib-actions';
      actions.appendChild(a);
      li.appendChild(actions);
    }
    const list = $('libList');
    if (list.querySelector('.muted')) list.innerHTML = '';
    list.prepend(li);
  }

  /* ---------- Android app: downloads run on the phone (yt-dlp inside the app) ---------- */
  let nativeMode = false;

  function enableNativeMode() {
    nativeMode = true;
    const st = LL.native.status();
    const box = $('pipeOffline');
    box.innerHTML = '<b>Android app.</b> Links are downloaded on this phone. Transcripts come from the site\'s own subtitles when it has them, ' +
      'otherwise from <b>OpenAI</b> (API key in ⚙ Settings). ' +
      '<button id="nativeUpdate" class="btn small" type="button">Update downloader</button>' +
      (st.error ? '<br><span class="error">The downloader could not start: ' + esc(st.error) + '</span>' : '');
    box.classList.remove('hidden');
    $('pipeUrl').disabled = false;
    $('pipeGo').disabled = false;
    $('pipeFile').disabled = false;
    $('pipeEngine').value = 'openai';
    $('pipeEngine').querySelector('option[value=local]').disabled = true;
    updateEngine();
    $('nativeUpdate').addEventListener('click', function () {
      this.disabled = true;
      this.textContent = 'Updating…';
      LL.native.updateDownloader();
    });
    LL.native.on(function (ev) {
      if (ev.type !== 'update') return;
      const b = $('nativeUpdate');
      if (b) { b.disabled = false; b.textContent = 'Update downloader'; }
      app().toast(ev.ok ? 'Downloader updated (' + ev.message + ').' : 'Update failed: ' + ev.message, !ev.ok);
    });
    loadNativeLibrary();
  }

  function nativeDownload(url, opts) {
    showJob({ status: 'running', step: 1, progress: 0, message: 'Starting' });
    const id = LL.native.download(url, { language: opts.language, keepVideo: opts.keepVideo });
    const off = LL.native.on(function (ev) {
      if (ev.type !== 'job' || ev.jobId !== id) return;
      if (ev.status === 'error') { off(); showJob({ status: 'error', error: ev.error }); return; }
      if (ev.status === 'done') { off(); loadNativeLibrary(); prepareNativeItem(ev.item); return; }
      showJob({ status: 'running', step: ev.step || 1, progress: ev.progress || 0, message: ev.message });
    });
  }

  async function fileFromUrl(url, name) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not open the saved file.');
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || '' });
  }

  /** After a download: use the site's subtitles, or make a transcript with OpenAI, then open it. */
  async function prepareNativeItem(item) {
    const ext = (item.media.match(/\.[a-z0-9]+$/i) || [''])[0];
    if (item.subs) { studyNativeItem(item); return; }
    if (!app().settings().openaiKey) {
      showJob({ status: 'error', error: 'Downloaded "' + item.title + '", but this site has no subtitles. Add your OpenAI API key in ⚙ Settings, then tap "Make transcript" in the library.' });
      return;
    }
    showJob({ status: 'running', step: 2, progress: 0.1, message: 'Making the transcript with OpenAI' });
    try {
      const file = await fileFromUrl(item.media, (item.title || 'audio').slice(0, 60) + ext);
      const r = await openaiTranscribe(file);
      const saved = LL.native.saveTranscript(item.id, r.srt, r.language) || item;
      loadNativeLibrary();
      showJob({ status: 'done', step: 3, progress: 1, item: saved });
      app().loadLocalItem(file, r.cues, saved.language || r.language, saved.title);
    } catch (err) {
      showJob({ status: 'error', error: err.message });
    }
  }

  async function studyNativeItem(item) {
    try {
      const ext = (item.media.match(/\.[a-z0-9]+$/i) || [''])[0];
      const subRes = await fetch(item.subs);
      if (!subRes.ok) throw new Error('Could not read the transcript.');
      const cues = LL.subtitles.parseSubtitles(await subRes.text());
      if (!cues.length) throw new Error('The transcript is empty.');
      const file = await fileFromUrl(item.media, (item.title || 'audio').slice(0, 60) + ext);
      showJob({ status: 'done', step: 3, progress: 1, item: item });
      app().loadLocalItem(file, cues, item.language, item.title);
    } catch (err) {
      app().toast(err.message, true);
    }
  }

  function loadNativeLibrary() {
    const list = $('libList');
    const items = LL.native.listItems();
    if (!items.length) { list.innerHTML = '<li class="muted">Nothing here yet. Paste a link above, or share one from another app.</li>'; return; }
    list.innerHTML = '';
    items.forEach(function (it) {
      const li = document.createElement('li');
      li.className = 'lib-item';
      const how = it.subtitle_source === 'site' ? 'Site subtitles' : it.subtitle_source === 'openai' ? 'AI (OpenAI)' : 'No transcript yet';
      const meta = [it.site, it.language ? LL.languages.nameOf(it.language) : '', how, it.created].filter(Boolean).join(' · ');
      li.innerHTML = '<div class="lib-main"><div class="lib-name">' + (it.has_video ? '🎬 ' : '🎧 ') + esc(it.title) + '</div>' +
        '<div class="muted small">' + esc(meta) + '</div></div>' +
        '<div class="lib-actions"><button class="btn small primary" data-act="open" type="button">' + (it.subs ? 'Study' : 'Make transcript') + '</button>' +
        '<button class="btn small ghost" data-act="del" type="button" title="Delete">🗑</button></div>';
      li.querySelector('[data-act=open]').addEventListener('click', function () {
        if (it.subs) studyNativeItem(it); else prepareNativeItem(it);
      });
      li.querySelector('[data-act=del]').addEventListener('click', function () {
        if (loadNativeLibrary.pending !== it.id) {
          loadNativeLibrary.pending = it.id;
          app().toast('Tap 🗑 again to delete "' + it.title + '".');
          setTimeout(function () { if (loadNativeLibrary.pending === it.id) loadNativeLibrary.pending = null; }, 4000);
          return;
        }
        loadNativeLibrary.pending = null;
        LL.native.deleteItem(it.id);
        loadNativeLibrary();
      });
      list.appendChild(li);
    });
  }

  /** Check Python button / P key: show the Python version, or "not found". */
  async function checkPython() {
    const out = $('pyCheckResult');
    out.className = 'py-result';
    out.textContent = 'Checking…';
    let r = null;
    try {
      const res = await LL.server.api('/api/python');
      if (res.ok) r = await res.json();
    } catch (e) { /* server not reachable */ }
    if (r && r.found && r.version) {
      const tooOld = !/^3\.(9|[1-9]\d)\./.test(r.version);
      out.className = 'py-result ' + (tooOld ? 'warn' : 'ok');
      out.textContent = 'Python ' + r.version + (tooOld ? ' (too old: 3.9+ needed)' : '');
      app().toast('Python ' + r.version + ' found' + (r.mode === 'basic' ? '. Run start.bat to enable Download & transcribe.' : '.'));
    } else if (r) {
      out.className = 'py-result fail';
      out.textContent = 'Python not found';
      app().toast('Python not found. Install it from python.org and tick "Add python.exe to PATH".', true);
    } else {
      out.className = 'py-result fail';
      out.textContent = 'Python: unknown';
      app().toast('Could not check: start the app with start.bat instead of opening index.html directly.', true);
    }
  }

  async function runSystemCheck() {
    const ul = $('sysCheck');
    const row = function (status, label, detail) {
      const icon = { ok: '✓', warn: '!', fail: '✕' }[status];
      return '<li class="crit ' + status + '"><span class="crit-icon">' + icon + '</span><span><strong>' +
        esc(label) + '</strong>' + (detail ? ' — ' + esc(detail) : '') + '</span></li>';
    };
    ul.innerHTML = '<li class="muted">Checking…</li>';
    let h;
    try {
      const res = await LL.server.api('/api/health');
      if (!res.ok) throw new Error();
      h = await res.json();
    } catch (e) {
      ul.innerHTML = row('fail', 'Python server', 'not running. The app was started in basic mode: install Python 3.9+ and use start.bat.');
      return;
    }
    let html = row(h.python_ok ? 'ok' : 'fail', 'Python', (h.python || '?') + (h.python_ok ? '' : ' (3.9 or newer needed)'));
    html += row(h.ytdlp ? 'ok' : 'fail', 'Downloader (yt-dlp)', h.ytdlp ? h.ytdlp_version : 'not installed - run start.bat');
    html += row(h.whisper ? 'ok' : 'fail', 'AI speech-to-text', h.whisper ? 'faster-whisper ' + h.whisper_version : 'not installed - run start.bat');
    if (h.whisper) html += row(h.gpu ? 'ok' : 'warn', 'Graphics card', h.gpu ? 'NVIDIA GPU found (fast)' : 'none found: uses the processor (slower)');
    html += row(LL.tts.isSupported() ? 'ok' : 'fail', 'Clear voice', LL.tts.isSupported() ? 'available in this browser' : 'not supported in this browser');
    ul.innerHTML = html;
  }

  function setEnabled(on) {
    ['pipeUrl', 'pipeGo', 'pipeFile'].forEach(function (id) { $(id).disabled = !on; });
  }

  function jobOptions() {
    const s = app().settings();
    return {
      language: $('pipeLang').value,
      engine: $('pipeEngine').value,
      model: $('pipeModel').value,
      keepVideo: $('pipeKeepVideo').checked,
      openaiKey: $('pipeEngine').value === 'openai' ? (s.openaiKey || '') : ''
    };
  }

  function needKeyCheck(opts) {
    if (opts.engine === 'openai' && !opts.openaiKey) {
      app().toast('Add your OpenAI API key in ⚙ Settings, or choose "AI on this computer".', true);
      return false;
    }
    return true;
  }

  async function startFromLink() {
    if (!serverOk && !nativeMode) return;
    let url = $('pipeUrl').value.trim();
    if (!url) { app().toast('Paste a link first.'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const parsed = LL.linkcheck.parseLink(url);
    if (parsed.kind === 'drm') {
      app().toast(parsed.service + ' is DRM-protected and cannot be downloaded.', true);
      return;
    }
    const opts = jobOptions();
    if (nativeMode) { $('pipeUrl').value = ''; nativeDownload(url, opts); return; }
    if (!needKeyCheck(opts)) return;
    opts.url = url;
    try {
      const res = await LL.server.api('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start.');
      $('pipeUrl').value = '';
      showJob({ status: 'running', step: 1, progress: 0, message: 'Starting' });
      watchJob(data.id);
    } catch (err) { app().toast(err.message, true); }
  }

  function startFromFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!serverOk) { transcribeInBrowser(file); return; }
    const opts = jobOptions();
    if (!needKeyCheck(opts)) return;
    const q = new URLSearchParams({ name: file.name, language: opts.language, engine: opts.engine, model: opts.model });
    showJob({ step: 1, progress: 0, message: 'Copying "' + file.name + '" into the library…', status: 'running' });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload?' + q.toString());
    if (opts.openaiKey) xhr.setRequestHeader('X-OpenAI-Key', opts.openaiKey);
    xhr.setRequestHeader('X-LL-Client', '1');
    if (LL.server.token) xhr.setRequestHeader('X-LL-Token', LL.server.token);
    xhr.upload.onprogress = function (ev) {
      if (ev.lengthComputable) showJob({ step: 1, progress: ev.loaded / ev.total, message: 'Copying file… ' + Math.round(100 * ev.loaded / ev.total) + '%', status: 'running' });
    };
    xhr.onload = function () {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (err) { /* ignore */ }
      if (xhr.status !== 200) { showJob({ status: 'error', error: data.error || 'Upload failed.' }); return; }
      watchJob(data.id);
    };
    xhr.onerror = function () { showJob({ status: 'error', error: 'Upload failed. Is the app window still open?' }); };
    xhr.send(file);
  }

  function watchJob(id) {
    try { sessionStorage.setItem('ll.job', id); } catch (e) { /* ignore */ }
    clearInterval(polling);
    const poll = async function () {
      try {
        const res = await LL.server.api('/api/jobs/' + encodeURIComponent(id));
        if (res.status === 404) { clearInterval(polling); $('pipeJob').classList.add('hidden'); return; }
        const job = await res.json();
        showJob(job);
        if (job.status === 'done' || job.status === 'error') {
          clearInterval(polling);
          try { sessionStorage.removeItem('ll.job'); } catch (e) { /* ignore */ }
          if (job.status === 'done') {
            loadLibrary();
            if (job.item) app().loadLibraryItem(job.item);
          }
        }
      } catch (err) {
        showJob({ status: 'error', error: 'Lost contact with the app window. Is it still open?' });
        clearInterval(polling);
      }
    };
    poll();
    polling = setInterval(poll, 800);
  }

  function resumeRunningJob() {
    let id = null;
    try { id = sessionStorage.getItem('ll.job'); } catch (e) { /* ignore */ }
    if (id) watchJob(id);
  }

  function showJob(job) {
    const box = $('pipeJob');
    box.classList.remove('hidden');
    box.classList.toggle('failed', job.status === 'error');
    const step = job.status === 'done' ? 3 : (job.step || 1);
    box.querySelectorAll('.steps li').forEach(function (li) {
      const n = +li.getAttribute('data-step');
      li.className = n < step || job.status === 'done' ? 'done' : (n === step ? 'current' : '');
    });
    const overall = job.status === 'done' ? 1 : Math.min(1, ((step - 1) + (job.progress || 0)) / 2);
    $('pipeBar').style.width = Math.round(overall * 100) + '%';
    let msg = job.status === 'error' ? '✕ ' + (job.error || job.message) :
      job.status === 'queued' ? 'Waiting for the previous item to finish…' :
      (job.message || '') + (job.progress && job.status !== 'done' ? ' · ' + Math.round(job.progress * 100) + '%' : '');
    if (job.status === 'done') msg = '✓ Ready: "' + (job.item ? job.item.title : '') + '" is loaded below.';
    $('pipeMsg').textContent = msg;
    $('pipeMsg').classList.toggle('error', job.status === 'error');
  }

  async function loadLibrary() {
    const list = $('libList');
    try {
      const res = await LL.server.api('/api/library');
      const data = await res.json();
      const items = data.items || [];
      if (!items.length) { list.innerHTML = '<li class="muted">Nothing here yet.</li>'; return; }
      list.innerHTML = '';
      items.forEach(function (it) {
        const li = document.createElement('li');
        li.className = 'lib-item';
        const how = it.subtitle_source === 'site' ? 'Site subtitles' :
          it.subtitle_source === 'openai' ? 'AI (OpenAI)' : 'AI (this computer)';
        const meta = [it.site, it.language ? LL.languages.nameOf(it.language) : '', how, it.created].filter(Boolean).join(' · ');
        li.innerHTML = '<div class="lib-main"><div class="lib-name">' + (it.has_video ? '🎬 ' : '🎧 ') + esc(it.title) + '</div>' +
          '<div class="muted small">' + esc(meta) + '</div></div>' +
          '<div class="lib-actions"><button class="btn small primary" data-act="open" type="button">Study</button>' +
          '<a class="btn small" href="' + esc(LL.server.media(it.id, it.subtitle_file)) + '" download="' + esc(it.title) + '.srt" title="Download the transcript">.srt</a>' +
          '<button class="btn small ghost" data-act="del" type="button" title="Delete from library">🗑</button></div>';
        li.querySelector('[data-act=open]').addEventListener('click', function () { app().loadLibraryItem(it); });
        li.querySelector('[data-act=del]').addEventListener('click', function () { deleteItem(it); });
        list.appendChild(li);
      });
    } catch (e) {
      list.innerHTML = '<li class="muted">Could not load the library.</li>';
    }
  }

  async function deleteItem(it) {
    // no blocking confirm() dialog: ask with a second click instead
    if (deleteItem.pending !== it.id) {
      deleteItem.pending = it.id;
      app().toast('Click 🗑 again to delete "' + it.title + '".');
      setTimeout(function () { if (deleteItem.pending === it.id) deleteItem.pending = null; }, 4000);
      return;
    }
    deleteItem.pending = null;
    try {
      await LL.server.api('/api/library/' + encodeURIComponent(it.id), { method: 'DELETE' });
      app().toast('Deleted.');
      loadLibrary();
    } catch (e) { app().toast('Could not delete.', true); }
  }

  LL.pipeline = { transcribeFile: transcribeInBrowser };

  document.addEventListener('DOMContentLoaded', init);
})();
