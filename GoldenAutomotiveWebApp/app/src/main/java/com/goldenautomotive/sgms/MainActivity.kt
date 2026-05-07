package com.goldenautomotive.sgms

import android.Manifest
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebChromeClient.FileChooserParams
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.goldenautomotive.sgms.databinding.ActivityMainBinding
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    companion object {
        private const val JS_BRIDGE_NAME = "AndroidDownloadBridge"
    }

    private lateinit var binding: ActivityMainBinding

    private val appBaseUrl: String by lazy { BuildConfig.APP_BASE_URL.trimEnd('/') }
    private val appHost: String by lazy {
        Uri.parse(appBaseUrl).host?.lowercase().orEmpty()
    }

    private val allowedHosts: Set<String> by lazy {
        if (appHost.isBlank()) {
            emptySet()
        } else {
            val canonicalHost = appHost.removePrefix("www.")
            setOf(appHost, canonicalHost, "www.$canonicalHost")
        }
    }

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private var pendingBlobDownload: PendingBlobDownload? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback ?: return@registerForActivityResult

            val uris = when {
                result.resultCode != RESULT_OK -> null
                result.data?.clipData != null -> {
                    val clipData = result.data?.clipData ?: return@registerForActivityResult
                    Array(clipData.itemCount) { index -> clipData.getItemAt(index).uri }
                }
                result.data?.data != null -> arrayOf(result.data!!.data!!)
                pendingCameraUri != null -> arrayOf(pendingCameraUri!!)
                else -> null
            }

            callback.onReceiveValue(uris)
            fileChooserCallback = null
            pendingCameraUri = null
        }

    private val webPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
            val request = pendingWebPermissionRequest
            pendingWebPermissionRequest = null

            if (request == null) return@registerForActivityResult

            val grantedResources = mutableListOf<String>()

            if (
                request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) &&
                results[Manifest.permission.CAMERA] == true
            ) {
                grantedResources += PermissionRequest.RESOURCE_VIDEO_CAPTURE
            }

            if (
                request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) &&
                results[Manifest.permission.RECORD_AUDIO] == true
            ) {
                grantedResources += PermissionRequest.RESOURCE_AUDIO_CAPTURE
            }

            if (grantedResources.isEmpty()) {
                request.deny()
                toast("Camera or microphone permission denied.")
            } else {
                request.grant(grantedResources.toTypedArray())
            }
        }

    private val storagePermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val pending = pendingBlobDownload
            pendingBlobDownload = null

            if (!granted) {
                toast("Storage permission denied.")
                return@registerForActivityResult
            }

            if (pending != null) {
                saveBase64Download(
                    base64 = pending.base64,
                    mimeType = pending.mimeType,
                    rawFileName = pending.fileName
                )
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        configureWebView()

        onBackPressedDispatcher.addCallback(this) {
            if (binding.webView.canGoBack()) {
                binding.webView.goBack()
            } else {
                finish()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent, initialLoad = false)
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onPause() {
        binding.webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        pendingWebPermissionRequest?.deny()
        binding.webView.apply {
            removeJavascriptInterface(JS_BRIDGE_NAME)
            stopLoading()
            webChromeClient = null
            destroy()
        }
        super.onDestroy()
    }

    private fun configureWebView() {
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(binding.webView, true)

        binding.webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowContentAccess = true
            allowFileAccess = false
            setSupportMultipleWindows(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            userAgentString = "${userAgentString} GoldenAutomotiveAndroidWebView/1.0"
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(
                binding.webView.settings,
                WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP
            )
        }

        binding.webView.addJavascriptInterface(DownloadBridge(), JS_BRIDGE_NAME)
        binding.webView.webChromeClient = AppChromeClient()
        binding.webView.webViewClient = AppWebViewClient()
        binding.webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            enqueueDownload(url, userAgent, contentDisposition, mimeType)
        }

        binding.swipeRefresh.setOnRefreshListener {
            binding.webView.reload()
        }
        binding.swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            binding.webView.scrollY > 0
        }

        handleIncomingIntent(intent, initialLoad = true)
    }

    private fun handleIncomingIntent(intent: Intent?, initialLoad: Boolean) {
        val deepLink = intent?.data?.toString()?.takeIf(::isAllowedInternalUrl)
        val targetUrl = deepLink ?: appBaseUrl

        if (initialLoad || binding.webView.url.isNullOrBlank()) {
            binding.webView.loadUrl(targetUrl)
            return
        }

        if (!deepLink.isNullOrBlank() && deepLink != binding.webView.url) {
            binding.webView.loadUrl(deepLink)
        }
    }

    private fun isAllowedInternalUrl(url: String): Boolean {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) && isInternalHost(uri.host)
    }

    private fun isInternalHost(host: String?): Boolean {
        return !host.isNullOrBlank() && allowedHosts.contains(host.lowercase())
    }

    private fun isDownloadCandidate(uri: Uri): Boolean {
        val url = uri.toString().lowercase()
        val path = uri.path?.lowercase().orEmpty()

        if (url.contains("/generated-documents/")) return true
        if (url.contains("download=")) return true

        return path.endsWith(".pdf") ||
            path.endsWith(".csv") ||
            path.endsWith(".txt") ||
            path.endsWith(".doc") ||
            path.endsWith(".docx") ||
            path.endsWith(".xls") ||
            path.endsWith(".xlsx") ||
            path.endsWith(".zip")
    }

    private fun enqueueDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?
    ) {
        try {
            val fileName = buildDownloadFileName(
                URLUtil.guessFileName(url, contentDisposition, mimeType)
            )

            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(fileName)
                setDescription("Downloading file")
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                )
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true)
                setMimeType(mimeType ?: guessMimeType(url))
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)

                if (!userAgent.isNullOrBlank()) {
                    addRequestHeader("User-Agent", userAgent)
                }

                val cookies = CookieManager.getInstance().getCookie(url)
                if (!cookies.isNullOrBlank()) {
                    addRequestHeader("Cookie", cookies)
                }
            }

            val manager = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
            manager.enqueue(request)
            toast("Download started: $fileName")
        } catch (_: Exception) {
            toast("Could not start download.")
        }
    }

    private fun buildFileChooserIntent(fileChooserParams: FileChooserParams): Intent {
        val normalizedTypes = normalizeMimeTypes(fileChooserParams.acceptTypes)

        val pickIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (normalizedTypes.size == 1) normalizedTypes[0] else "*/*"
            putExtra(
                Intent.EXTRA_ALLOW_MULTIPLE,
                fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE
            )

            val nonWildcardTypes = normalizedTypes.filter { it != "*/*" }
            if (nonWildcardTypes.isNotEmpty()) {
                putExtra(Intent.EXTRA_MIME_TYPES, nonWildcardTypes.toTypedArray())
            }
        }

        val extraIntents = mutableListOf<Intent>()
        if (acceptsImages(normalizedTypes)) {
            createCameraIntent()?.let(extraIntents::add)
        }

        return Intent.createChooser(pickIntent, "Choose file").apply {
            putExtra(Intent.EXTRA_INITIAL_INTENTS, extraIntents.toTypedArray())
        }
    }

    private fun createCameraIntent(): Intent? {
        return runCatching {
            val picturesDir = File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "camera")
            if (!picturesDir.exists() && !picturesDir.mkdirs()) {
                return null
            }

            val imageFile = File.createTempFile("capture_", ".jpg", picturesDir)
            pendingCameraUri = FileProvider.getUriForFile(
                this,
                "${BuildConfig.APPLICATION_ID}.fileprovider",
                imageFile
            )

            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }

            intent.takeIf { it.resolveActivity(packageManager) != null }
        }.getOrElse {
            pendingCameraUri = null
            toast("Could not open the camera app.")
            null
        }
    }

    private fun normalizeMimeTypes(acceptTypes: Array<String>): Array<String> {
        val normalized = acceptTypes
            .flatMap { value -> value.split(",") }
            .map { value -> value.trim() }
            .filter { value -> value.isNotEmpty() }
            .map { value ->
                if (value.startsWith(".")) {
                    MimeTypeMap.getSingleton()
                        .getMimeTypeFromExtension(value.removePrefix(".").lowercase())
                        ?: "*/*"
                } else {
                    value
                }
            }
            .distinct()

        return if (normalized.isEmpty()) arrayOf("*/*") else normalized.toTypedArray()
    }

    private fun acceptsImages(acceptTypes: Array<String>): Boolean {
        return acceptTypes.any { type ->
            type == "*/*" || type == "image/*" || type.startsWith("image/")
        }
    }

    private fun requestWebPermissions(request: PermissionRequest) {
        val requiredPermissions = mutableListOf<String>()

        if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
            requiredPermissions += Manifest.permission.CAMERA
        }

        if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            requiredPermissions += Manifest.permission.RECORD_AUDIO
        }

        if (requiredPermissions.isEmpty()) {
            request.deny()
            return
        }

        val missingPermissions = requiredPermissions.filter { permission ->
            ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED
        }

        if (missingPermissions.isEmpty()) {
            request.grant(grantableWebResources(request))
            return
        }

        pendingWebPermissionRequest?.deny()
        pendingWebPermissionRequest = request
        webPermissionLauncher.launch(missingPermissions.toTypedArray())
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            toast("No app found to open this link.")
        }
    }

    private fun injectBlobDownloadHook() {
        val script = """
            (function() {
              if (window.__goldenAndroidDownloadHookInstalled) return;
              window.__goldenAndroidDownloadHookInstalled = true;

              async function sendBlobToAndroid(blob, fileName) {
                return new Promise(function(resolve, reject) {
                  const reader = new FileReader();
                  reader.onloadend = function() {
                    try {
                      const result = String(reader.result || "");
                      const commaIndex = result.indexOf(",");
                      const base64 = commaIndex >= 0 ? result.substring(commaIndex + 1) : "";
                      window.AndroidDownloadBridge.downloadBase64File(
                        base64,
                        blob.type || "application/octet-stream",
                        fileName || "download"
                      );
                      resolve();
                    } catch (error) {
                      reject(error);
                    }
                  };
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
              }

              async function handleDownloadUrl(url, fileName) {
                if (!url) return false;
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                  const response = await fetch(url);
                  const blob = await response.blob();
                  await sendBlobToAndroid(blob, fileName);
                  return true;
                }
                return false;
              }

              document.addEventListener("click", function(event) {
                const anchor = event.target && event.target.closest
                  ? event.target.closest("a[download]")
                  : null;
                if (!anchor) return;

                event.preventDefault();
                event.stopPropagation();

                handleDownloadUrl(
                  anchor.href,
                  anchor.getAttribute("download") || "download"
                ).catch(function(error) {
                  console.error("Android download bridge failed", error);
                });
              }, true);

              const originalOpen = window.open;
              window.open = function(url, target, features) {
                if (typeof url === "string" && (url.startsWith("blob:") || url.startsWith("data:"))) {
                  handleDownloadUrl(url, "download").catch(function(error) {
                    console.error("Android window.open download bridge failed", error);
                  });
                  return null;
                }
                return originalOpen.call(window, url, target, features);
              };
            })();
        """.trimIndent()

        binding.webView.evaluateJavascript(script, null)
    }

    private fun saveBase64Download(
        base64: String,
        mimeType: String,
        rawFileName: String
    ) {
        if (
            Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingBlobDownload = PendingBlobDownload(base64, mimeType, rawFileName)
            storagePermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }

        try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            val fileName = buildDownloadFileName(rawFileName)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }

                val uri = contentResolver.insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    values
                ) ?: throw IllegalStateException("Could not create download record.")

                contentResolver.openOutputStream(uri)?.use { output ->
                    output.write(bytes)
                } ?: throw IllegalStateException("Could not open output stream.")

                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                contentResolver.update(uri, values, null, null)
            } else {
                val downloadsDir = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS
                )
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs()
                }

                val file = File(downloadsDir, fileName)
                FileOutputStream(file).use { output ->
                    output.write(bytes)
                }

                MediaScannerConnection.scanFile(
                    this,
                    arrayOf(file.absolutePath),
                    arrayOf(mimeType),
                    null
                )
            }

            toast("Saved to Downloads: $fileName")
        } catch (_: Exception) {
            toast("Could not save generated file.")
        }
    }

    private fun buildDownloadFileName(rawName: String): String {
        val cleanName = rawName
            .ifBlank { "download" }
            .replace(Regex("""[\\/:*?"<>|]"""), "_")
            .trim()

        return "${System.currentTimeMillis()}-$cleanName"
    }

    private fun guessMimeType(url: String): String {
        val extension = MimeTypeMap.getFileExtensionFromUrl(url)
        return MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(extension?.lowercase())
            ?: "application/octet-stream"
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun grantableWebResources(request: PermissionRequest): Array<String> {
        val resources = mutableListOf<String>()

        if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
            resources += PermissionRequest.RESOURCE_VIDEO_CAPTURE
        }

        if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            resources += PermissionRequest.RESOURCE_AUDIO_CAPTURE
        }

        return resources.toTypedArray()
    }

    private data class PendingBlobDownload(
        val base64: String,
        val mimeType: String,
        val fileName: String
    )

    private inner class AppWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            if (!request.isForMainFrame) return false

            val uri = request.url
            val scheme = uri.scheme?.lowercase()

            if (scheme == "mailto" || scheme == "tel" || scheme == "sms" || scheme == "geo") {
                openExternal(uri)
                return true
            }

            if (scheme != "http" && scheme != "https") {
                openExternal(uri)
                return true
            }

            if (isDownloadCandidate(uri)) {
                enqueueDownload(uri.toString(), null, null, guessMimeType(uri.toString()))
                return true
            }

            if (isInternalHost(uri.host)) {
                return false
            }

            openExternal(uri)
            return true
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            binding.swipeRefresh.isRefreshing = false
            injectBlobDownloadHook()
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            super.onReceivedError(view, request, error)
            if (request.isForMainFrame) {
                binding.swipeRefresh.isRefreshing = false
                toast("Could not load page. Check your internet connection.")
            }
        }
    }

    private inner class AppChromeClient : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            binding.progressBar.progress = newProgress
            binding.progressBar.visibility = if (newProgress in 1..99) {
                android.view.View.VISIBLE
            } else {
                android.view.View.GONE
            }
            binding.swipeRefresh.isRefreshing = newProgress in 1..99
            super.onProgressChanged(view, newProgress)
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            runOnUiThread {
                requestWebPermissions(request)
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingWebPermissionRequest == request) {
                pendingWebPermissionRequest = null
            }
            super.onPermissionRequestCanceled(request)
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams
        ): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback

            return try {
                val chooserIntent = buildFileChooserIntent(fileChooserParams)
                fileChooserLauncher.launch(chooserIntent)
                true
            } catch (_: Exception) {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = null
                pendingCameraUri = null
                toast("Could not open file chooser.")
                false
            }
        }
    }

    private inner class DownloadBridge {
        @JavascriptInterface
        fun downloadBase64File(base64: String, mimeType: String?, fileName: String?) {
            runOnUiThread {
                saveBase64Download(
                    base64 = base64,
                    mimeType = mimeType ?: "application/octet-stream",
                    rawFileName = fileName ?: "download"
                )
            }
        }
    }
}
