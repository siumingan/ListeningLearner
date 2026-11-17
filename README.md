# ListeningLearner

Listening practice with real video: the clip pauses after every line of dialogue, shows the translation in your language, and can read the line aloud in a clear voice.

## Start the app (Windows)

1. Install **Python 3.9 or newer** once, from [python.org](https://www.python.org/downloads/). Tick **"Add python.exe to PATH"** during setup. You can also run `winget install Python.Python.3.12`.
2. Double-click **`start.bat`**. The first start installs the downloader and the AI transcription engine, which takes a few minutes.
3. Your browser opens the app at `http://localhost:8765/`. Keep the black window open while you use it, and close it to stop.

Without Python, `start.bat` starts in **basic mode**: video files and YouTube work, but "Any site: download & transcribe" is off.

**Test the setup:** double-click **`check.bat`** to see the Python version and whether the downloader and AI engine are installed. Run `check.bat full` from a command prompt to also load the AI model and run a short test transcription. The same check is available in the app under ⚙ Settings → **Run system check**.

Use Chrome or Edge for the best text-to-speech voices. If downloads from a site start failing, run **`update.bat`**: websites change often, and the downloader gets fixes every few weeks.

## Any site: download & transcribe

This tab runs the full pipeline:

1. **Download the sound** from a link on almost any site (YouTube, Vimeo, Bilibili, TikTok, X, news and podcast pages: 1000+ sites via yt-dlp), or pick an audio or video file on this computer.
2. **Speech → text.** If the site has human-made subtitles in the spoken language, the app uses them, because they're exact. Otherwise AI turns the speech into timed lines:
   - **AI on this computer (free):** faster-whisper. Choose *Fast*, *Balanced*, *Accurate* or *Best*. The first use of each level downloads the AI model (about 75 MB for Fast, 0.5 GB for Balanced, 1.5 GB for Accurate, 3 GB for Best). Expect it to take about as long as the clip itself on a typical laptop with *Balanced*, and much faster with an NVIDIA graphics card.
   - **OpenAI (fast):** sends the audio to OpenAI's transcription service. Needs an API key in ⚙ Settings, costs a small amount per minute, and accepts files up to 25 MB.
3. **Ready to study:** the item opens in the player with pause-per-line, translation and **Hear it clearly** (text-to-speech).

Everything you process stays in **Your library**, where you can study it again, download the transcript (.srt) or delete it. Files are stored in `%LOCALAPPDATA%\ListeningLearner\library`, outside OneDrive, so large media files don't fill your cloud storage.

DRM-protected services (Netflix, Disney+, Prime Video…) can't be downloaded. Some sites need a login or block downloads; the app shows the reason. Only download and study content you're allowed to use.

> Don't double-click `index.html`: local files work that way, but YouTube refuses to play on a page without a web address.

## Phone app

ListeningLearner works on phones as an installable app (a PWA): it gets its own icon, opens full screen, and has a phone layout with big buttons pinned to the bottom of the screen. You can use it in two ways.

### A) Through your PC, at home (all features)

1. On the PC, double-click **`start-phone.bat`** instead of `start.bat`. If Windows asks about the firewall, allow **private networks** only.
2. In the app on the PC, click **📱 Use on phone** and scan the QR code with the phone's camera. You can also type the address shown in the black window.
3. Add it to the home screen: **Android Chrome** ⋮ → *Add to Home screen*; **iPhone Safari** ⬆ Share → *Add to Home Screen*.

Everything works on the phone: downloading from any site, AI transcription on the PC, your library, translation and the clear voice. The PC must be on with the app window open, and the phone on the same Wi-Fi.

The address contains an **access key** (`?t=…`). Phones without it can't use your PC. The key stays the same after restarts; to change it, delete `%LOCALAPPDATA%\ListeningLearner\phone-access-key.txt`.

### B) Anywhere, without the PC

Put the `ListeningLearner` folder on any free HTTPS web host, for example:
- **Netlify Drop**: open https://app.netlify.com/drop and drag the folder onto the page.
- **GitHub Pages**: upload the folder to a repository and turn on Pages.

Open the site on the phone and tap **📲 Install app** (Android) or Share → *Add to Home Screen* (iPhone). It also opens without internet after the first visit, though translation and YouTube still need a connection.

In this mode you can use: video and audio files on the phone with subtitle files, YouTube links, translation, the clear voice, and **AI transcription of files on the phone with OpenAI** (API key in ⚙ Settings, files up to 25 MB). Downloading from links isn't available, because that needs the PC.

On Android, the installed app also appears in the **Share** menu: share a video link from YouTube or the browser to *Listening* to open it straight in the app.

### C) Android app (downloads on the phone, no PC needed)

The `android` folder contains a native Android app with the downloader built in. It downloads from links on the phone itself, uses Android's voices, and appears in the phone's Share menu. See **android/README-ANDROID.md** for how to build it in Android Studio (with the emulator) or have GitHub build it for you.

## Study a video file

1. **Video file on this computer** → *Choose video* (MP4/WebM play everywhere; MKV works in Chrome/Edge for most files).
2. *Choose subtitles* → an `.srt` or `.vtt` file in the language spoken in the clip.
3. Set **I'm learning** (the clip's language) and **Translate into** (your language) at the top.
4. Press **▶ Continue**. The video pauses at the end of each line.

