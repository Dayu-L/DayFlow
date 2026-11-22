package com.dayflow.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final String HOST = "appassets.local";
    private static final int REQ_SAVE_FILE = 1001;
    private static final int REQ_FILE_CHOOSER = 1002;
    private static final int REQ_NATIVE_IMAGE = 1003;
    private static final int REQ_NOTIFICATIONS = 1004;
    private static final int REQ_MIC = 1005;

    private WebView webView;
    private boolean fallbackUsed = false;
    private String pendingContent;
    private String pendingEventId;
    private ValueCallback<Uri[]> filePathCallback;
    private android.speech.SpeechRecognizer speech;
    private boolean voiceListening;
    private boolean voiceReady;
    private final android.os.Handler voiceHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(Color.parseColor("#171614"));
        window.setNavigationBarColor(Color.parseColor("#171614"));
        if (Build.VERSION.SDK_INT >= 23) {
            int flags = window.getDecorView().getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }

        Intent launchIntent = getIntent();
        if (launchIntent != null) {
            String eventId = launchIntent.getStringExtra("eventId");
            if (eventId != null && !eventId.isEmpty()) pendingEventId = eventId;
        }
        ReminderScheduler.ensureChannel(this);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.parseColor("#F2F4F7"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setLongClickable(false);
        webView.setOnLongClickListener(v -> true);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new NativeBridge(), "DayFlowNative");
        webView.setWebViewClient(new LocalAssetClient());
        webView.setWebChromeClient(new DialogChromeClient());

        setContentView(webView);
        webView.loadUrl("https://" + HOST + "/index.html");
    }

    private class LocalAssetClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri == null || !HOST.equals(uri.getHost())) {
                return null;
            }
            String path = uri.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) {
                path = "/index.html";
            }
            if (path.contains("..")) {
                return notFound();
            }
            try {
                InputStream stream = getAssets().open("www" + path);
                return new WebResourceResponse(mimeOf(path), "utf-8", stream);
            } catch (Exception e) {
                return notFound();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri != null && HOST.equals(uri.getHost())) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                // 没有可以打开这个链接的应用
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            deliverPendingEvent();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !fallbackUsed) {
                fallbackUsed = true;
                webView.loadUrl("file:///android_asset/www/index.html");
            }
        }
    }

    private class DialogChromeClient extends WebChromeClient {
        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setCancelable(false)
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setCancelable(false)
                    .show();
            return true;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;
            try {
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                startActivityForResult(intent, REQ_FILE_CHOOSER);
                return true;
            } catch (Exception first) {
                try {
                    // Some ROMs have no GET_CONTENT handler for this MIME type; SAF is the fallback.
                    Intent fallback = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    fallback.addCategory(Intent.CATEGORY_OPENABLE);
                    fallback.setType("image/*");
                    fallback.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(fallback, REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception second) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开图片选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        }
    }

    private class NativeBridge {
        /** WebView 里没有 Web Speech API：语音走系统识别，结果回调给 window.__dayflowVoice。 */
        @JavascriptInterface
        public void startVoice() {
            runOnUiThread(MainActivity.this::startVoiceInternal);
        }

        /** 打开系统的「应用信息」页，方便改电池 / 自启动。 */
        @JavascriptInterface
        public void openAppSettings() {
            try {
                Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                i.setData(Uri.parse("package:" + getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Throwable t) {
                Toast.makeText(MainActivity.this, "打不开系统设置", Toast.LENGTH_SHORT).show();
            }
        }

        @JavascriptInterface
        public void stopVoice() {
            runOnUiThread(MainActivity.this::stopVoiceInternal);
        }

        /** 日知推进来的增量：取一次就删，JS 端合并后重新发一份导出。 */
        @JavascriptInterface
        public String takeInbox() {
            return SyncStore.takeInbox(MainActivity.this);
        }

        /** 日知会读这个：把当前全部数据的一份导出 JSON 落到私有目录。 */
        @JavascriptInterface
        public void publishSync(final String json) {
            SyncStore.write(MainActivity.this, json);
        }

        @JavascriptInterface
        public void pickImage() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try {
                    startActivityForResult(intent, REQ_NATIVE_IMAGE);
                } catch (Exception first) {
                    try {
                        Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
                        fallback.addCategory(Intent.CATEGORY_OPENABLE);
                        fallback.setType("image/*");
                        startActivityForResult(fallback, REQ_NATIVE_IMAGE);
                    } catch (Exception second) {
                        Toast.makeText(MainActivity.this, "无法打开图片选择器", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void syncReminders(final String json) {
            ReminderScheduler.sync(MainActivity.this, json);
        }

        @JavascriptInterface
        public void updateWidget(final String json) {
            DayFlowWidgetProvider.saveSnapshot(MainActivity.this, json);
            DayFlowWidgetProvider.updateAll(MainActivity.this);
        }

        @JavascriptInterface
        public boolean requestPinWidget() {
            boolean supported = DayFlowWidgetProvider.canPin(MainActivity.this);
            if (supported) {
                runOnUiThread(() -> DayFlowWidgetProvider.requestPin(MainActivity.this));
            }
            return supported;
        }

        @JavascriptInterface
        public boolean hasNotificationPermission() {
            if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            android.app.NotificationManager nm =
                    (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            return nm != null && nm.areNotificationsEnabled();
        }

        @JavascriptInterface
        public boolean needsExactAlarm() {
            return ReminderScheduler.needsExactAlarm(MainActivity.this);
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
                }
            });
        }

        @JavascriptInterface
        public void openExactAlarmSettings() {
            runOnUiThread(() -> ReminderScheduler.openExactAlarmSettings(MainActivity.this));
        }

        @JavascriptInterface
        public void exportFile(final String filename, final String mime, final String content) {
            runOnUiThread(() -> {
                pendingContent = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mime == null || mime.isEmpty() ? "text/calendar" : mime);
                intent.putExtra(Intent.EXTRA_TITLE,
                        filename == null || filename.isEmpty() ? "dayflow.ics" : filename);
                try {
                    startActivityForResult(intent, REQ_SAVE_FILE);
                } catch (Exception e) {
                    pendingContent = null;
                    Toast.makeText(MainActivity.this, "无法打开保存面板", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == REQ_NATIVE_IMAGE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                final Uri uri = data.getData();
                Toast.makeText(this, "正在读取图片", Toast.LENGTH_SHORT).show();
                new Thread(() -> {
                    try {
                        Bitmap bitmap = loadBitmap(uri);
                        if (bitmap == null) {
                            throw new IllegalStateException("decode failed");
                        }
                        ByteArrayOutputStream out = new ByteArrayOutputStream();
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out);
                        bitmap.recycle();
                        final String base64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                        runOnUiThread(() -> {
                            if (webView != null) {
                                webView.evaluateJavascript(
                                        "window.__dayflowNativeImage && window.__dayflowNativeImage('data:image/jpeg;base64," +
                                                base64 + "','image')", null);
                            }
                        });
                    } catch (Exception e) {
                        runOnUiThread(() -> Toast.makeText(MainActivity.this,
                                "无法读取图片", Toast.LENGTH_SHORT).show());
                    }
                }).start();
            }
            return;
        }

        if (requestCode != REQ_SAVE_FILE) {
            return;
        }
        if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingContent != null) {
            try (OutputStream os = getContentResolver().openOutputStream(data.getData())) {
                if (os == null) {
                    throw new IllegalStateException("output stream is null");
                }
                os.write(pendingContent.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "保存失败", Toast.LENGTH_SHORT).show();
            }
        }
        pendingContent = null;
    }

    private Bitmap loadBitmap(Uri uri) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(is, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

        int sample = 1;
        while (bounds.outWidth / sample > 2600 || bounds.outHeight / sample > 2600) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap;
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            bitmap = BitmapFactory.decodeStream(is, null, options);
        }
        if (bitmap == null) return null;

        try (InputStream is = getContentResolver().openInputStream(uri)) {
            ExifInterface exif = new ExifInterface(is);
            int orientation = exif.getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            Matrix matrix = new Matrix();
            switch (orientation) {
                case ExifInterface.ORIENTATION_ROTATE_90: matrix.postRotate(90); break;
                case ExifInterface.ORIENTATION_ROTATE_180: matrix.postRotate(180); break;
                case ExifInterface.ORIENTATION_ROTATE_270: matrix.postRotate(270); break;
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.postScale(1, -1); break;
                default: break;
            }
            if (!matrix.isIdentity()) {
                Bitmap rotated = Bitmap.createBitmap(
                        bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                if (rotated != bitmap) bitmap.recycle();
                bitmap = rotated;
            }
        } catch (Exception ignored) {
            /* 没有 EXIF 或不支持，按原图处理 */
        }

        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        float scale = Math.min(1f, 2600f / Math.max(w, h));
        if (scale < 1f) {
            Bitmap scaled = Bitmap.createScaledBitmap(
                    bitmap, Math.max(1, Math.round(w * scale)),
                    Math.max(1, Math.round(h * scale)), true);
            if (scaled != bitmap) bitmap.recycle();
            bitmap = scaled;
            w = bitmap.getWidth();
            h = bitmap.getHeight();
        }

        Bitmap flattened = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(flattened);
        canvas.drawColor(Color.WHITE);
        canvas.drawBitmap(bitmap, 0, 0, null);
        bitmap.recycle();
        return flattened;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent == null) return;
        String eventId = intent.getStringExtra("eventId");
        if (eventId != null && !eventId.isEmpty()) {
            pendingEventId = eventId;
            deliverPendingEvent();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS && webView != null) {
            webView.evaluateJavascript(
                    "window.DayFlow && window.DayFlow.onAppResume && window.DayFlow.onAppResume()", null);
        }
        if (requestCode == REQ_MIC) {
            boolean ok = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) {
                startVoiceInternal();
            } else {
                Toast.makeText(this, "没有麦克风权限，语音用不了", Toast.LENGTH_SHORT).show();
                emitVoice("", true);
            }
        }
    }

    private void deliverPendingEvent() {
        if (pendingEventId == null || pendingEventId.isEmpty() || webView == null) return;
        final String eventId = pendingEventId;
        pendingEventId = null;
        webView.evaluateJavascript(
                "window.__dayflowOpenEvent && window.__dayflowOpenEvent(" + JSONObject.quote(eventId) + ")",
                null);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return '1';}if(window.__dayflowHandleBack&&window.__dayflowHandleBack())return '1';return '0';})()",
                value -> {
                    if ("\"1\"".equals(value)) {
                        return;
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        moveTaskToBack(true);
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
            webView.evaluateJavascript(
                    "window.DayFlow && window.DayFlow.onAppResume && window.DayFlow.onAppResume()", null);
        }
    }

    // ---------------------------------------------------------------- 语音输入

    private void startVoiceInternal() {
        android.util.Log.d("DayFlowVoice", "startVoiceInternal");
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        if (!android.speech.SpeechRecognizer.isRecognitionAvailable(this)) {
            Toast.makeText(this, "这台手机没有可用的语音识别服务", Toast.LENGTH_SHORT).show();
            emitVoice("", true);
            return;
        }
        if (speech == null) {
            speech = android.speech.SpeechRecognizer.createSpeechRecognizer(this);
            speech.setRecognitionListener(new android.speech.RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {
                    android.util.Log.d("DayFlowVoice", "ready");
                    voiceReady = true;
                    voiceListening = true;
                }

                @Override
                public void onBeginningOfSpeech() {
                }

                @Override
                public void onRmsChanged(float rmsdB) {
                }

                @Override
                public void onBufferReceived(byte[] buffer) {
                }

                @Override
                public void onEndOfSpeech() {
                    android.util.Log.d("DayFlowVoice", "endOfSpeech");
                }

                @Override
                public void onError(int error) {
                    voiceHandler.removeCallbacksAndMessages(null);
                    android.util.Log.d("DayFlowVoice", "error=" + error);
                    Toast.makeText(MainActivity.this, "语音识别出错 " + error, Toast.LENGTH_SHORT).show();
                    voiceListening = false;
                    emitVoice("", true);
                    if (error == android.speech.SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        Toast.makeText(MainActivity.this, "没有麦克风权限", Toast.LENGTH_SHORT).show();
                    }
                }

                @Override
                public void onResults(Bundle results) {
                    voiceHandler.removeCallbacksAndMessages(null);
                    android.util.Log.d("DayFlowVoice", "results=" + bestText(results));
                    voiceListening = false;
                    emitVoice(bestText(results), true);
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    String t = bestText(partialResults);
                    if (!t.isEmpty()) emitVoice(t, false);
                }

                @Override
                public void onEvent(int eventType, Bundle params) {
                }
            });
        }
        Intent intent = new Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
        intent.putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "zh-CN");
        intent.putExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        voiceReady = false;
        try {
            speech.startListening(intent);
            voiceListening = true;
            voiceHandler.removeCallbacksAndMessages(null);
            voiceHandler.postDelayed(() -> {
                if (!voiceReady) {
                    Toast.makeText(MainActivity.this,
                            "这台手机的语音识别没响应，估计没有可用的语音引擎", Toast.LENGTH_LONG).show();
                    stopVoiceInternal();
                }
            }, 6000);
        } catch (Throwable t) {
            voiceListening = false;
            Toast.makeText(this, "语音输入启动失败", Toast.LENGTH_SHORT).show();
            emitVoice("", true);
        }
    }

    private void stopVoiceInternal() {
        voiceListening = false;
        voiceReady = false;
        voiceHandler.removeCallbacksAndMessages(null);
        if (speech != null) {
            try {
                speech.stopListening();
            } catch (Throwable ignored) {
            }
            try {
                speech.cancel();
            } catch (Throwable ignored) {
            }
        }
        emitVoice("", true);
    }

    private static String bestText(Bundle b) {
        if (b == null) return "";
        java.util.ArrayList<String> list = b.getStringArrayList(
                android.speech.SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null || list.isEmpty()) return "";
        String s = list.get(0);
        return s == null ? "" : s.trim();
    }

    private void emitVoice(final String text, final boolean done) {
        if (webView == null) return;
        webView.evaluateJavascript("window.__dayflowVoice && window.__dayflowVoice("
                + JSONObject.quote(text) + "," + done + ")", null);
    }

    @Override
    protected void onDestroy() {
        if (speech != null) {
            try {
                speech.destroy();
            } catch (Throwable ignored) {
            }
            speech = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse(
                "text/plain",
                "utf-8",
                new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8)));
    }

    private String mimeOf(String path) {
        if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }
}
