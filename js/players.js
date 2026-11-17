/* ListeningLearner - player adapters with one common interface
 *   play(), pause(), seek(t), getTime(), isPaused(), setRate(r), getDuration(), destroy()
 */
(function (root) {
  'use strict';

  /* ---------- Local / direct video file (HTML5 <video>) ---------- */
  function HtmlVideoPlayer(videoEl) {
    this.el = videoEl;
    this.kind = 'html5';
  }
  HtmlVideoPlayer.prototype.load = function (src) {
    const el = this.el;
    return new Promise(function (resolve, reject) {
      const ok = function () { cleanup(); resolve(); };
      const bad = function () {
        cleanup();
        const code = el.error ? el.error.code : 0;
        reject(new Error(code === 4
          ? 'This browser cannot play this video format. Try MP4 (H.264) or WebM.'
          : 'The video could not be loaded.'));
      };
      const cleanup = function () { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); };
      el.addEventListener('loadedmetadata', ok);
      el.addEventListener('error', bad);
      el.src = src;
      el.load();
    });
  };
  HtmlVideoPlayer.prototype.play = function () { const p = this.el.play(); if (p && p.catch) p.catch(function () {}); };
  HtmlVideoPlayer.prototype.pause = function () { this.el.pause(); };
  HtmlVideoPlayer.prototype.seek = function (t) { this.el.currentTime = Math.max(0, t); };
  HtmlVideoPlayer.prototype.getTime = function () { return this.el.currentTime || 0; };
  HtmlVideoPlayer.prototype.isPaused = function () { return this.el.paused; };
  HtmlVideoPlayer.prototype.setRate = function (r) { this.el.playbackRate = r; };
  HtmlVideoPlayer.prototype.getDuration = function () { return this.el.duration || 0; };
  HtmlVideoPlayer.prototype.destroy = function () {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  };

  /* ---------- YouTube (official IFrame Player API) ---------- */
  let ytApiPromise = null;
  function loadYouTubeApi() {
    if (root.YT && root.YT.Player) return Promise.resolve(root.YT);
    if (ytApiPromise) return ytApiPromise;
    ytApiPromise = new Promise(function (resolve, reject) {
      const prev = root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') prev();
        resolve(root.YT);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = function () { ytApiPromise = null; reject(new Error('Could not load the YouTube player. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return ytApiPromise;
  }

  const YT_ERRORS = {
    2: 'Invalid video id.',
    5: 'The video cannot be played in this browser.',
    100: 'Video not found, private or removed.',
    101: 'The uploader does not allow this video to play on other sites.',
    150: 'The uploader does not allow this video to play on other sites.',
    152: 'The uploader does not allow this video to play on other sites.',
    153: 'YouTube refused to play because the page has no web address. Start the app with start.bat instead of opening index.html directly.'
  };

  function YouTubePlayer(containerId) {
    this.containerId = containerId;
    this.kind = 'youtube';
    this.player = null;
    this.onError = null;
  }
  /** opts: { start, ccLang, showCaptions } */
  YouTubePlayer.prototype.load = function (videoId, opts) {
    const self = this;
    opts = opts || {};
    return loadYouTubeApi().then(function (YT) {
      return new Promise(function (resolve, reject) {
        let ready = false;
        const vars = {
          playsinline: 1, rel: 0, modestbranding: 1, enablejsapi: 1,
          origin: root.location && root.location.origin && root.location.origin !== 'null' ? root.location.origin : undefined,
          start: opts.start ? Math.floor(opts.start) : undefined
        };
        if (opts.showCaptions) { vars.cc_load_policy = 1; if (opts.ccLang) vars.cc_lang_pref = opts.ccLang; }
        Object.keys(vars).forEach(function (k) { if (vars[k] === undefined) delete vars[k]; });
        self.player = new YT.Player(self.containerId, {
          videoId: videoId,
          width: '100%', height: '100%',
          playerVars: vars,
          events: {
            onReady: function () { ready = true; resolve(); },
            onError: function (e) {
              const msg = YT_ERRORS[e.data] || ('YouTube player error ' + e.data);
              const err = new Error(msg); err.code = e.data;
              if (!ready) reject(err);
              if (typeof self.onError === 'function') self.onError(err);
            }
          }
        });
      });
    });
  };
  YouTubePlayer.prototype.play = function () { if (this.player) this.player.playVideo(); };
  YouTubePlayer.prototype.pause = function () { if (this.player) this.player.pauseVideo(); };
  YouTubePlayer.prototype.seek = function (t) { if (this.player) this.player.seekTo(Math.max(0, t), true); };
  YouTubePlayer.prototype.getTime = function () { return this.player && this.player.getCurrentTime ? this.player.getCurrentTime() || 0 : 0; };
  YouTubePlayer.prototype.isPaused = function () {
    if (!this.player || !this.player.getPlayerState) return true;
    const s = this.player.getPlayerState();
    return s !== 1 && s !== 3; // 1 = playing, 3 = buffering
  };
  YouTubePlayer.prototype.setRate = function (r) { if (this.player && this.player.setPlaybackRate) this.player.setPlaybackRate(r); };
  YouTubePlayer.prototype.getDuration = function () { return this.player && this.player.getDuration ? this.player.getDuration() : 0; };
  YouTubePlayer.prototype.destroy = function () {
    if (this.player && this.player.destroy) this.player.destroy();
    this.player = null;
  };

  root.LL = root.LL || {};
  root.LL.players = { HtmlVideoPlayer: HtmlVideoPlayer, YouTubePlayer: YouTubePlayer };
})(typeof window !== 'undefined' ? window : globalThis);
