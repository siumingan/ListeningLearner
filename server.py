"""ListeningLearner local server.

Serves the app at http://localhost:8765/ and runs the download -> speech-to-text pipeline.
Only listens on this computer (127.0.0.1).

  python server.py [--port 8765] [--library PATH] [--no-browser]
"""
import argparse
import json
import mimetypes
import os
import queue
import re
import secrets
import socket
import shutil
import sys
import threading
import traceback
import webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

import pipeline

APP_DIR = os.path.dirname(os.path.abspath(__file__))
VERSION = '2.0'

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('text/vtt', '.vtt')
mimetypes.add_type('text/plain', '.srt')
mimetypes.add_type('audio/mp4', '.m4a')
mimetypes.add_type('audio/webm', '.weba')
mimetypes.add_type('audio/ogg', '.opus')


def default_library():
    if os.environ.get('LL_LIBRARY'):
        return os.environ['LL_LIBRARY']
    local = os.environ.get('LOCALAPPDATA')
    if local:  # Windows: keep big media files out of OneDrive
        return os.path.join(local, 'ListeningLearner', 'library')
    return os.path.join(APP_DIR, 'library')


LIBRARY = default_library()
JOBS = {}
JOBS_LOCK = threading.Lock()
WORK = queue.Queue()
ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
ACCESS_KEY = ''          # set in --lan mode: phones must send it
LAN_MODE = False


def load_access_key():
    """A short key that phones must send. Kept in a file so a home-screen app keeps working after restarts."""
    path = os.path.join(os.path.dirname(LIBRARY), 'phone-access-key.txt')
    try:
        with open(path, encoding='utf-8') as f:
            key = f.read().strip()
            if re.match(r'^[a-z0-9]{6,32}$', key):
                return key
    except OSError:
        pass
    key = ''.join(secrets.choice('abcdefghjkmnpqrstuvwxyz23456789') for _ in range(8))
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(key)
    except OSError:
        pass
    return key


def lan_addresses():
    ips = set()
    try:  # the address used for the default route (no data is sent)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.0.2.1', 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.') and not ip.startswith('169.254.'))


# ---------------------------------------------------------------- jobs
def set_job(job_id, **kw):
    with JOBS_LOCK:
        JOBS[job_id].update(kw)


def public_job(job):
    return {k: job.get(k) for k in ('id', 'status', 'step', 'progress', 'message', 'error', 'item', 'title', 'source')}


def worker():
    while True:
        job = WORK.get()
        job_id = job['id']
        set_job(job_id, status='running', step=1, progress=0.0, message='Starting')

        def report(step, frac, msg):
            set_job(job_id, step=step, progress=round(float(frac), 3), message=msg)

        try:
            info = pipeline.run(job, LIBRARY, report)
            set_job(job_id, status='done', step=3, progress=1.0, message='Ready', item=info)
        except pipeline.PipelineError as e:
            set_job(job_id, status='error', error=str(e), message=str(e))
            cleanup_failed(job_id)
        except Exception as e:  # unexpected: keep the details in the console
            traceback.print_exc()
            set_job(job_id, status='error', error='Unexpected error: %s' % e, message=str(e))
            cleanup_failed(job_id)
        finally:
            job.pop('openai_key', None)
            WORK.task_done()


def cleanup_failed(job_id):
    folder = os.path.join(LIBRARY, job_id)
    if os.path.isdir(folder) and not os.path.exists(os.path.join(folder, 'info.json')):
        shutil.rmtree(folder, ignore_errors=True)


def enqueue(job):
    job.setdefault('id', pipeline.new_id())
    with JOBS_LOCK:
        JOBS[job['id']] = {'id': job['id'], 'status': 'queued', 'step': 0, 'progress': 0.0,
                           'message': 'Waiting in line', 'title': job.get('title') or job.get('url') or '',
                           'source': job.get('url') or 'upload'}
    WORK.put(job)
    return job['id']


