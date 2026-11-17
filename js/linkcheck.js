/* ListeningLearner - link checker
 *
 * Works out which features a pasted link supports:
 *   FULL  - "Line-by-line ready": playable here AND we have the subtitle text
 *           (needed for pause-at-each-line, translation and text-to-speech)
 *   WATCH - "Watch only": playable here, but the subtitle text is not available
 *           to the app (YouTube's own captions / auto-translate can still be shown in the player)
 *   NONE  - "Not supported": can't be played here (DRM site, embedding off, private, blocked...)
 */
(function (root) {
  'use strict';

  const DRM_SITES = [
    { re: /(^|\.)netflix\.com$/, name: 'Netflix' },
    { re: /(^|\.)disneyplus\.com$/, name: 'Disney+' },
    { re: /(^|\.)primevideo\.com$/, name: 'Prime Video' },
    { re: /(^|\.)amazon\.[a-z.]+$/, name: 'Amazon Prime Video' },
    { re: /(^|\.)hulu\.com$/, name: 'Hulu' },
    { re: /(^|\.)max\.com$/, name: 'Max' },
    { re: /(^|\.)hbomax\.com$/, name: 'Max' },
    { re: /(^|\.)tv\.apple\.com$/, name: 'Apple TV+' },
    { re: /(^|\.)paramountplus\.com$/, name: 'Paramount+' },
    { re: /(^|\.)peacocktv\.com$/, name: 'Peacock' },
    { re: /(^|\.)crunchyroll\.com$/, name: 'Crunchyroll' },
    { re: /(^|\.)iq\.com$/, name: 'iQIYI' },
    { re: /(^|\.)viki\.com$/, name: 'Viki' }
  ];

  const ID_RE = /^[A-Za-z0-9_-]{11}$/;

  /** Identify the platform and video id of a link. */
  function parseLink(input) {
    let raw = String(input || '').trim();
    if (!raw) return { kind: 'invalid', reason: 'Empty link.' };
    if (ID_RE.test(raw)) return { kind: 'youtube', videoId: raw };
    if (/\s/.test(raw)) return { kind: 'invalid', reason: 'That is not a valid web address.' };
    if (!/^[a-z]+:\/\//i.test(raw)) raw = 'https://' + raw;
    let u;
    try { u = new URL(raw); } catch (e) { return { kind: 'invalid', reason: 'That is not a valid web address.' }; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!/^https?:$/.test(u.protocol) || host.indexOf('.') === -1) return { kind: 'invalid', reason: 'That is not a valid web address.' };

    if (host === 'youtu.be') {
      const id = u.pathname.split('/')[1] || '';
      return ID_RE.test(id) ? { kind: 'youtube', videoId: id, start: startParam(u) } : { kind: 'invalid', reason: 'No video id in this YouTube link.' };
    }
    if (/(^|\.)youtube\.com$/.test(host) || /(^|\.)youtube-nocookie\.com$/.test(host)) {
      let id = u.searchParams.get('v');
      if (!id) {
        const m = u.pathname.match(/^\/(?:embed|shorts|live|v|e)\/([A-Za-z0-9_-]{11})/);
        if (m) id = m[1];
      }
      if (id && ID_RE.test(id)) return { kind: 'youtube', videoId: id, start: startParam(u) };
      if (u.searchParams.get('list')) return { kind: 'invalid', reason: 'This is a playlist link. Open one video and paste its link.' };
      return { kind: 'invalid', reason: 'This YouTube link does not point to a single video.' };
    }
    for (const s of DRM_SITES) {
      if (s.re.test(host)) return { kind: 'drm', service: s.name };
    }
    if (/\.(mp4|webm|ogg|ogv|m4v|mov)$/i.test(u.pathname)) {
      return { kind: 'direct', url: u.toString() };
    }
    return { kind: 'unknown', host: host };
  }

  function startParam(u) {
    const t = u.searchParams.get('t') || u.searchParams.get('start');
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return 0;
    return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
  }

  /** ISO-8601 duration (PT1H2M3S) to seconds. */
  function parseIsoDuration(iso) {
    const m = String(iso || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
    if (!m) return NaN;
    return (parseInt(m[1] || 0, 10) * 86400) + (parseInt(m[2] || 0, 10) * 3600) +
           (parseInt(m[3] || 0, 10) * 60) + parseFloat(m[4] || 0);
  }

  /**
   * Decide the category from collected facts.
   * facts: { playable: bool|null, blockReason, hasOwnSubtitles: bool, captionTracks: [] }
   */
  function classify(facts) {
    if (facts.playable === false) return 'NONE';
    if (facts.hasOwnSubtitles) return 'FULL';
    return 'WATCH';
  }

  async function ytFetch(path, params, apiKey) {
    const q = new URLSearchParams(params);
    q.set('key', apiKey);
    const res = await fetch('https://www.googleapis.com/youtube/v3/' + path + '?' + q.toString());
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const msg = (data.error && data.error.message) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /**
   * Full check of a YouTube video with the YouTube Data API (needs an API key).
   * Returns a report: { title, channel, durationSec, audioLanguage, captionTracks, criteria[], playable, blockReason }
   */
  async function checkYouTube(videoId, apiKey, country) {
    const report = {
      videoId: videoId, title: '', channel: '', durationSec: NaN, audioLanguage: '',
      captionTracks: [], criteria: [], playable: null, blockReason: '', apiUsed: !!apiKey
    };
    const add = function (label, status, detail) { report.criteria.push({ label: label, status: status, detail: detail || '' }); };

    if (!apiKey) {
      add('Video exists and is public', 'unknown', 'Add a YouTube Data API key in Settings for a full check.');
      add('Can play inside this app', 'unknown', 'Will be confirmed when the player loads.');
      add('Subtitle languages', 'unknown', 'Needs an API key.');
      return report;
    }

    const v = await ytFetch('videos', { part: 'snippet,status,contentDetails', id: videoId }, apiKey);
    const item = v.items && v.items[0];
    if (!item) {
      report.playable = false;
      report.blockReason = 'Video not found, private or deleted.';
      add('Video exists and is public', 'fail', report.blockReason);
      return report;
    }
    const sn = item.snippet || {}, st = item.status || {}, cd = item.contentDetails || {};
    report.title = sn.title || '';
    report.channel = sn.channelTitle || '';
    report.durationSec = parseIsoDuration(cd.duration);
    report.audioLanguage = sn.defaultAudioLanguage || sn.defaultLanguage || '';

    // 1. Public
    if (st.privacyStatus === 'private') {
      report.playable = false; report.blockReason = 'The video is private.';
      add('Video exists and is public', 'fail', report.blockReason);
    } else {
      add('Video exists and is public', 'ok', st.privacyStatus === 'unlisted' ? 'Unlisted (playable with the link).' : 'Public.');
    }

    // 2. Embeddable
    if (st.embeddable === false) {
      report.playable = false; report.blockReason = report.blockReason || 'The uploader has turned off playback on other sites.';
      add('Can play inside this app', 'fail', 'The uploader has turned off embedding.');
    } else {
      add('Can play inside this app', 'ok', 'Embedding allowed.');
    }

    // 3. Region
    const rr = cd.regionRestriction;
    if (rr && country) {
      const cc = country.toUpperCase();
      const blocked = (rr.blocked && rr.blocked.indexOf(cc) !== -1) || (rr.allowed && rr.allowed.indexOf(cc) === -1);
      if (blocked) {
        report.playable = false; report.blockReason = report.blockReason || ('Blocked in your region (' + cc + ').');
        add('Available in your region', 'fail', 'Blocked in ' + cc + '.');
      } else {
        add('Available in your region', 'ok', 'Available in ' + cc + ' (restricted in some other countries).');
      }
    } else {
      add('Available in your region', rr ? 'warn' : 'ok', rr ? 'Has region restrictions; set your country in Settings to check.' : 'No region restrictions.');
    }

    // 4. Age restriction (embeds of age-restricted videos usually fail)
    if (cd.contentRating && cd.contentRating.ytRating === 'ytAgeRestricted') {
      report.playable = false; report.blockReason = report.blockReason || 'Age-restricted videos cannot play in embedded players.';
      add('Not age-restricted', 'fail', 'Age-restricted videos usually refuse to play outside YouTube.');
    }

    // 5. Spoken language
    add('Spoken language', report.audioLanguage ? 'ok' : 'warn',
      report.audioLanguage ? LL.languages.nameOf(report.audioLanguage) + ' (set by the uploader)' : 'Not set by the uploader - choose it yourself.');

    // 6. Captions (costs 50 quota units)
    try {
      const c = await ytFetch('captions', { part: 'snippet', videoId: videoId }, apiKey);
      report.captionTracks = (c.items || []).map(function (it) {
        const s = it.snippet || {};
        return { language: s.language, name: s.name, kind: s.trackKind, auto: s.trackKind === 'asr' || s.trackKind === 'ASR' };
      });
      const human = report.captionTracks.filter(function (t) { return !t.auto; });
      const auto = report.captionTracks.filter(function (t) { return t.auto; });
      if (!report.captionTracks.length) {
        add('Subtitles on YouTube', 'warn', 'None. Load your own subtitle file to study line by line.');
      } else {
        const fmt = function (arr) { return arr.map(function (t) { return LL.languages.nameOf(t.language); }).join(', '); };
        let d = '';
        if (human.length) d += 'Human-made: ' + fmt(human) + '. ';
        if (auto.length) d += 'Automatic (raw speech recognition): ' + fmt(auto) + '.';
        add('Subtitles on YouTube', human.length ? 'ok' : 'warn', d.trim());
      }
    } catch (e) {
      add('Subtitles on YouTube', 'unknown', 'Could not list subtitles: ' + e.message);
    }

    // 7. Subtitle text access (the YouTube API only allows the video owner to download caption text)
    add('Subtitle text available to the app', 'warn',
      'YouTube only lets the video owner download subtitle text, so pause-per-line, translation and text-to-speech need your own subtitle file (.srt / .vtt).');

    // 8. YouTube built-in auto-translate
    add('YouTube auto-translate in the player', report.captionTracks.length ? 'ok' : 'warn',
      report.captionTracks.length ? 'Can be switched on in the player\'s CC settings (shown on screen only).' : 'Needs a subtitle track on YouTube.');

    if (report.playable === null) report.playable = true;
    return report;
  }

  const api = { parseLink, parseIsoDuration, classify, checkYouTube, DRM_SITES };
  root.LL = root.LL || {};
  root.LL.linkcheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
