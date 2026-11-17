"""ListeningLearner pipeline

Step 1  download the sound from a link (yt-dlp: YouTube, Vimeo, Bilibili, TikTok, news sites, ... 1000+ sites)
        or take a file the user uploaded
Step 2  turn speech into timed text:
          a) use the site's own human-made subtitles when they exist (exact text, no AI needed)
          b) otherwise AI speech-to-text: local Whisper (faster-whisper, free, offline)
             or OpenAI's transcription API (fast on any PC, small cost)
Step 3  text-to-speech happens in the app ("Hear it clearly"), line by line.

Output per item, in the library folder:
  <id>/media.<ext>   the sound (or video, if "keep picture" was chosen)
  <id>/subs.srt      timed lines
  <id>/info.json     title, source, language, how the text was made
"""
import json
import os
import re
import time
import uuid
import urllib.request
import urllib.error

SENTENCE_END = re.compile(r'[.!?。！？…]["\'”’)\]]*$')
CLAUSE_END = re.compile(r'[,;:，、；：]$')
CJK = re.compile(r'[぀-ヿ㐀-鿿가-힯]')

# Whisper / OpenAI language names -> codes used by the app
LANG_NAMES = {
    'english': 'en', 'chinese': 'zh-CN', 'japanese': 'ja', 'korean': 'ko', 'spanish': 'es',
    'french': 'fr', 'german': 'de', 'italian': 'it', 'portuguese': 'pt', 'russian': 'ru',
    'arabic': 'ar', 'hindi': 'hi', 'thai': 'th', 'vietnamese': 'vi', 'indonesian': 'id',
    'turkish': 'tr', 'dutch': 'nl', 'polish': 'pl', 'ukrainian': 'uk', 'cantonese': 'zh-TW',
}


class PipelineError(Exception):
    """An error with a message that can be shown to the user."""


def new_id():
    return time.strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6]


def base_lang(code):
    return (code or '').split('-')[0].lower()


def app_lang(code):
    """Normalise a language code/name to the app's codes (zh -> zh-CN)."""
    if not code:
        return ''
    c = str(code).strip()
    if c.lower() in LANG_NAMES:
        return LANG_NAMES[c.lower()]
    b = base_lang(c)
    if b == 'zh':
        return 'zh-TW' if re.search(r'tw|hant|hk', c, re.I) else 'zh-CN'
    return b


MIN_PYTHON = (3, 9)


def check_tools():
    """Report Python and package versions for the System check."""
    import sys
    import platform
    out = {
        'python': platform.python_version(),
        'python_ok': sys.version_info[:2] >= MIN_PYTHON,
        'python_path': sys.executable,
        'ytdlp': False, 'ytdlp_version': '',
        'whisper': False, 'whisper_version': '',
        'ffmpeg': False, 'gpu': False,
    }
    try:
        import yt_dlp
        out['ytdlp'] = True
        try:
            from yt_dlp.version import __version__ as v
            out['ytdlp_version'] = v
        except Exception:
            pass
    except ImportError:
        pass
    try:
        import faster_whisper
        out['whisper'] = True
        out['whisper_version'] = getattr(faster_whisper, '__version__', '')
        try:
            import ctranslate2
            out['gpu'] = ctranslate2.get_cuda_device_count() > 0
        except Exception:
            pass
    except ImportError:
        pass
    from shutil import which
    out['ffmpeg'] = bool(which('ffmpeg'))
    return out


# --------------------------------------------------------------------------
# Step 1: download
# --------------------------------------------------------------------------
def _pick_sub_lang(subs, want):
    """Pick a human-made subtitle track matching the wanted language."""
    if not subs or not want:
        return None
    keys = [k for k in subs.keys() if k != 'live_chat']
    w = want.lower()
    for k in keys:  # exact
        if k.lower() == w:
            return k
    for k in keys:  # same base language (en-US, en-GB, zh-Hans ...)
        if base_lang(k) == base_lang(w):
            return k
    return None


