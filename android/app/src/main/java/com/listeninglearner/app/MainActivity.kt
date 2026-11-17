package com.listeninglearner.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * Shows the ListeningLearner web app (bundled in the APK) in a full-screen WebView.
 *
 * Pages are served from https://appassets.androidplatform.net so they behave like a real
 * website (YouTube's player, translation and OpenAI work as on the web):
 *   /assets/www/...  the web app
 *   /files/...       downloads and transcripts saved by the app (NativeBridge)
 */
class MainActivity : Activity() {

    companion object {
        private const val HOST = "https://appassets.androidplatform.net"
        private const val START = "$HOST/assets/www/index.html"
        private const val PICK_FILE = 1001
    }

    private lateinit var web: WebView
    private lateinit var bridge: NativeBridge
    private lateinit var dataRoot: File
    private var fileCallback: ValueCallback<Array<Uri>?>? = null
    private lateinit var chrome: WebChromeClient
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        dataRoot = File(filesDir, "ll").apply { mkdirs() }

        val root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        // Chrome on the PC can inspect the app while it runs in a debug build (chrome://inspect)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
        }

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/files/", WebViewAssetLoader.InternalStoragePathHandler(this, dataRoot))
            .build()

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                if (!request.isForMainFrame) return false
                // other websites (links in the app) open in the phone's browser
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (_: ActivityNotFoundException) { }
                return true
            }
        }

        chrome = object : WebChromeClient() {
            // <input type="file">: open the phone's file picker
            override fun onShowFileChooser(
                webView: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                @Suppress("UNCHECKED_CAST")
                fileCallback = callback as ValueCallback<Array<Uri>?>
                return try {
                    startActivityForResult(params.createIntent(), PICK_FILE)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }

            // full-screen video (YouTube's full-screen button)
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (fullscreenView != null) { callback.onCustomViewHidden(); return }
                fullscreenView = view
                fullscreenCallback = callback
                (window.decorView as FrameLayout).addView(view, FrameLayout.LayoutParams(-1, -1))
                web.visibility = View.GONE
            }

            override fun onHideCustomView() {
                (window.decorView as FrameLayout).removeView(fullscreenView)
                fullscreenView = null
                web.visibility = View.VISIBLE
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
            }
        }

        web.webChromeClient = chrome

        bridge = NativeBridge(this, web, dataRoot)
        web.addJavascriptInterface(bridge, "LLNative")

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(startUrlFor(intent))
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Intent.ACTION_SEND) web.loadUrl(startUrlFor(intent))
    }

    /** Builds the start address, adding a shared link or file from another app. */
    private fun startUrlFor(intent: Intent?): String {
        if (intent?.action != Intent.ACTION_SEND) return START
        val type = intent.type ?: ""
        if (type.startsWith("text/")) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return START
            return "$START?share_text=" + Uri.encode(text)
        }
        @Suppress("DEPRECATION")
        val stream: Uri? = if (Build.VERSION.SDK_INT >= 33)
            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else intent.getParcelableExtra(Intent.EXTRA_STREAM)
        if (stream != null) {
            val saved = copySharedFile(stream) ?: return START
            return "$START?share_file=" + Uri.encode("/files/shared/" + saved.name) + "&share_name=" + Uri.encode(saved.name)
        }
        return START
    }

    /** Copies a shared audio/video file into the app so the web page can open it. */
    private fun copySharedFile(uri: Uri): File? {
        return try {
            var name = "shared-file"
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) name = c.getString(0) ?: name
            }
            name = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80)
            val dir = File(dataRoot, "shared").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }   // keep only the latest shared file
            val out = File(dir, name)
            contentResolver.openInputStream(uri)?.use { input -> out.outputStream().use { input.copyTo(it) } }
            out
        } catch (_: Exception) {
            null
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PICK_FILE) {
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Back handling kept simple on purpose")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        when {
            fullscreenView != null -> chrome.onHideCustomView()
            web.canGoBack() -> web.goBack()
            else -> super.onBackPressed()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onDestroy() {
        bridge.shutdown()
        web.destroy()
        super.onDestroy()
    }
}
