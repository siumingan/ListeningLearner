/* ListeningLearner - connection to the PC server (server.py)
 *
 * On the PC the app talks to http://localhost. On a phone in Wi-Fi mode, the page is opened
 * from the PC's address with an access key (?t=KEY). The key is remembered on the phone and
 * sent with every request, so other devices on the network can't use your PC.
 */
(function (root) {
  'use strict';
  const KEY_STORE = 'listeningLearner.accessKey';

  function readKey() {
    let key = '';
    try {
      const u = new URL(root.location.href);
      key = u.searchParams.get('t') || '';
      if (key) {
        localStorage.setItem(KEY_STORE, key);
        // remove the key from the address bar (it stays saved)
        u.searchParams.delete('t');
        root.history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      } else {
        key = localStorage.getItem(KEY_STORE) || '';
      }
    } catch (e) { /* storage unavailable */ }
    return key;
  }

  const token = readKey();

  function withKey(url) {
    if (!token) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + encodeURIComponent(token);
  }

  /** fetch() to the PC server with the access key. */
  function api(path, opts) {
    opts = opts || {};
    const headers = new Headers(opts.headers || {});
    headers.set('X-LL-Client', '1');   // the server refuses changes from other websites without this
    if (token) headers.set('X-LL-Token', token);
    return fetch(path, Object.assign({}, opts, { headers: headers, cache: 'no-store' }));
  }

  /** URL of a library file (usable in <video src> and download links). */
  function media(id, file) {
    return withKey('/media/' + encodeURIComponent(id) + '/' + encodeURIComponent(file));
  }

  root.LL = root.LL || {};
  root.LL.server = { api: api, media: media, token: token };
})(window);