def download(url, folder, language='auto', keep_video=False, progress=None):
    """Download the sound (and the site's own subtitles if any). Returns a dict."""
    try:
        import yt_dlp
    except ImportError:
        raise PipelineError('The downloader (yt-dlp) is not installed. Run start.bat again to install it.')

    def hook(d):
        if progress and d.get('status') == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            if total:
                progress(min(0.99, d.get('downloaded_bytes', 0) / total), 'Downloading')
        if progress and d.get('status') == 'finished':
            progress(1.0, 'Downloaded')

    # single-file formats so ffmpeg is not required
    fmt = ('best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/best'
           if keep_video else
           'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[ext=webm]/bestaudio/best[acodec!=none]')
    base_opts = {'quiet': True, 'no_warnings': True, 'noplaylist': True, 'noprogress': True}

    try:
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:  # yt-dlp raises DownloadError with useful text
        raise PipelineError(_friendly_download_error(e))

    if info.get('_type') == 'playlist':
        raise PipelineError('This is a playlist or channel. Paste the link of a single video.')

    site_lang = info.get('language') or ''
    want = site_lang if language in ('', 'auto', None) else language
    sub_key = _pick_sub_lang(info.get('subtitles') or {}, want)

    opts = dict(base_opts)
    opts.update({
        'format': fmt,
        'outtmpl': os.path.join(folder, 'media.%(ext)s'),
        'progress_hooks': [hook],
    })
    if sub_key:
        opts.update({'writesubtitles': True, 'writeautomaticsub': False,
                     'subtitleslangs': [sub_key], 'subtitlesformat': 'vtt/srt/best'})
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
    except Exception as e:
        raise PipelineError(_friendly_download_error(e))

    media, subs = None, None
    for name in os.listdir(folder):
        low = name.lower()
        if low.startswith('media.') and low.endswith(('.vtt', '.srt', '.ass', '.ttml', '.srv3', '.json3')):
            subs = os.path.join(folder, name)
        elif low.startswith('media.') and not low.endswith(('.part', '.ytdl', '.json')):
            media = os.path.join(folder, name)
    if not media:
        raise PipelineError('The download finished but no sound file was found.')
    if subs and not subs.lower().endswith(('.vtt', '.srt')):
        subs = None  # a subtitle format the app cannot read; fall back to AI

    return {
        'title': info.get('title') or 'Untitled',
        'source_url': info.get('webpage_url') or url,
        'site': info.get('extractor_key') or '',
        'duration': info.get('duration') or 0,
        'media': media,
        'site_subtitles': subs,
        'language': app_lang(sub_key or site_lang or (language if language not in ('auto', '') else '')),
        'has_video': keep_video,
    }


def _friendly_download_error(e):
    msg = re.sub(r'\x1b\[[0-9;]*m', '', str(e)).replace('ERROR: ', '').strip()
    low = msg.lower()
    if 'drm' in low:
        return 'This video is DRM-protected, so it cannot be downloaded.'
    if 'unsupported url' in low:
        return 'This website is not supported by the downloader. Try the page of a single video.'
    if 'private' in low or 'sign in' in low or 'login' in low:
        return 'This video needs a login or is private. ' + msg[:200]
    if 'not available' in low or 'unavailable' in low or '404' in low:
        return 'The video is not available (removed, private or blocked in your region).'
    if 'urlopen error' in low or 'getaddrinfo' in low or 'timed out' in low:
        return 'Could not reach the website. Check your internet connection.'
    return 'Download failed: ' + msg[:300]


# --------------------------------------------------------------------------
# Step 2: speech to text
# --------------------------------------------------------------------------
def _is_cjk(text):
    return bool(CJK.search(text or ''))


def words_to_lines(words, max_chars=84, max_dur=7.0, min_dur=0.6):
    """Group timed words [(start, end, text)] into subtitle lines at natural breaks."""
    lines, cur = [], []

    def text_of(ws):
        joined = ''.join(w[2] for w in ws)
        return re.sub(r'\s+', ' ', joined).strip()

    def flush():
        if cur:
            t = text_of(cur)
            if t:
                lines.append({'start': cur[0][0], 'end': cur[-1][1], 'text': t})
            cur.clear()

    for w in words:
        cur.append(w)
        t = text_of(cur)
        dur = cur[-1][1] - cur[0][0]
        limit = max_chars // 2 if _is_cjk(t) else max_chars
        token = w[2].strip()
        if SENTENCE_END.search(token) and dur >= min_dur:
            flush()
        elif len(t) >= limit or dur >= max_dur:
            # break at the last clause boundary if there is one, else here
            cut = None
            for i in range(len(cur) - 1, 0, -1):
                if CLAUSE_END.search(cur[i][2].strip()):
                    cut = i + 1
                    break
            if cut and cut < len(cur):
                rest = cur[cut:]
                del cur[cut:]
                flush()
                cur.extend(rest)
            else:
                flush()
    flush()
    return lines


def _pick_device():
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return 'cuda', 'float16'
    except Exception:
        pass
    return 'cpu', 'int8'


_model_cache = {}


def _as_list(frames):
    if frames is None:
        return []
    return frames if isinstance(frames, (list, tuple)) else [frames]


