/* ListeningLearner - subtitle parsing (SRT and WebVTT) */
(function (root) {
  'use strict';

  function parseTimestamp(str) {
    // Accepts "HH:MM:SS,mmm", "HH:MM:SS.mmm", "MM:SS.mmm"
    const m = String(str).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
    if (!m) return NaN;
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const min = parseInt(m[2], 10);
    const s = parseInt(m[3], 10);
    const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  function cleanText(text) {
    return text
      .replace(/<[^>]+>/g, '')          // HTML / VTT tags like <i>, <c.yellow>, <00:01.000>
      .replace(/\{\\[^}]*\}/g, '')       // ASS-style override tags {\an8}
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Parse SRT or VTT text into cues: [{ start, end, text }], sorted by start.
   */
  function parseSubtitles(raw) {
    if (typeof raw !== 'string') return [];
    const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const blocks = text.split(/\n{2,}/);
    const cues = [];
    const arrow = /((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/;

    for (const block of blocks) {
      const lines = block.split('\n');
      const idx = lines.findIndex(function (l) { return arrow.test(l); });
      if (idx === -1) continue; // WEBVTT header, NOTE, STYLE, numbering-only blocks
      const m = lines[idx].match(arrow);
      const start = parseTimestamp(m[1]);
      const end = parseTimestamp(m[2]);
      if (isNaN(start) || isNaN(end) || end <= start) continue;
      const body = cleanText(lines.slice(idx + 1).join('\n'));
      if (!body) continue;
      cues.push({ start: start, end: end, text: body });
    }
    cues.sort(function (a, b) { return a.start - b.start; });
    cues.forEach(function (c, i) { c.index = i; });
    return cues;
  }

  /** Index of the cue showing at time t, or -1. */
  function findCueAt(cues, t) {
    let lo = 0, hi = cues.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (found !== -1 && t < cues[found].end) return found;
    return -1;
  }

  /** Index of the last cue that started at or before t (or -1). */
  function findLastStarted(cues, t) {
    let lo = 0, hi = cues.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found;
  }

  function formatTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = Math.floor(t % 60);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  const api = { parseSubtitles, parseTimestamp, findCueAt, findLastStarted, formatTime };
  root.LL = root.LL || {};
  root.LL.subtitles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
