package com.tipejos.pet

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Auto-update estilo escritorio: revisa un latest.json en GitHub, y si hay una versión
 * con versionCode mayor a la instalada, baja el APK y abre el instalador de Android.
 *
 * No instala silencioso (Android no lo permite fuera de Play): baja solo y el usuario
 * confirma con un toque. Requiere que todos los APK estén firmados con la MISMA llave.
 */
object UpdateChecker {

    // latest.json vive en la rama android-mvp del repo público.
    private const val MANIFEST_URL =
        "https://raw.githubusercontent.com/ivorojas/tipejos-app/android-mvp/android/latest.json"

    data class Update(
        val versionCode: Int,
        val versionName: String,
        val apkUrl: String,
        val notes: String
    )

    private val main = Handler(Looper.getMainLooper())

    /** Revisa en segundo plano. Llama onResult(update) si hay una más nueva, o onResult(null). */
    fun checkAsync(onResult: (Update?) -> Unit) {
        Thread {
            val update = try {
                val json = httpGet(MANIFEST_URL)
                val obj = JSONObject(json)
                val remoteCode = obj.getInt("versionCode")
                if (remoteCode > BuildConfig.VERSION_CODE) {
                    Update(
                        versionCode = remoteCode,
                        versionName = obj.optString("versionName", "?"),
                        apkUrl = obj.getString("apkUrl"),
                        notes = obj.optString("notes", "")
                    )
                } else null
            } catch (e: Exception) {
                null // sin red / repo caído: simplemente no hay update
            }
            main.post { onResult(update) }
        }.start()
    }

    /** Baja el APK y abre el instalador. onProgress(0..100), onError(msg). */
    fun downloadAndInstall(
        activity: Activity,
        update: Update,
        onProgress: (Int) -> Unit,
        onError: (String) -> Unit
    ) {
        Thread {
            try {
                val dir = File(activity.getExternalFilesDir(null), "updates").apply { mkdirs() }
                val apk = File(dir, "tipejos-${update.versionCode}.apk")

                val conn = (URL(update.apkUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 15000; readTimeout = 30000
                    instanceFollowRedirects = true
                }
                conn.connect()
                val total = conn.contentLength.toLong().coerceAtLeast(1)
                conn.inputStream.use { input ->
                    apk.outputStream().use { out ->
                        val buf = ByteArray(8192)
                        var read: Int
                        var done = 0L
                        while (input.read(buf).also { read = it } != -1) {
                            out.write(buf, 0, read)
                            done += read
                            main.post { onProgress(((done * 100) / total).toInt().coerceIn(0, 100)) }
                        }
                    }
                }
                main.post { launchInstaller(activity, apk, onError) }
            } catch (e: Exception) {
                main.post { onError("No se pudo descargar: ${e.message}") }
            }
        }.start()
    }

    private fun launchInstaller(activity: Activity, apk: File, onError: (String) -> Unit) {
        // Android 8+: la app necesita permiso para instalar de fuentes desconocidas.
        if (!activity.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}")
                )
            )
            onError("Activá 'Instalar apps desconocidas' para Tipejos y reintentá la actualización.")
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
    }

    private fun httpGet(urlStr: String): String {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10000; readTimeout = 10000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
        }
        conn.inputStream.bufferedReader().use { return it.readText() }
    }
}
