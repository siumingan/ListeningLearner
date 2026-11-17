/* ListeningLearner - turn timed words into subtitle lines (same rules as pipeline.py) */
(function (root) {
  'use strict';

  const SENTENCE_END = /[.!?。！？…]["'”’)\]]*$/;
  const CLAUSE_END = /[,;:，、；：]$/;
  const CJK = /[぀-ヿ㐀-鿿가-힯]/;
  const NAMES = {
    english: 'en', chinese: 'zh-CN', japanese: 'ja', korean: 'ko', spanish: 'es', french: 'fr',
    german: 'de', italian: 'it', portuguese: 'pt', russian: 'ru', arabic: 'ar', hindi: 'hi',
    thai: 'th', vietnamese: 'vi', indonesian: 'id', turkish: 'tr', dutch: 'nl', polish: 'pl',
    ukrainian: 'uk', cantonese: 'zh-TW'
  };

  function textOf(ws) { return ws.map(function (w) { return w.text; }).join('').replace(/\s+/g, ' ').trim(); }

  /** words: [{start, end, text}] -> lines [{start, end, text, index}] */
  function wordsToLines(words, maxChars, maxDur, minDur) {
    maxChars = maxChars || 84; maxDur = maxDur || 7; minDur = minDur || 0.6;
    const lines = [];
    let cur = [];
    const flush = function () {
      if (cur.length) {
        const t = textOf(cur);
        if (t) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: t });
        cur = [];
      }
    };
    words.forEach(function (w) {
      cur.push(w);
      const t = textOf(cur);
      const dur = cur[cur.length - 1].end - cur[0].start;
      const limit = CJK.test(t) ? Math.floor(maxChars / 2) : maxChars;
      if (SENTENCE_END.test(w.text.trim()) && dur >= minDur) {
        flush();
      } else if (t.length >= limit || dur >= maxDur) {
        let cut = -1;
        for (let i = cur.length - 1; i > 0; i--) {
          if (CLAUSE_END.test(cur[i].text.trim())) { cut = i + 1; break; }
        }
        if (cut > 0 && cut < cur.length) {
          const rest = cur.slice(cut);
          cur = cur.slice(0, cut);
          flush();
          cur = rest;
        } else {
          flush();
        }
      }
    });
    flush();
    lines.forEach(function (l, i) { l.index = i; });
    return lines;
  }

  /** OpenAI verbose_json (words and/or segments) -> lines */
  function fromOpenAI(data) {
    const words = (data && data.words) || [];
    if (words.length) {
      return wordsToLines(words.map(function (w) {
        const t = String(w.word || '').trim();
        return { start: w.start, end: w.end, text: (CJK.test(t) || !/^[\p{L}\p{N}"'(¿¡]/u.test(t)) ? t : ' ' + t };
      }));
    }
    return ((data && data.segments) || []).filter(function (s) { return String(s.text || '').trim(); })
      .map(function (s, i) { return { start: s.start, end: s.end, text: s.text.trim(), index: i }; });
  }

  function ts(t) {
    let ms = Math.round(Math.max(0, t) * 1000);
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000); ms -= s * 1000;
    const p = function (n, w) { return String(n).padStart(w, '0'); };
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(ms, 3);
  }

  function toSrt(lines) {
    return lines.map(function (l, i) {
      return (i + 1) + '\n' + ts(l.start) + ' --> ' + ts(l.end) + '\n' + l.text + '\n';
    }).join('\n');
  }

  function langFromName(name) {
    if (!name) return '';
    const n = String(name).toLowerCase();
    if (NAMES[n]) return NAMES[n];
    return n.split('-')[0] === 'zh' ? 'zh-CN' : n.split('-')[0];
  }

  const api = { wordsToLines: wordsToLines, fromOpenAI: fromOpenAI, toSrt: toSrt, langFromName: langFromName };
  root.LL = root.LL || {};
  root.LL.lines = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