def load_audio_16k(path):
    """Decode any audio/video file to 16 kHz mono float32 (what Whisper needs).

    faster-whisper has its own decoder, but some faster-whisper + PyAV version pairs break
    ("open() got an unexpected keyword argument 'metadata_errors'"), so the app decodes itself.
    Tries PyAV first, then ffmpeg if it is installed. Returns a numpy array, or None to let
    faster-whisper try on its own.
    """
    import numpy as np
    # 1) PyAV (installed together with faster-whisper)
    try:
        import av
        chunks = []
        container = av.open(path, mode='r')
        try:
            if not container.streams.audio:
                raise PipelineError('This file has no sound track.')
            stream = container.streams.audio[0]
            resampler = av.AudioResampler(format='s16', layout='mono', rate=16000)
            try:
                for frame in container.decode(stream):
                    frame.pts = None
                    for f in _as_list(resampler.resample(frame)):
                        chunks.append(f.to_ndarray().reshape(-1))
            except Exception:
                if not chunks:  # damaged data at the very start: give up on PyAV
                    raise
                # damaged data later in the file: keep what was decoded
            for f in _as_list(resampler.resample(None)):
                chunks.append(f.to_ndarray().reshape(-1))
        finally:
            container.close()
        if chunks:
            return np.concatenate(chunks).astype(np.float32) / 32768.0
    except PipelineError:
        raise
    except Exception:
        pass
    # 2) ffmpeg command line, if available
    from shutil import which
    import subprocess
    if which('ffmpeg'):
        try:
            out = subprocess.run(['ffmpeg', '-nostdin', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '16000',
                                  '-loglevel', 'error', '-'], capture_output=True, check=True,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if out.stdout:
                return np.frombuffer(out.stdout, np.int16).astype(np.float32) / 32768.0
        except Exception:
            pass
    return None


def transcribe_local(media, language='auto', model_size='small', progress=None):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise PipelineError('Local AI transcription (faster-whisper) is not installed. Run start.bat again, '
                            'or choose "OpenAI" as the transcription engine in Settings.')
    device, compute = _pick_device()
    key = (model_size, device, compute)
    if key not in _model_cache:
        if progress:
            progress(0.0, 'Loading AI model "%s" (the first time it downloads, this can take a few minutes)' % model_size)
        try:
            _model_cache[key] = WhisperModel(model_size, device=device, compute_type=compute)
        except Exception:
            if device == 'cuda':  # GPU libraries missing: fall back to CPU
                key = (model_size, 'cpu', 'int8')
                _model_cache[key] = WhisperModel(model_size, device='cpu', compute_type='int8')
            else:
                raise
    model = _model_cache[key]
    lang = None if language in ('', 'auto', None) else base_lang(language)
    if progress:
        progress(0.0, 'Reading the sound')
    audio = load_audio_16k(media)
    if audio is not None and len(audio) < 1600:
        raise PipelineError('The sound track is empty or too short to transcribe.')
    segments, info = model.transcribe(audio if audio is not None else media, language=lang, word_timestamps=True, vad_filter=True,
                                      condition_on_previous_text=False)
    total = info.duration or 0
    words = []
    for seg in segments:
        if seg.words:
            for w in seg.words:
                words.append((w.start, w.end, w.word))
        else:
            words.append((seg.start, seg.end, ' ' + seg.text.strip()))
        if progress and total:
            progress(min(0.99, seg.end / total), 'Transcribing with AI')
    return words_to_lines(words), app_lang(info.language)


def transcribe_openai(media, api_key, language='auto', progress=None):
    if not api_key:
        raise PipelineError('Add your OpenAI API key in Settings to use OpenAI transcription.')
    size = os.path.getsize(media)
    if size > 25 * 1024 * 1024:
        raise PipelineError('OpenAI accepts files up to 25 MB; this one is %d MB. Use the local engine instead.'
                            % (size // (1024 * 1024)))
    if progress:
        progress(0.1, 'Sending audio to OpenAI')
    fields = [('model', 'whisper-1'), ('response_format', 'verbose_json'),
              ('timestamp_granularities[]', 'word'), ('timestamp_granularities[]', 'segment')]
    if language not in ('', 'auto', None):
        fields.append(('language', base_lang(language)))
    boundary = '----LL' + uuid.uuid4().hex
    body = bytearray()
    for k, v in fields:
        body += ('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (boundary, k, v)).encode()
    with open(media, 'rb') as f:
        data = f.read()
    body += ('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
             'Content-Type: application/octet-stream\r\n\r\n' % (boundary, os.path.basename(media))).encode()
    body += data + ('\r\n--%s--\r\n' % boundary).encode()
    req = urllib.request.Request('https://api.openai.com/v1/audio/transcriptions', data=bytes(body), method='POST',
                                 headers={'Authorization': 'Bearer ' + api_key,
                                          'Content-Type': 'multipart/form-data; boundary=' + boundary})
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            res = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')
        try:
            detail = json.loads(detail)['error']['message']
        except Exception:
            pass
        raise PipelineError('OpenAI transcription failed: %s' % detail[:300])
    except urllib.error.URLError as e:
        raise PipelineError('Could not reach OpenAI: %s' % e.reason)
    if progress:
        progress(0.95, 'Building lines')
    def _spaced(t):
        t = t.strip()
        # no space before CJK text or punctuation (OpenAI word lists have no spaces)
        return t if (_is_cjk(t) or not t or not (t[0].isalnum() or t[0] in '"\'(¿¡')) else ' ' + t
    words = [(w['start'], w['end'], _spaced(w['word'])) for w in res.get('words') or []]
    if words:
        lines = words_to_lines(words)
    else:
        lines = [{'start': s['start'], 'end': s['end'], 'text': s['text'].strip()}
                 for s in res.get('segments') or [] if s.get('text', '').strip()]
    return lines, app_lang(res.get('language'))


# --------------------------------------------------------------------------
# SRT
# --------------------------------------------------------------------------
def _ts(t):
    t = max(0.0, float(t))
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return '%02d:%02d:%02d,%03d' % (h, m, s, ms)


def write_srt(lines, path):
    with open(path, 'w', encoding='utf-8') as f:
        for i, ln in enumerate(lines, 1):
            f.write('%d\n%s --> %s\n%s\n\n' % (i, _ts(ln['start']), _ts(ln['end']), ln['text']))


# --------------------------------------------------------------------------
# Whole pipeline
# --------------------------------------------------------------------------
def run(job, library_dir, report):
    """job: dict with id, url or upload_path, language, engine, model, openai_key, keep_video, prefer_site_subs.
    report(step, fraction, message) is called with progress. Returns the info dict."""
    folder = os.path.join(library_dir, job['id'])
    os.makedirs(folder, exist_ok=True)
    language = job.get('language') or 'auto'

    # ---- Step 1
    if job.get('url'):
        report(1, 0.0, 'Reading the link')
        got = download(job['url'], folder, language, job.get('keep_video', False),
                       progress=lambda f, m: report(1, f, m))
    else:
        media = job['upload_path']
        got = {'title': job.get('title') or os.path.basename(media), 'source_url': '', 'site': 'Your file',
               'duration': 0, 'media': media, 'site_subtitles': None, 'language': app_lang(language),
               'has_video': bool(re.search(r'\.(mp4|webm|mkv|mov|m4v)$', media, re.I))}
        report(1, 1.0, 'File received')

    # ---- Step 2
    srt_path = os.path.join(folder, 'subs.srt')
    if got['site_subtitles'] and job.get('prefer_site_subs', True):
        report(2, 1.0, "Using the site's own subtitles")
        ext = os.path.splitext(got['site_subtitles'])[1].lower()
        srt_path = os.path.join(folder, 'subs' + ext)
        if os.path.abspath(got['site_subtitles']) != os.path.abspath(srt_path):
            os.replace(got['site_subtitles'], srt_path)
        how = 'site'
        lang = got['language']
    else:
        if job.get('engine') == 'openai':
            lines, lang = transcribe_openai(got['media'], job.get('openai_key'), language,
                                            progress=lambda f, m: report(2, f, m))
            how = 'openai'
        else:
            lines, lang = transcribe_local(got['media'], language, job.get('model') or 'small',
                                           progress=lambda f, m: report(2, f, m))
            how = 'whisper-' + (job.get('model') or 'small')
        if not lines:
            raise PipelineError('No speech was found in this audio.')
        write_srt(lines, srt_path)
        if language not in ('', 'auto', None):
            lang = app_lang(language)

    info = {
        'id': job['id'],
        'title': got['title'],
        'source_url': got['source_url'],
        'site': got['site'],
        'duration': got['duration'],
        'media_file': os.path.basename(got['media']),
        'subtitle_file': os.path.basename(srt_path),
        'subtitle_source': how,
        'language': lang or got['language'] or '',
        'has_video': got['has_video'],
        'created': time.strftime('%Y-%m-%d %H:%M'),
    }
    with open(os.path.join(folder, 'info.json'), 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
    report(3, 1.0, 'Ready')
    return info