| Key | Action |
|---|---|
| Space | Continue / pause |
| R | Replay the line |
| ← / → | Previous / next line |
| S | Hear the line in a clear voice |
| T | Translate the line |

Other controls:
- **Hide text until I reveal it** turns each line into a listening test. The transcript is blurred too, and you can hover to peek.
- **Subtitle timing −0.1 / +0.1** fixes subtitles that are slightly early or late.
- **Video speed** and **Clear voice speed** are separate settings.

## Check a link

**Paste a link** → **Check link**. The app sorts every link into one of three categories:

| Result | Meaning |
|---|---|
| **Line-by-line ready** | Plays here, and the app has the subtitle text, so every feature works |
| **Watch only** | Plays here with YouTube's own subtitles and auto-translate (in the player's CC ⚙ menu), but the app can't read the text |
| **Not supported** | Can't play here: DRM sites (Netflix, Disney+…), embedding turned off, private, region-blocked or age-restricted |

It also lists the details it found: spoken language, which subtitle languages exist on YouTube, and whether each is human-made or automatic (raw speech recognition).

YouTube only lets a video's owner download its subtitle text. So a YouTube video becomes **Line-by-line ready** when you add your own `.srt`/`.vtt` file for it with *Add your own subtitles*.

For the full check, add a free **YouTube Data API key** in ⚙ Settings. Without one, the app still recognises links and confirms playback when the player loads.

To get a key: open [Google Cloud Console](https://console.cloud.google.com/) → create a project → *APIs & Services* → enable **YouTube Data API v3** → *Credentials* → *Create credentials* → *API key*. Restrict the key to the YouTube Data API and to the website `http://localhost:8765/*`.

## Translation

Choose the service in ⚙ Settings:
- **MyMemory**: free with no key, but the daily limit is small. Adding your email raises it. Good for trying the app.
- **Google Cloud Translation**: paste an API key (enable "Cloud Translation API" in the same Google Cloud project).
- **LibreTranslate**: open source. Use your own server or a hosted one.

Translations are cached while the app is open, and the next few lines are translated in advance.

## Clear voice (text-to-speech)

The app uses the voices built into Windows and the browser, so it's free and works offline with Windows voices. Edge has very natural "Online (Natural)" voices for many languages.

If a language has no voice, add one in Windows: **Settings → Time & language → Speech → Add voices**, then restart the browser. ⚙ Settings shows which voice will be used.

## Files

```
index.html        app page
css/styles.css    look and layout
js/app.js         main logic (pause per line, translation, voice, transcript)
js/subtitles.js   .srt / .vtt reader
js/linkcheck.js   link checker
js/players.js     video file player + official YouTube player
js/translate.js   translation services
js/tts.js         text-to-speech
js/languages.js   language list
js/pipeline-ui.js "Any site" screen and library
server.py         local server: app pages, pipeline jobs, library
pipeline.py       download (yt-dlp) -> site subtitles or AI speech-to-text -> .srt
requirements.txt  Python packages
server.ps1        basic-mode server (no Python needed)
start.bat         sets up Python packages on first run, starts the app
start-phone.bat   same, and lets your phone use the app over Wi-Fi
manifest.webmanifest, sw.js, icons/   phone app (PWA) files
js/server.js      connection to the PC (with the phone access key)
js/lines.js       builds subtitle lines from AI word timings (phone mode)
js/mobile.js      install button, share menu, "Use on phone"
update.bat        updates the downloader and AI engine
```

Settings and keys are stored only in this browser (localStorage).

## Notes and limits

- Subtitles inside MKV/MP4 files aren't read yet. Extract them to `.srt` first, for example with MKVToolNix or Subtitle Edit.
- For a video file without subtitles, use **Any site → Transcribe a file from this computer** to make them with AI.
- AI transcription is very good but not perfect. Music, noise and overlapping voices cause mistakes, and the clear voice will read those mistakes. Human-made subtitles are always preferred when a site has them.
- Only use videos and subtitles you have the right to use.
