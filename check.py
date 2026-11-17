"""ListeningLearner system check.

  python check.py            quick check: Python version and installed parts
  python check.py --full     also loads the AI model and transcribes a short test sound
"""
import os
import sys
import time

APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)

OK, WARN, FAIL = '[ OK ]', '[WARN]', '[FAIL]'


def line(tag, label, detail=''):
    print('  %s %-30s %s' % (tag, label, detail))


def main():
    full = '--full' in sys.argv
    print()
    print('  ListeningLearner system check')
    print('  ' + '-' * 60)

    if sys.version_info[:2] < (3, 9):
        line(FAIL, 'Python version', '%s (3.9 or newer needed)' % sys.version.split()[0])
        return 1

    import pipeline
    t = pipeline.check_tools()
    failures = 0

    line(OK if t['python_ok'] else FAIL, 'Python version', t['python'])
    line(OK, 'Python location', t['python_path'])

    if t['ytdlp']:
        line(OK, 'Downloader (yt-dlp)', t['ytdlp_version'])
    else:
        line(FAIL, 'Downloader (yt-dlp)', 'not installed - run start.bat'); failures += 1

    if t['whisper']:
        line(OK, 'AI speech-to-text', 'faster-whisper ' + t['whisper_version'])
        line(OK if t['gpu'] else WARN, 'NVIDIA graphics card (GPU)',
             'found - transcription will be fast' if t['gpu'] else 'not found - uses the processor (slower, still works)')
    else:
        line(FAIL, 'AI speech-to-text', 'faster-whisper not installed - run start.bat'); failures += 1

    line(OK if t['ffmpeg'] else WARN, 'ffmpeg (optional)',
         'found' if t['ffmpeg'] else 'not found - not required')

    if full and t['whisper']:
        print()
        print('  Full test: loading the "base" AI model and transcribing a test sound...')
        print('  (the first time, this downloads about 75 MB)')
        try:
            test_transcription()
            line(OK, 'AI transcription test', 'model loaded and ran')
        except Exception as e:
            line(FAIL, 'AI transcription test', str(e)[:200]); failures += 1

    print('  ' + '-' * 60)
    if failures:
        print('  %d problem(s) found. Run start.bat to install the missing parts,' % failures)
        print('  or update.bat if they are installed but broken.')
    else:
        print('  Everything needed for "Download & transcribe" is ready.')
    if not full:
        print('  Tip: check.bat full  also tests the AI model.')
    print()
    return 1 if failures else 0


def test_transcription():
    """Write 2 s of a tone to a WAV file and run it through Whisper (it should finish without errors)."""
    import math
    import struct
    import tempfile
    import wave
    from faster_whisper import WhisperModel

    path = os.path.join(tempfile.gettempdir(), 'll_check_tone.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * 440 * i / 16000)))
                               for i in range(32000)))
    start = time.time()
    model = WhisperModel('base', device='cpu', compute_type='int8')
    segments, info = model.transcribe(path)
    list(segments)
    os.remove(path)
    print('       finished in %.1f s' % (time.time() - start))


if __name__ == '__main__':
    sys.exit(main())
