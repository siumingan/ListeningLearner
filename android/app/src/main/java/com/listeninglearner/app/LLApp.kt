package com.listeninglearner.app

import android.app.Application
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** Starts the bundled yt-dlp (Python) once, in the background, when the app opens. */
class LLApp : Application() {

    companion object {
        /** All yt-dlp work runs on this one thread: one job at a time, after start-up. */
        val worker: ExecutorService = Executors.newSingleThreadExecutor()

        @Volatile var ready = false
        @Volatile var initError: String? = null
    }

    override fun onCreate() {
        super.onCreate()
        worker.execute {
            try {
                // the first start unpacks Python and yt-dlp; this can take several seconds
                YoutubeDL.getInstance().init(this)
                FFmpeg.getInstance().init(this)
                ready = true
            } catch (e: Exception) {
                initError = e.message ?: e.toString()
                Log.e("ListeningLearner", "yt-dlp start-up failed", e)
            }
        }
    }
}
