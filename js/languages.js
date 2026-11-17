/* ListeningLearner - supported languages
 * code: used for translation APIs; tts: BCP-47 tag used to pick a speech voice */
(function (root) {
  'use strict';
  const LANGUAGES = [
    { code: 'en',    name: 'English',               tts: 'en-US' },
    { code: 'zh-CN', name: 'Chinese (Simplified)',  tts: 'zh-CN' },
    { code: 'zh-TW', name: 'Chinese (Traditional)', tts: 'zh-TW' },
    { code: 'ja',    name: 'Japanese',              tts: 'ja-JP' },
    { code: 'ko',    name: 'Korean',                tts: 'ko-KR' },
    { code: 'es',    name: 'Spanish',               tts: 'es-ES' },
    { code: 'fr',    name: 'French',                tts: 'fr-FR' },
    { code: 'de',    name: 'German',                tts: 'de-DE' },
    { code: 'it',    name: 'Italian',               tts: 'it-IT' },
    { code: 'pt',    name: 'Portuguese',            tts: 'pt-BR' },
    { code: 'ru',    name: 'Russian',               tts: 'ru-RU' },
    { code: 'ar',    name: 'Arabic',                tts: 'ar-SA' },
    { code: 'hi',    name: 'Hindi',                 tts: 'hi-IN' },
    { code: 'th',    name: 'Thai',                  tts: 'th-TH' },
    { code: 'vi',    name: 'Vietnamese',            tts: 'vi-VN' },
    { code: 'id',    name: 'Indonesian',            tts: 'id-ID' },
    { code: 'tr',    name: 'Turkish',               tts: 'tr-TR' },
    { code: 'nl',    name: 'Dutch',                 tts: 'nl-NL' },
    { code: 'pl',    name: 'Polish',                tts: 'pl-PL' },
    { code: 'uk',    name: 'Ukrainian',             tts: 'uk-UA' }
  ];

  function byCode(code) {
    if (!code) return null;
    const c = String(code).toLowerCase();
    return LANGUAGES.find(function (l) { return l.code.toLowerCase() === c; }) ||
           LANGUAGES.find(function (l) { return c.split('-')[0] === l.code.toLowerCase().split('-')[0]; }) ||
           null;
  }

  function nameOf(code) {
    const l = byCode(code);
    return l ? l.name : code;
  }

  const api = { LANGUAGES, byCode, nameOf };
  root.LL = root.LL || {};
  root.LL.languages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