def list_library():
    items = []
    if os.path.isdir(LIBRARY):
        for name in os.listdir(LIBRARY):
            p = os.path.join(LIBRARY, name, 'info.json')
            if os.path.isfile(p):
                try:
                    with open(p, encoding='utf-8') as f:
                        items.append(json.load(f))
                except Exception:
                    pass
    items.sort(key=lambda i: i.get('id', ''), reverse=True)
    return items


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = 'ListeningLearner/' + VERSION

    def log_message(self, fmt, *args):  # keep the console quiet except errors
        if args and str(args[1] if len(args) > 1 else '').startswith(('4', '5')):
            sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    # ---- access control
    def is_local(self):
        return self.client_address[0] in ('127.0.0.1', '::1', '::ffff:127.0.0.1')

    def key_ok(self):
        """This computer is always allowed; phones need the access key."""
        if self.is_local():
            return True
        if not ACCESS_KEY:
            return False
        q = parse_qs(urlparse(self.path).query)
        given = self.headers.get('X-LL-Token') or (q.get('t') or [''])[0]
        return secrets.compare_digest(given, ACCESS_KEY)

    def deny(self):
        self.send_json({'error': 'Access key missing or wrong. Open the address shown in the app window on your PC.'}, 401)

    def from_app(self):
        """Changes must come from the app itself (other websites cannot add this header)."""
        return self.headers.get('X-LL-Client') == '1'

    # ---- helpers
    def send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 1_000_000:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode('utf-8'))
        except Exception:
            return {}

    def send_file(self, path, allow_range=False):
        if not os.path.isfile(path):
            self.send_error(404)
            return
        size = os.path.getsize(path)
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype == 'application/javascript':
            ctype += '; charset=utf-8'
        start, end = 0, size - 1
        rng = self.headers.get('Range') if allow_range else None
        m = re.match(r'bytes=(\d*)-(\d*)$', rng or '')
        if m and size:
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
            elif m.group(2):  # suffix range: last N bytes
                start = max(0, size - int(m.group(2)))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.end_headers()
                return
            self.send_response(206)
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        else:
            self.send_response(200)
        length = end - start + 1 if size else 0
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes' if allow_range else 'none')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        if self.command == 'HEAD':
            return
        try:
            with open(path, 'rb') as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(256 * 1024, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # the browser stopped reading (normal while seeking)

    # ---- routes
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urlparse(self.path)
        path = unquote(url.path)

        if (path.startswith('/api/') or path.startswith('/media/')) and not self.key_ok():
            return self.deny()
        if path == '/api/phone':
            if not self.is_local():
                return self.send_error(403)
            return self.send_json({'lan': LAN_MODE, 'urls': ['http://%s:%d/?t=%s' % (ip, self.server.server_address[1], ACCESS_KEY)
                                                            for ip in lan_addresses()] if LAN_MODE else []})
        if path == '/api/phone-qr':
            if not self.is_local() or not LAN_MODE:
                return self.send_error(403)
            data = (parse_qs(url.query).get('u') or [''])[0]
            if not data.startswith('http://'):
                return self.send_error(400)
            try:
                import qrcode
                import qrcode.image.svg
                svg = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=12, border=2).to_string()
            except Exception:
                return self.send_error(404)
            self.send_response(200)
            self.send_header('Content-Type', 'image/svg+xml')
            self.send_header('Content-Length', str(len(svg)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(svg)
            return
        if path == '/api/health':
            tools = pipeline.check_tools()
            return self.send_json({'ok': True, 'version': VERSION, 'library': LIBRARY, **tools})
        if path == '/api/python':
            import platform
            return self.send_json({'found': True, 'version': platform.python_version(),
                                   'command': sys.executable, 'mode': 'full'})
        if path == '/api/library':
            return self.send_json({'items': list_library()})
        m = re.match(r'^/api/jobs/([A-Za-z0-9_-]+)$', path)
        if m:
            with JOBS_LOCK:
                job = JOBS.get(m.group(1))
                out = public_job(job) if job else None
            return self.send_json(out or {'error': 'Unknown job'}, 200 if out else 404)
        if path == '/api/jobs':
            with JOBS_LOCK:
                return self.send_json({'jobs': [public_job(j) for j in JOBS.values()]})
        m = re.match(r'^/media/([A-Za-z0-9_-]+)/([^/\\]+)$', path)
        if m:
            if not ID_RE.match(m.group(1)) or m.group(2).startswith('.'):
                return self.send_error(400)
            return self.send_file(os.path.join(LIBRARY, m.group(1), m.group(2)), allow_range=True)

        # static app files
        rel = path.lstrip('/') or 'index.html'
        full = os.path.abspath(os.path.join(APP_DIR, rel))
        if not full.startswith(APP_DIR + os.sep) or '.venv' in full.split(os.sep) or full.endswith('.py'):
            return self.send_error(403)
        return self.send_file(full)

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path
        if not self.key_ok():
            return self.deny()
        if not self.from_app():
            return self.send_json({'error': 'Requests must come from the ListeningLearner app.'}, 403)
        if path == '/api/jobs':
            body = self.read_json()
            link = (body.get('url') or '').strip()
            if not re.match(r'^https?://', link, re.I):
                return self.send_json({'error': 'Paste a full link starting with http:// or https://'}, 400)
            job = {
                'url': link,
                'language': body.get('language') or 'auto',
                'engine': body.get('engine') or 'local',
                'model': body.get('model') or 'small',
                'openai_key': body.get('openaiKey') or '',
                'keep_video': bool(body.get('keepVideo')),
                'prefer_site_subs': body.get('preferSiteSubs', True) is not False,
            }
            return self.send_json({'id': enqueue(job)})

        if path == '/api/upload':
            q = parse_qs(url.query)
            name = os.path.basename(q.get('name', ['upload'])[0]) or 'upload'
            ext = os.path.splitext(name)[1].lower()
            if not re.match(r'^\.[a-z0-9]{1,5}$', ext):
                return self.send_json({'error': 'Unsupported file type.'}, 400)
            n = int(self.headers.get('Content-Length') or 0)
            if n <= 0:
                return self.send_json({'error': 'Empty file.'}, 400)
            job_id = pipeline.new_id()
            folder = os.path.join(LIBRARY, job_id)
            os.makedirs(folder, exist_ok=True)
            dest = os.path.join(folder, 'media' + ext)
            left = n
            with open(dest, 'wb') as f:
                while left > 0:
                    chunk = self.rfile.read(min(1024 * 1024, left))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            if left > 0:
                shutil.rmtree(folder, ignore_errors=True)
                return self.send_json({'error': 'Upload was interrupted.'}, 400)
            job = {
                'id': job_id,
                'upload_path': dest,
                'title': os.path.splitext(name)[0],
                'language': q.get('language', ['auto'])[0],
                'engine': q.get('engine', ['local'])[0],
                'model': q.get('model', ['small'])[0],
                'openai_key': self.headers.get('X-OpenAI-Key') or '',
            }
            return self.send_json({'id': enqueue(job)})

        self.send_error(404)

    def do_DELETE(self):
        if not self.key_ok():
            return self.deny()
        if not self.from_app():
            return self.send_json({'error': 'Requests must come from the ListeningLearner app.'}, 403)
        m = re.match(r'^/api/library/([A-Za-z0-9_-]+)$', urlparse(self.path).path)
        if not m or not ID_RE.match(m.group(1)):
            return self.send_error(400)
        folder = os.path.join(LIBRARY, m.group(1))
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
        return self.send_json({'ok': True})


def main():
    global LIBRARY
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--library', default=LIBRARY)
    ap.add_argument('--no-browser', action='store_true')
    ap.add_argument('--lan', action='store_true', help='let phones on the same Wi-Fi use the app (needs the access key)')
    args = ap.parse_args()
    global ACCESS_KEY, LAN_MODE
    LIBRARY = os.path.abspath(args.library)
    os.makedirs(LIBRARY, exist_ok=True)
    LAN_MODE = args.lan
    if LAN_MODE:
        ACCESS_KEY = load_access_key()

    threading.Thread(target=worker, daemon=True).start()
    try:
        httpd = ThreadingHTTPServer(('0.0.0.0' if LAN_MODE else '127.0.0.1', args.port), Handler)
    except OSError:
        print('Port %d is busy. Is ListeningLearner already running? Try: start.bat %d' % (args.port, args.port + 1))
        sys.exit(1)
    url = 'http://localhost:%d/' % args.port
    tools = pipeline.check_tools()
    print()
    print('  ListeningLearner is running at ' + url)
    print('  Library (downloads and transcripts): ' + LIBRARY)
    print('  Downloader: %s   Local AI transcription: %s' %
          ('ready' if tools['ytdlp'] else 'NOT installed', 'ready' if tools['whisper'] else 'NOT installed'))
    if LAN_MODE:
        ips = lan_addresses()
        print()
        print('  PHONE: connect the phone to the same Wi-Fi and open:')
        for ip in ips or ['<this PC\'s IP address>']:
            print('     http://%s:%d/?t=%s' % (ip, args.port, ACCESS_KEY))
        print('  (or click "Use on phone" in the app on this PC to see a QR code)')
        print('  If Windows asks about the firewall, allow access on PRIVATE networks only.')
    print('  Keep this window open while you use the app. Press Ctrl+C to stop.')
    print()
    if not args.no_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
