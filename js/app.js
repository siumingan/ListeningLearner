/* ListeningLearner - main app */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const S = LL.subtitles;

  /* ---------------- Settings (saved in this browser) ---------------- */
  const SETTINGS_KEY = 'listeningLearner.settings.v1';
  const defaults = {
    clipLang: 'en',
    targetLang: guessTargetLang(),
    translateProvider: 'mymemory',
    myMemoryEmail: '', googleTranslateKey: '', libreUrl: '', libreKey: '',
    youtubeKey: '', openaiKey: '',
    country: guessCountry(),
    ttsRate: 0.85, videoRate: 1,
    autoPause: true, hideOriginal: false, autoTranslate: true
  };
  let settings = Object.assign({}, defaults, loadSettings());

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
  }
  function guessCountry() {
    const m = (navigator.language || '').match(/-([A-Za-z]{2})$/);
    return m ? m[1].toUpperCase() : '';
  }
  function guessTargetLang() {
    const l = LL.languages.byCode(navigator.language || 'en');
    if (!l) return 'en';
    if (l.code === 'en') return 'zh-CN';
    return l.code;
  }

  /* ---------------- State ---------------- */
  const state = {
    player: null,            // active player adapter
    source: null,            // 'file' | 'youtube' | 'direct'
    cues: [],
    offset: 0,               // seconds added to subtitle times
    currentIdx: -1,          // line currently shown
    armedIdx: -1,            // line whose end we will pause at
    stoppedIdx: -1,          // line we already paused at
    pausedAtLine: false,
    translations: {},        // idx -> text
    ytReport: null,
    ytLink: null,
    ticker: null,
    speaking: false
  };

  /* ---------------- UI setup ---------------- */
  function fillLangSelect(sel, value) {
    sel.innerHTML = '';
    LL.languages.LANGUAGES.forEach(function (l) {
      const o = document.createElement('option');
      o.value = l.code; o.textContent = l.name;
      sel.appendChild(o);
    });
    sel.value = LL.languages.byCode(value) ? LL.languages.byCode(value).code : 'en';
  }

  function init() {
    fillLangSelect($('clipLang'), settings.clipLang);
    fillLangSelect($('targetLang'), settings.targetLang);
    $('clipLang').addEventListener('change', function () {
      settings.clipLang = this.value; saveSettings(); state.translations = {}; refreshLine();
    });
    $('targetLang').addEventListener('change', function () {
      settings.targetLang = this.value; saveSettings(); state.translations = {}; refreshLine();
    });

    // tabs
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
        document.querySelectorAll('.tab-panel').forEach(function (p) {
          p.classList.toggle('hidden', p.getAttribute('data-panel') !== tab.getAttribute('data-tab'));
        });
      });
    });

    $('videoFile').addEventListener('change', onVideoFile);
    document.querySelectorAll('.subFile').forEach(function (inp) { inp.addEventListener('change', onSubtitleFile); });
    $('linkForm').addEventListener('submit', function (e) { e.preventDefault(); checkLink(); });

    $('playBtn').addEventListener('click', togglePlay);
    $('replayBtn').addEventListener('click', function () { replayLine(currentOrLast()); });
    $('prevBtn').addEventListener('click', function () { replayLine(Math.max(0, currentOrLast() - 1)); });
    $('nextBtn').addEventListener('click', function () { replayLine(Math.min(state.cues.length - 1, currentOrLast() + 1)); });
    $('speakBtn').addEventListener('click', speakOriginal);
    $('speakTransBtn').addEventListener('click', speakTranslation);
    $('translateBtn').addEventListener('click', function () { showTranslation(state.currentIdx, true); });
    $('revealBtn').addEventListener('click', function () { $('original').classList.remove('concealed'); this.classList.add('hidden'); });

    bindToggle('autoPause', function () { if (!settings.autoPause) hideLineStatus(); });
    bindToggle('hideOriginal', function () { renderCueList(); refreshLine(); });
    bindToggle('autoTranslate');

    $('videoRate').value = String(settings.videoRate);
    $('videoRate').addEventListener('change', function () {
      settings.videoRate = parseFloat(this.value); saveSettings();
      if (state.player) state.player.setRate(settings.videoRate);
    });
    $('ttsRate').value = String(settings.ttsRate);
    $('ttsRateOut').textContent = settings.ttsRate + '×';
    $('ttsRate').addEventListener('input', function () {
      settings.ttsRate = parseFloat(this.value); $('ttsRateOut').textContent = settings.ttsRate + '×'; saveSettings();
    });
    $('offsetMinus').addEventListener('click', function () { setOffset(state.offset - 0.1); });
    $('offsetPlus').addEventListener('click', function () { setOffset(state.offset + 0.1); });

    // settings dialog
    $('openSettings').addEventListener('click', openSettings);
    $('translateProvider').addEventListener('change', updateProviderFields);
    $('settingsDialog').addEventListener('close', function () {
      if ($('settingsDialog').returnValue === 'save') readSettingsForm();
    });

    document.addEventListener('keydown', onKey);
    updateButtons();
  }

  function bindToggle(id, after) {
    const el = $(id);
    el.checked = !!settings[id];
    el.addEventListener('change', function () {
      settings[id] = el.checked; saveSettings();
      if (after) after();
    });
  }

  /* ---------------- Loading sources ---------------- */
  function resetPlayer() {
    stopTicker();
    LL.tts.stop();
    if (state.player) { try { state.player.destroy(); } catch (e) { /* ignore */ } }
    state.player = null;
    $('video').classList.add('hidden');
    $('ytWrap').classList.add('hidden');
    $('ytWrap').innerHTML = '<div id="ytPlayer"></div>';
    $('playerEmpty').classList.remove('hidden');
    $('audioOnly').classList.add('hidden');
    resetLineState();
  }

  function resetLineState() {
    state.currentIdx = -1; state.armedIdx = -1; state.stoppedIdx = -1; state.pausedAtLine = false;
    hideLineStatus();
    refreshLine();
  }

  function onVideoFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const prevSource = state.source;
    resetPlayer();
    if (prevSource && prevSource !== 'file') clearSubtitles();
    state.source = 'file';
    $('videoFileName').textContent = file.name;
    const v = $('video');
    v.classList.remove('hidden');
    $('playerEmpty').classList.add('hidden');
    const p = new LL.players.HtmlVideoPlayer(v);
    v.controls = true;
    p.load(URL.createObjectURL(file)).then(function () {
      state.player = p;
      p.setRate(settings.videoRate);
      startTicker();
      updateButtons();
      if (!state.cues.length) toast('Video loaded. Now choose a subtitle file to study line by line.');
    }).catch(function (err) {
      toast(err.message, true);
      resetPlayer();
    });
  }

  function onSubtitleFile(e) {
    const file = e.target.files && e.target.files[0];
    const label = e.target.closest('.row').querySelector('.subFileName');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const cues = S.parseSubtitles(String(reader.result));
      if (!cues.length) {
        toast('No subtitle lines found in that file. Use an .srt or .vtt file.', true);
        return;
      }
      state.cues = cues;
      state.translations = {};
      state.offset = 0; $('offsetOut').textContent = '0.0 s';
      label.textContent = file.name + ' · ' + cues.length + ' lines';
      resetLineState();
      renderCueList();
      if (state.source === 'youtube' && state.ytReport) renderLinkReport();
      updateButtons();
      toast('Loaded ' + cues.length + ' lines.');
    };
    reader.onerror = function () { toast('Could not read that file.', true); };
    reader.readAsText(file);
  }

  function clearSubtitles() {
    state.cues = []; state.translations = {};
    document.querySelectorAll('.subFile').forEach(function (i) { i.value = ''; });
    document.querySelectorAll('.subFileName').forEach(function (s, i) {
      s.textContent = i === 0 ? 'No subtitles chosen' : 'Optional: unlocks line-by-line study';
    });
    renderCueList();
    resetLineState();
  }

  /* ---------------- Link checker ---------------- */
  async function checkLink() {
    const raw = $('linkInput').value;
    const parsed = LL.linkcheck.parseLink(raw);
    const box = $('linkReport');
    box.classList.remove('hidden');
    $('linkSubRow').classList.add('hidden');
    // subtitles belong to one video: drop them when a different video is checked
    const sameVideo = state.ytLink && parsed.kind === 'youtube' && state.ytLink.videoId === parsed.videoId;
    if (!sameVideo && state.cues.length) clearSubtitles();
    state.ytReport = null; state.ytLink = null;

    if (parsed.kind === 'invalid') {
      box.innerHTML = reportHtml('NONE', 'Link not recognised', parsed.reason, []);
      return;
    }
    if (parsed.kind === 'drm') {
      box.innerHTML = reportHtml('NONE', parsed.service,
        parsed.service + ' protects its videos with DRM copy protection, so they can\'t be played or studied inside this app. ' +
        'Use a video file you have the rights to, or a YouTube video instead.', []);
      return;
    }
    if (parsed.kind === 'unknown') {
      box.innerHTML = reportHtml('NONE', parsed.host,
        'This site isn\'t supported yet. Supported now: YouTube links and direct links to video files (.mp4, .webm).', []);
      return;
    }
    if (parsed.kind === 'direct') {
      box.innerHTML = reportHtml('WATCH', 'Direct video file',
        'This looks like a video file. It will play if the website allows it. Add a subtitle file to study line by line.', []) +
        '<div class="report-actions"><button class="btn primary" id="loadDirect" type="button">▶ Load in player</button></div>';
      $('loadDirect').addEventListener('click', function () { loadDirect(parsed.url); });
      $('linkSubRow').classList.remove('hidden');
      return;
    }

    // YouTube
    box.innerHTML = '<p class="muted">Checking YouTube video…</p>';
    let report;
    try {
      report = await LL.linkcheck.checkYouTube(parsed.videoId, settings.youtubeKey, settings.country);
    } catch (err) {
      const hint = err.status === 400 || err.status === 403 ? ' Check your YouTube API key in Settings.' : '';
      box.innerHTML = reportHtml('WATCH', 'YouTube video', 'The full check failed: ' + escapeHtml(err.message) + '.' + hint, []);
      report = { videoId: parsed.videoId, criteria: [], captionTracks: [], playable: null, apiUsed: false };
    }
    state.ytReport = report;
    state.ytLink = parsed;
    if (report.audioLanguage && LL.languages.byCode(report.audioLanguage)) {
      settings.clipLang = LL.languages.byCode(report.audioLanguage).code;
      $('clipLang').value = settings.clipLang; saveSettings();
    }
    renderLinkReport();
  }

  function currentCategory() {
    const r = state.ytReport;
    if (!r) return 'NONE';
    return LL.linkcheck.classify({ playable: r.playable, hasOwnSubtitles: state.cues.length > 0 });
  }

  function renderLinkReport() {
    const r = state.ytReport;
    if (!r) return;
    const cat = currentCategory();
    const title = r.title ? escapeHtml(r.title) : 'YouTube video ' + escapeHtml(r.videoId);
    let summary;
    if (cat === 'NONE') summary = escapeHtml(r.blockReason || 'This video can\'t be played here.');
    else if (cat === 'FULL') summary = 'Your subtitle file is loaded: pause at each line, translation and the clear voice all work.';
    else summary = 'You can watch it here with YouTube\'s own subtitles. To pause at each line, translate and hear lines clearly, add a subtitle file (.srt / .vtt) for this video.';
    const meta = [];
    if (r.channel) meta.push(escapeHtml(r.channel));
    if (isFinite(r.durationSec)) meta.push(S.formatTime(r.durationSec));
    const extraCriteria = r.criteria.slice();
    extraCriteria.push({
      label: 'Your subtitle file',
      status: state.cues.length ? 'ok' : 'warn',
      detail: state.cues.length ? state.cues.length + ' lines loaded.' : 'Not added.'
    });
    let html = reportHtml(cat, title, summary, extraCriteria, meta.join(' · '));
    if (cat !== 'NONE') html += '<div class="report-actions"><button class="btn primary" id="loadYt" type="button">▶ Load in player</button></div>';
    $('linkReport').innerHTML = html;
    if (cat !== 'NONE') {
      $('loadYt').addEventListener('click', loadYouTube);
      $('linkSubRow').classList.remove('hidden');
    }
  }

  function reportHtml(cat, title, summary, criteria, meta) {
    const badge = { FULL: ['ok', 'Line-by-line ready'], WATCH: ['warn', 'Watch only'], NONE: ['fail', 'Not supported'] }[cat];
    const icon = { ok: '✓', warn: '!', fail: '✕', unknown: '?' };
    let html = '<div class="report-head"><span class="badge ' + badge[0] + '">' + badge[1] + '</span>' +
      '<strong class="report-title">' + title + '</strong></div>';
    if (meta) html += '<div class="muted small">' + meta + '</div>';
    html += '<p class="report-summary">' + summary + '</p>';
    if (criteria.length) {
      html += '<ul class="criteria">';
      criteria.forEach(function (c) {
        html += '<li class="crit ' + c.status + '"><span class="crit-icon">' + icon[c.status] + '</span>' +
          '<span><strong>' + escapeHtml(c.label) + '</strong>' + (c.detail ? ' — ' + escapeHtml(c.detail) : '') + '</span></li>';
      });
      html += '</ul>';
    }
    return html;
  }

  function loadYouTube() {
    const link = state.ytLink;
    if (!link) return;
    const keepCues = state.cues;
    const keepTranslations = state.translations;
    resetPlayer();
    state.cues = keepCues; state.translations = keepTranslations;
    state.source = 'youtube';
    $('ytWrap').classList.remove('hidden');
    $('playerEmpty').classList.add('hidden');
    const p = new LL.players.YouTubePlayer('ytPlayer');
    p.onError = function (err) {
      toast(err.message, true);
      if (state.ytReport) { state.ytReport.playable = false; state.ytReport.blockReason = err.message; renderLinkReport(); }
    };
    const showCaptions = !state.cues.length;
    p.load(link.videoId, { start: link.start, showCaptions: showCaptions, ccLang: settings.clipLang }).then(function () {
      state.player = p;
      p.setRate(settings.videoRate);
      startTicker();
      updateButtons();
      refreshLine();
    }).catch(function (err) {
      toast(err.message, true);
      if (state.ytReport) { state.ytReport.playable = false; state.ytReport.blockReason = err.message; renderLinkReport(); }
    });
  }

  function loadDirect(url) {
    const keepCues = state.cues;
    resetPlayer();
    state.cues = keepCues;
    state.source = 'direct';
    const v = $('video');
    v.classList.remove('hidden'); v.controls = true;
    $('playerEmpty').classList.add('hidden');
    const p = new LL.players.HtmlVideoPlayer(v);
    p.load(url).then(function () {
      state.player = p; p.setRate(settings.videoRate); startTicker(); updateButtons();
    }).catch(function (err) { toast(err.message + ' The website may not allow playback from other sites.', true); resetPlayer(); });
  }

  /* ---------------- Library items (downloaded / transcribed) ---------------- */
  async function loadLibraryItem(info) {
    resetPlayer();
    clearSubtitles();
    state.source = 'library';
    state.libraryId = info.id;
    if (info.language && LL.languages.byCode(info.language)) {
      settings.clipLang = LL.languages.byCode(info.language).code;
      $('clipLang').value = settings.clipLang; saveSettings();
    }
    const v = $('video');
    v.classList.remove('hidden'); v.controls = true;
    $('playerEmpty').classList.add('hidden');
    const isAudio = !info.has_video || /\.(m4a|mp3|wav|flac|ogg|opus|weba|aac)$/i.test(info.media_file);
    $('audioOnly').classList.toggle('hidden', !isAudio);
    $('audioTitle').textContent = info.title || '';
    const p = new LL.players.HtmlVideoPlayer(v);
    try {
      const subRes = await fetch(LL.server.media(info.id, info.subtitle_file));
      if (!subRes.ok) throw new Error('Could not read the transcript file.');
      const cues = S.parseSubtitles(await subRes.text());
      await p.load(LL.server.media(info.id, info.media_file));
      state.player = p;
      p.setRate(settings.videoRate);
      state.cues = cues;
      state.translations = {};
      setOffset(0);
      renderCueList();
      resetLineState();
      startTicker();
      updateButtons();
      toast('Loaded "' + (info.title || 'item') + '" · ' + cues.length + ' lines.');
      document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      toast(err.message, true);
      resetPlayer();
    }
  }

  /** A file on this device plus lines made in the browser (phone mode). */
  function loadLocalItem(file, cues, language, title) {
    resetPlayer();
    clearSubtitles();
    state.source = 'file';
    if (language && LL.languages.byCode(language)) {
      settings.clipLang = LL.languages.byCode(language).code;
      $('clipLang').value = settings.clipLang; saveSettings();
    }
    const v = $('video');
    v.classList.remove('hidden'); v.controls = true;
    $('playerEmpty').classList.add('hidden');
    const isAudio = /^audio\//.test(file.type) || /\.(m4a|mp3|wav|flac|ogg|opus|aac)$/i.test(file.name);
    $('audioOnly').classList.toggle('hidden', !isAudio);
    $('audioTitle').textContent = title || file.name;
    const p = new LL.players.HtmlVideoPlayer(v);
    p.load(URL.createObjectURL(file)).then(function () {
      state.player = p;
      p.setRate(settings.videoRate);
      state.cues = cues;
      state.translations = {};
      setOffset(0);
      renderCueList();
      resetLineState();
      startTicker();
      updateButtons();
      toast('Ready: ' + cues.length + ' lines.');
      document.querySelector('.stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) { toast(err.message, true); resetPlayer(); });
  }

  /** Put a shared link into the right tab (share target / ?share_url=). */
  function openSharedLink(link) {
    if (!link) return;
    const parsed = LL.linkcheck.parseLink(link);
    const useAny = !$('pipeUrl').disabled && (parsed.kind !== 'youtube' || (LL.native && LL.native.available));
    const tabName = useAny ? 'any' : 'link';
    const tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
    if (tab) tab.click();
    if (useAny) { $('pipeUrl').value = link; $('pipeUrl').focus(); }
    else { $('linkInput').value = link; checkLink(); }
  }

  /* ---------------- Line-by-line engine ---------------- */
  function startTicker() { stopTicker(); state.ticker = setInterval(tick, 40); }
  function stopTicker() { if (state.ticker) clearInterval(state.ticker); state.ticker = null; }

  function tick() {
    const p = state.player;
    if (!p) return;
    updatePlayButton();
    if (!state.cues.length) return;
    const t = p.getTime() - state.offset;
    const idx = S.findCueAt(state.cues, t);

    // user scrubbed back before the line we paused at: allow pausing there again
    if (state.stoppedIdx >= 0 && t < state.cues[state.stoppedIdx].start - 0.25) state.stoppedIdx = -1;

    if (idx !== -1) {
      if (idx !== state.currentIdx) setCurrent(idx);
      if (idx !== state.stoppedIdx) state.armedIdx = idx;
    }

    if (settings.autoPause && !p.isPaused() && state.armedIdx >= 0 && state.armedIdx !== state.stoppedIdx) {
      const cue = state.cues[state.armedIdx];
      if (t >= cue.end - 0.06 && t < cue.end + 1.5) {
        p.pause();
        state.stoppedIdx = state.armedIdx;
        onLinePaused(state.armedIdx);
      } else if (t >= cue.end + 1.5) {
        state.armedIdx = -1; // jumped far past (seek); don't pause late
      }
    }
  }

  function setCurrent(idx) {
    state.currentIdx = idx;
    hideLineStatus();
    refreshLine();
    highlightCue(idx);
    prefetchTranslations(idx);
  }

  function onLinePaused(idx) {
    state.pausedAtLine = true;
    $('lineStatus').classList.remove('hidden');
    if (settings.autoTranslate) showTranslation(idx, false);
  }

  function hideLineStatus() {
    state.pausedAtLine = false;
    $('lineStatus').classList.add('hidden');
  }

  function currentOrLast() {
    if (state.currentIdx >= 0) return state.currentIdx;
    if (!state.player) return 0;
    const i = S.findLastStarted(state.cues, state.player.getTime() - state.offset);
    return Math.max(0, i);
  }

  function replayLine(idx) {
    if (!state.player || !state.cues.length || idx < 0) return;
    LL.tts.stop();
    const cue = state.cues[idx];
    state.stoppedIdx = -1;
    state.armedIdx = idx;
    setCurrent(idx);
    state.player.seek(Math.max(0, cue.start + state.offset - 0.05));
    state.player.play();
  }

  function togglePlay() {
    if (!state.player) return;
    LL.tts.stop();
    if (state.player.isPaused()) { hideLineStatus(); state.player.play(); }
    else state.player.pause();
  }

  function setOffset(v) {
    state.offset = Math.round(v * 10) / 10;
    $('offsetOut').textContent = (state.offset > 0 ? '+' : '') + state.offset.toFixed(1) + ' s';
  }

  /* ---------------- Line display ---------------- */
  function refreshLine() {
    const idx = state.currentIdx;
    const orig = $('original');
    const n = state.cues.length;
    $('lineCounter').textContent = n ? 'Line ' + (idx >= 0 ? idx + 1 : '–') + ' / ' + n : 'Line – / –';
    $('translation').innerHTML = '';
    if (!n) {
      if (state.source === 'youtube') {
        orig.innerHTML = '<span class="muted">Watch-only mode: YouTube\'s subtitles show in the player (use its CC ⚙ menu for auto-translate). ' +
          'Add a subtitle file for this video to pause at each line, translate and hear lines clearly.</span>';
      } else {
        orig.innerHTML = '<span class="muted">Lines will appear here once a subtitle file is loaded.</span>';
      }
      orig.classList.remove('concealed');
      $('revealBtn').classList.add('hidden');
      updateButtons();
      return;
    }
    if (idx < 0) {
      orig.innerHTML = '<span class="muted">Press ▶ Continue to start. The video will pause after each line.</span>';
      orig.classList.remove('concealed');
      $('revealBtn').classList.add('hidden');
      updateButtons();
      return;
    }
    orig.innerHTML = wordSpans(state.cues[idx].text);
    orig.lang = langTag(settings.clipLang);
    orig.classList.toggle('concealed', !!settings.hideOriginal);
    $('revealBtn').classList.toggle('hidden', !settings.hideOriginal);
    if (state.translations[idx]) renderTranslation(state.translations[idx]);
    updateButtons();
  }

  function wordSpans(text) {
    // keep char offsets so speech "boundary" events can highlight words
    let html = '', i = 0;
    const re = /(\s+)|([^\s]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) html += m[1].indexOf('\n') !== -1 ? '<br>' : ' ';
      else html += '<span class="w" data-s="' + m.index + '" data-e="' + (m.index + m[2].length) + '">' + escapeHtml(m[2]) + '</span>';
      i = re.lastIndex;
    }
    return html;
  }

  function highlightWordAt(charIndex) {
    document.querySelectorAll('#original .w').forEach(function (w) {
      const s = +w.getAttribute('data-s'), e = +w.getAttribute('data-e');
      w.classList.toggle('speaking', charIndex >= s && charIndex < e);
    });
  }
  function clearWordHighlight() {
    document.querySelectorAll('#original .w.speaking').forEach(function (w) { w.classList.remove('speaking'); });
  }

  async function showTranslation(idx, userAsked) {
    if (idx < 0 || !state.cues[idx]) { if (userAsked) toast('No line selected yet.'); return; }
    if (state.translations[idx]) { if (idx === state.currentIdx) renderTranslation(state.translations[idx]); return; }
    if (idx === state.currentIdx) $('translation').innerHTML = '<span class="muted">Translating…</span>';
    try {
      const out = await LL.translate.translate(state.cues[idx].text, settings.clipLang, settings.targetLang, settings);
      state.translations[idx] = out;
      if (idx === state.currentIdx) renderTranslation(out);
    } catch (err) {
      if (idx === state.currentIdx) $('translation').innerHTML = '<span class="error">' + escapeHtml(err.message) + '</span>';
    }
  }

  function renderTranslation(text) {
    $('translation').innerHTML = '<span class="label">' + escapeHtml(LL.languages.nameOf(settings.targetLang)) + '</span>' +
      '<span lang="' + langTag(settings.targetLang) + '">' + escapeHtml(text) + '</span>';
  }

  function prefetchTranslations(idx) {
    if (!settings.autoTranslate) return;
    for (let k = idx; k < Math.min(state.cues.length, idx + 3); k++) {
      if (!state.translations[k]) {
        (function (j) {
          LL.translate.translate(state.cues[j].text, settings.clipLang, settings.targetLang, settings)
            .then(function (out) { state.translations[j] = out; })
            .catch(function () { /* shown when the line is reached */ });
        })(k);
      }
    }
  }

  /* ---------------- Text-to-speech ---------------- */
  function langTag(code) {
    const l = LL.languages.byCode(code);
    return l ? l.tts : code;
  }

  async function speakOriginal() {
    const idx = state.currentIdx;
    if (idx < 0) { toast('No line to read yet.'); return; }
    if (state.player && !state.player.isPaused()) state.player.pause();
    const tag = langTag(settings.clipLang);
    if (!LL.tts.hasVoiceFor(tag)) toast('No ' + LL.languages.nameOf(settings.clipLang) + ' voice found on this computer; using the default voice. See README to add voices.');
    try {
      await LL.tts.speak(state.cues[idx].text, {
        lang: tag, rate: settings.ttsRate,
        onBoundary: function (ci) { highlightWordAt(ci); }
      });
    } catch (err) { toast(err.message, true); }
    clearWordHighlight();
  }

  async function speakTranslation() {
    const idx = state.currentIdx;
    if (idx < 0) { toast('No line to read yet.'); return; }
    if (state.player && !state.player.isPaused()) state.player.pause();
    if (!state.translations[idx]) await showTranslation(idx, true);
    const text = state.translations[idx];
    if (!text) return;
    try { await LL.tts.speak(text, { lang: langTag(settings.targetLang), rate: 1 }); }
    catch (err) { toast(err.message, true); }
  }

  /* ---------------- Transcript list ---------------- */
  function renderCueList() {
    const list = $('cueList');
    list.innerHTML = '';
    if (!state.cues.length) { list.innerHTML = '<li class="muted">No subtitles loaded.</li>'; return; }
    const frag = document.createDocumentFragment();
    state.cues.forEach(function (c, i) {
      const li = document.createElement('li');
      li.className = 'cue' + (settings.hideOriginal ? ' blur' : '');
      li.dataset.idx = i;
      li.innerHTML = '<span class="t">' + S.formatTime(c.start) + '</span><span class="x">' + escapeHtml(c.text).replace(/\n/g, '<br>') + '</span>';
      li.addEventListener('click', function () { replayLine(i); });
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  function highlightCue(idx) {
    const list = $('cueList');
    const prev = list.querySelector('.cue.active');
    if (prev) prev.classList.remove('active');
    const el = list.querySelector('.cue[data-idx="' + idx + '"]');
    if (el) {
      el.classList.add('active');
      const lt = list.scrollTop, lh = list.clientHeight, et = el.offsetTop - list.offsetTop;
      if (et < lt || et > lt + lh - 40) list.scrollTop = Math.max(0, et - lh / 3);
    }
  }

  /* ---------------- Buttons, keys, toast ---------------- */
  function updateButtons() {
    const hasPlayer = !!state.player;
    const hasCues = state.cues.length > 0;
    const hasLine = hasCues && state.currentIdx >= 0;
    $('playBtn').disabled = !hasPlayer;
    ['prevBtn', 'replayBtn', 'nextBtn'].forEach(function (id) { $(id).disabled = !(hasPlayer && hasCues); });
    ['speakBtn', 'speakTransBtn', 'translateBtn'].forEach(function (id) { $(id).disabled = !hasLine; });
    if (!LL.tts.isSupported()) { $('speakBtn').disabled = true; $('speakTransBtn').disabled = true; }
    updatePlayButton();
  }

  function updatePlayButton() {
    const p = state.player;
    const paused = !p || p.isPaused();
    const label = paused ? '▶ Continue' : '⏸ Pause';
    if ($('playBtn').textContent !== label) $('playBtn').textContent = label;
  }

  function onKey(e) {
    const tag = (e.target && e.target.tagName) || '';
    if (/INPUT|SELECT|TEXTAREA/.test(tag) || $('settingsDialog').open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'r': case 'R': replayLine(currentOrLast()); break;
      case 'ArrowLeft': e.preventDefault(); replayLine(Math.max(0, currentOrLast() - 1)); break;
      case 'ArrowRight': e.preventDefault(); replayLine(Math.min(state.cues.length - 1, currentOrLast() + 1)); break;
      case 's': case 'S': speakOriginal(); break;
      case 't': case 'T': showTranslation(state.currentIdx, true); break;
      default: break;
    }
  }

  let toastTimer = null;
  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, isError ? 7000 : 3500);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- Settings dialog ---------------- */
  function openSettings() {
    $('translateProvider').value = settings.translateProvider;
    $('myMemoryEmail').value = settings.myMemoryEmail;
    $('googleTranslateKey').value = settings.googleTranslateKey;
    $('libreUrl').value = settings.libreUrl;
    $('libreKey').value = settings.libreKey;
    $('youtubeKey').value = settings.youtubeKey;
    $('openaiKey').value = settings.openaiKey || '';
    $('country').value = settings.country;
    updateProviderFields();
    const clipVoice = LL.tts.pickVoice(langTag(settings.clipLang));
    const targetVoice = LL.tts.pickVoice(langTag(settings.targetLang));
    $('ttsInfo').textContent = !LL.tts.isSupported() ? 'This browser has no built-in text-to-speech.' :
      LL.languages.nameOf(settings.clipLang) + ' voice: ' + (clipVoice ? clipVoice.name : 'none installed') + ' · ' +
      LL.languages.nameOf(settings.targetLang) + ' voice: ' + (targetVoice ? targetVoice.name : 'none installed');
    $('settingsDialog').showModal();
  }

  function updateProviderFields() {
    const p = $('translateProvider').value;
    document.querySelectorAll('#settingsForm [data-for]').forEach(function (el) {
      el.classList.toggle('hidden', el.getAttribute('data-for') !== p);
    });
  }

  function readSettingsForm() {
    settings.translateProvider = $('translateProvider').value;
    settings.myMemoryEmail = $('myMemoryEmail').value.trim();
    settings.googleTranslateKey = $('googleTranslateKey').value.trim();
    settings.libreUrl = $('libreUrl').value.trim();
    settings.libreKey = $('libreKey').value.trim();
    settings.youtubeKey = $('youtubeKey').value.trim();
    settings.openaiKey = $('openaiKey').value.trim();
    settings.country = $('country').value.trim().toUpperCase();
    saveSettings();
    state.translations = {};
    refreshLine();
    toast('Settings saved.');
  }

  LL.app = {
    settings: function () { return settings; },
    saveSettings: saveSettings,
    loadLibraryItem: loadLibraryItem,
    loadLocalItem: loadLocalItem,
    openSharedLink: openSharedLink,
    toast: toast,
    escapeHtml: escapeHtml,
    isLoaded: function (id) { return state.source === 'library' && state.libraryId === id; }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
