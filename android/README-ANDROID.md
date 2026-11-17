# ListeningLearner for Android

A native Android app (APK) containing the whole ListeningLearner web app, plus three things only a native app can do:

- **Download from links on the phone.** yt-dlp is built into the app (youtubedl-android), so YouTube, Vimeo, Bilibili, TikTok, news and podcast pages work without a PC. When a site has its own subtitles, they're used directly.
- **Clear voice** with Android's text-to-speech engine.
- **Share to the app.** Share a link, or an audio or video file, from any app to *ListeningLearner*.

When a site has no subtitles, the transcript is made with **OpenAI** (API key in ⚙ Settings). Transcripts are saved with the download in the app's library.

> This app can't be published on Google Play: apps that download from YouTube break Google's rules. Install it directly from the APK file ("sideloading"), like Seal or YTDLnis.

---

## Option A: Build and run in Android Studio (with the emulator)

**Your PC needs:** 64-bit Windows 10/11, 16 GB RAM (8 GB without the emulator), virtualization (Intel VT-x / AMD-V) turned on in the BIOS, and about 20 GB of free disk space.

1. Install **Android Studio** from https://developer.android.com/studio and keep the default options.
2. **File → Open** → choose the folder `ListeningLearner\android` (not the main folder).
3. Wait for "Gradle sync" to finish (bottom status bar). The first time downloads several GB. If Studio offers to upgrade the "Android Gradle Plugin", you can accept.
4. **Create a virtual phone:** *Tools → Device Manager → + → Create Virtual Device* → **Pixel 8** → choose a system image whose ABI is **x86_64** (for example "API 34, x86_64, Google APIs") → Finish.
5. Pick that device at the top and press the green **▶ Run**. The emulator starts and the app opens.

**Real phone instead:** on the phone, *Settings → About phone →* tap *Build number* 7 times; then *Developer options →* **USB debugging** on. Connect it by USB, choose it at the top of Android Studio, and press ▶.

**Make the APK file:** *Build → Build App Bundle(s) / APK(s) → Build APK(s)*. The files appear in `android\app\build\outputs\apk\`.

Debugging the web part: while the app runs, open `chrome://inspect` in Chrome on the PC and click *inspect* under the app's WebView.

## Option B: Let GitHub build it (no installs)

1. Create a free account at https://github.com, then click **New repository** (it can be private).
2. Upload the **whole `ListeningLearner` folder**. The GitHub Desktop app makes this easy.
3. Add the build recipe: in the repository, open **Actions** → **set up a workflow yourself**. Name the file `android.yml`, replace the editor content with everything in `android/github-build-workflow.yml`, and click **Commit changes**. (It has to live in the `.github/workflows` folder, which GitHub creates for you this way.)
4. Open **Actions** → **Build Android app** → **Run workflow**.
5. After about 5–10 minutes, open the finished run and download **ListeningLearner-android-apk** under *Artifacts*.

## Installing the APK on a phone

There are several APK files. Pick one:

| File | For |
|---|---|
| `app-arm64-v8a-release.apk` | most phones from the last 7 or so years (**try this first**) |
| `app-armeabi-v7a-release.apk` | older or low-cost phones |
| `app-x86_64-release.apk` | the PC emulator, Chromebooks |
| `app-universal-release.apk` | any device (largest file) |

Copy it to the phone and open it. Android asks to allow installing from this source; allow it once.

The APK is signed with a "debug" key. To update the app, install a new build over the old one. If Android refuses, uninstall the old one first; builds made on different computers (or by GitHub) have different keys. For long-term distribution, create your own signing key (*Build → Generate Signed App Bundle / APK*).

## First start

- The first launch unpacks Python and yt-dlp (about 10 seconds) in the background.
- Add your **OpenAI API key** in ⚙ Settings to get transcripts for sites without subtitles.
- If downloads from a site stop working, tap **Update downloader** on the *Any site + AI* tab.

## How it's built

```
android/
  app/build.gradle.kts            build settings and libraries (youtubedl-android 0.17.4, androidx.webkit)
  app/src/main/AndroidManifest.xml    permissions, share menu entries
  app/src/main/java/com/listeninglearner/app/
    LLApp.kt          starts yt-dlp when the app opens
    MainActivity.kt   full-screen WebView, file picker, share handling, full-screen video
    NativeBridge.kt   window.LLNative for JavaScript: downloads, library, text-to-speech
```
The web app (`index.html`, `css`, `js`, `icons`) is **copied from the main folder at build time**, so the PC, website and Android versions share one copy of the code.

## If the build fails

The project was written without access to an Android build machine, so its first build is its first real test. The most likely spots needing a small fix, depending on the library version:

- `NativeBridge.kt`: `ydl.execute(request = …, processId = …, callback = …)`. If the parameter names differ, use the order from the library's README.
- `NativeBridge.kt`: `YoutubeDL.UpdateChannel.STABLE`. In some versions it's `YoutubeDL.UpdateChannel._STABLE`.

Copy the red error text from Android Studio's *Build* window (or the failed GitHub run) and send it to Claude.
