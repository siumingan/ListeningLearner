package com.listeninglearner.app

import android.app.Activity
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Things the web app can't do inside a WebView, offered to JavaScript as `window.LLNative`:
 *   - download the sound from a link with yt-dlp (plus the site's own subtitles, if any)
 *   - a small library of downloads and their transcripts
 *   - text-to-speech (Android WebView has no speechSynthesis)
 *
 * Results go back to JavaScript as events: window.LLNativeEvent(jsonString)
 */
class NativeBridge(
    private val activity: Activity,
    private val web: WebView,
    private val root: File
) : TextToSpeech.OnInitListener {

    private val downloads = File(root, "dl").apply { mkdirs() }
    private val idPattern = Regex("^[A-Za-z0-9_-]{1,64}$")
    private var tts: TextToSpeech? = TextToSpeech(activity.applicationContext, this)
    @Volatile private var ttsReady = false

    private class UserError(message: String) : Exception(message)

    // ------------------------------------------------------------------ status
    @JavascriptInterface
    fun status(): String = JSONObject()
        .put("ready", LLApp.ready)
        .put("error", LLApp.initError ?: "")
        .put("tts", ttsReady)
        .put("version", "1.0")
        .toString()

    // ------------------------------------------------------------------ downloads
    /** Starts a download. Progress and the result arrive as "job" events. */
    @JavascriptInterface
    fun download(jobId: String, url: String, optionsJson: String) {
        if (!idPattern.matches(jobId)) return
        val opts = try { JSONObject(optionsJson) } catch (_: Exception) { JSONObject() }
        job(jobId, "queued", 1, 0.0, "Waiting to start")
        LLApp.worker.execute { runDownload(jobId, url.trim(), opts) }
    }

    @JavascriptInterface
    fun cancel(jobId: String) {
        try { YoutubeDL.getInstance().destroyProcessById(jobId) } catch (_: Exception) { }
    }

    private fun runDownload(jobId: String, url: String, opts: JSONObject) {
        val dir = File(downloads, jobId)
        try {
            if (!LLApp.ready) {
                throw UserError("The downloader could not start on this phone: " + (LLApp.initError ?: "unknown error"))
            }
            if (!url.startsWith("http://") && !url.startsWith("https://")) throw UserError("Paste a full link starting with https://")
            dir.mkdirs()
            val ydl = YoutubeDL.getInstance()
            val language = opts.optString("language", "auto")
            val keepVideo = opts.optBoolean("keepVideo", false)
            val template = File(dir, "media.%(ext)s").absolutePath

            // 1) read the video's details only (title, language, which subtitles exist)
            job(jobId, "running", 1, 0.0, "Reading the link")
            val infoRequest = YoutubeDLRequest(url).apply {
                addOption("--skip-download")
                addOption("--no-playlist")
                addOption("--write-info-json")
                addOption("-o", template)
            }
            ydl.execute(request = infoRequest, processId = "$jobId-info", callback = { _, _, _ -> })
            val infoFile = File(dir, "media.info.json")
            val meta = if (infoFile.exists()) JSONObject(infoFile.readText()) else JSONObject()
            infoFile.delete()
            if (meta.optString("_type") == "playlist") {
                throw UserError("This is a playlist or channel. Share the link of a single video.")
            }
            val siteLang = meta.optString("language", "").takeIf { it != "null" } ?: ""
            val wanted = if (language.isBlank() || language == "auto") siteLang else language
            val subKey = pickSubtitleLanguage(meta.optJSONObject("subtitles"), wanted)

            // 2) download the sound (single-file formats: no conversion needed)
            val format = if (keepVideo)
                "best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]/best"
            else
                "bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio[ext=webm]/bestaudio/best[acodec!=none]"
            val request = YoutubeDLRequest(url).apply {
                addOption("--no-playlist")
                addOption("-f", format)
                addOption("-o", template)
                if (subKey != null) {
                    addOption("--write-subs")
                    addOption("--sub-langs", subKey)
                    addOption("--sub-format", "vtt/srt/best")
                }
            }
            ydl.execute(request = request, processId = jobId, callback = { progress, _, _ ->
                job(jobId, "running", 1, (progress / 100.0).coerceIn(0.0, 0.99), "Downloading")
            })

            val files = dir.listFiles()?.toList() ?: emptyList()
            val media = files.firstOrNull { f ->
                f.name.startsWith("media.") && !f.name.endsWith(".part") && !f.name.endsWith(".ytdl") &&
                    !f.name.endsWith(".json") && !f.name.endsWith(".vtt") && !f.name.endsWith(".srt")
            } ?: throw UserError("The download finished but no sound file was found.")
            val subs = files.firstOrNull { it.name.startsWith("media.") && (it.name.endsWith(".vtt") || it.name.endsWith(".srt")) }

            val itemLang = normaliseLang(subKey ?: siteLang.ifBlank { if (language == "auto") "" else language })
            val item = JSONObject()
                .put("id", jobId)
                .put("title", meta.optString("title", "Untitled"))
                .put("site", meta.optString("extractor_key", ""))
                .put("source_url", meta.optString("webpage_url", url))
                .put("duration", meta.optDouble("duration", 0.0).let { if (it.isNaN() || it.isInfinite()) 0.0 else it })
                .put("language", itemLang)
                .put("media", "/files/dl/$jobId/${media.name}")
                .put("subs", if (subs != null) "/files/dl/$jobId/${subs.name}" else JSONObject.NULL)
                .put("subtitle_source", if (subs != null) "site" else JSONObject.NULL)
                .put("has_video", keepVideo)
                .put("created", SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date()))
            File(dir, "item.json").writeText(item.toString())
            emit(JSONObject().put("type", "job").put("jobId", jobId).put("status", "done")
                .put("step", 2).put("progress", 1.0).put("message", "Downloaded").put("item", item))
        } catch (e: Exception) {
            dir.deleteRecursively()
            emit(JSONObject().put("type", "job").put("jobId", jobId).put("status", "error")
                .put("error", friendlyError(e)))
        }
    }

    private fun pickSubtitleLanguage(subs: JSONObject?, wanted: String): String? {
        if (subs == null || wanted.isBlank()) return null
        val keys = subs.keys().asSequence().filter { it != "live_chat" }.toList()
        val w = wanted.lowercase()
        val base = w.substringBefore('-')
        return keys.firstOrNull { it.lowercase() == w } ?: keys.firstOrNull { it.lowercase().substringBefore('-') == base }
    }

    private fun normaliseLang(code: String): String {
        val c = code.trim()
        if (c.isEmpty()) return ""
        val base = c.substringBefore('-').lowercase()
        if (base == "zh") return if (Regex("tw|hant|hk", RegexOption.IGNORE_CASE).containsMatchIn(c)) "zh-TW" else "zh-CN"
        return base
    }

    private fun friendlyError(e: Exception): String {
        if (e is UserError) return e.message ?: "Download failed."
        val msg = (e.message ?: e.toString()).replace(Regex("\u001B\\[[0-9;]*m"), "").replace("ERROR: ", "").trim()
        val low = msg.lowercase()
        return when {
            "canceled" in low || "cancelled" in low -> "Download cancelled."
            "drm" in low -> "This video is DRM-protected, so it cannot be downloaded."
            "unsupported url" in low -> "This website is not supported by the downloader."
            "private" in low || "sign in" in low || "login" in low -> "This video needs a login or is private."
            "unavailable" in low || "not available" in low || "404" in low -> "The video is not available (removed, private or blocked in your region)."
            "unable to download" in low || "timed out" in low || "network" in low -> "Could not reach the website. Check the internet connection."
            else -> "Download failed: " + msg.take(300)
        }
    }

    /** Updates yt-dlp inside the app (websites change often). Result arrives as an "update" event. */
    @JavascriptInterface
    fun updateDownloader() {
        LLApp.worker.execute {
            val result = try {
                val status = YoutubeDL.getInstance().updateYoutubeDL(activity.applicationContext, YoutubeDL.UpdateChannel.STABLE)
                JSONObject().put("ok", true).put("message", status?.toString() ?: "DONE")
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("message", e.message ?: e.toString())
            }
            emit(result.put("type", "update"))
        }
    }

    // ------------------------------------------------------------------ library
    @JavascriptInterface
    fun listItems(): String {
        val items = JSONArray()
        downloads.listFiles()?.sortedByDescending { it.name }?.forEach { d ->
            val f = File(d, "item.json")
            if (f.isFile) try { items.put(JSONObject(f.readText())) } catch (_: Exception) { }
        }
        return items.toString()
    }

    @JavascriptInterface
    fun deleteItem(id: String): Boolean {
        if (!idPattern.matches(id)) return false
        return File(downloads, id).deleteRecursively()
    }

    /** Saves a transcript made by the web app (e.g. with OpenAI) next to the download. */
    @JavascriptInterface
    fun saveTranscript(id: String, srt: String, language: String): String {
        if (!idPattern.matches(id)) return ""
        val dir = File(downloads, id)
        val itemFile = File(dir, "item.json")
        if (!itemFile.isFile) return ""
        return try {
            File(dir, "subs.srt").writeText(srt)
            val item = JSONObject(itemFile.readText())
                .put("subs", "/files/dl/$id/subs.srt")
                .put("subtitle_source", "openai")
            if (language.isNotBlank()) item.put("language", language)
            itemFile.writeText(item.toString())
            item.toString()
        } catch (_: Exception) {
            ""
        }
    }

    // ------------------------------------------------------------------ text-to-speech
    override fun onInit(status: Int) {
        ttsReady = status == TextToSpeech.SUCCESS
        if (!ttsReady) return
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = ttsEvent(utteranceId, "start")
            override fun onDone(utteranceId: String?) = ttsEvent(utteranceId, "end")
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = ttsEvent(utteranceId, "error")
            override fun onError(utteranceId: String?, errorCode: Int) = ttsEvent(utteranceId, "error")
            override fun onStop(utteranceId: String?, interrupted: Boolean) = ttsEvent(utteranceId, "end")
            override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                emit(JSONObject().put("type", "tts").put("id", utteranceId ?: "").put("event", "boundary")
                    .put("start", start).put("end", end))
            }
        })
    }

    private fun ttsEvent(id: String?, event: String) {
        emit(JSONObject().put("type", "tts").put("id", id ?: "").put("event", event))
    }

    @JavascriptInterface
    fun ttsAvailable(): Boolean = ttsReady

    @JavascriptInterface
    fun hasVoice(lang: String): Boolean {
        val t = tts ?: return false
        if (!ttsReady) return false
        return t.isLanguageAvailable(Locale.forLanguageTag(lang)) >= TextToSpeech.LANG_AVAILABLE
    }

    @JavascriptInterface
    fun speak(id: String, text: String, lang: String, rate: Float) {
        val t = tts
        if (t == null || !ttsReady) { ttsEvent(id, "error"); return }
        if (lang.isNotBlank()) t.language = Locale.forLanguageTag(lang)
        t.setSpeechRate(if (rate > 0f) rate else 1f)
        t.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), id)
    }

    @JavascriptInterface
    fun stopSpeaking() {
        tts?.stop()
    }

    // ------------------------------------------------------------------ plumbing
    private fun job(jobId: String, status: String, step: Int, progress: Double, message: String) {
        emit(JSONObject().put("type", "job").put("jobId", jobId).put("status", status)
            .put("step", step).put("progress", progress).put("message", message))
    }

    private fun emit(event: JSONObject) {
        val js = "window.LLNativeEvent && window.LLNativeEvent(" + JSONObject.quote(event.toString()) + ")"
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed) {
                web.evaluateJavascript(js, null)
            }
        }
    }

    fun shutdown() {
        tts?.shutdown()
        tts = null
    }
}
