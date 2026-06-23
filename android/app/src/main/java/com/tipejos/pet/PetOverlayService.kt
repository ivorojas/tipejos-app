package com.tipejos.pet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.exp

/**
 * Mantiene viva a la mascota como overlay sobre otras apps.
 * Posee la ventana (WindowManager), la física del rebote y el menú del long-press.
 */
class PetOverlayService : Service(), PetView.Callback {

    companion object {
        const val EXTRA_CHARACTER = "character"
        private const val CHANNEL_ID = "tipejos_pet"
        private const val NOTIF_ID = 1

        // Física
        private const val RESTITUTION = 0.72f   // energía conservada en cada rebote
        private const val DRAG = 1.6f            // fricción del aire (1/seg)
        private const val STOP_SPEED = 40f       // px/seg: por debajo de esto, frena

        @Volatile var soundOn = true
        @Volatile var running = false
    }

    private lateinit var wm: WindowManager
    private lateinit var params: WindowManager.LayoutParams
    private var petView: PetView? = null
    private var menuView: View? = null

    private var character = "Clippy"
    private var screenW = 0
    private var screenH = 0
    private var viewW = 0
    private var viewH = 0

    // Estado de la física
    private var posX = 0f
    private var posY = 0f
    private var velX = 0f
    private var velY = 0f
    private var physicsActive = false
    private var lastFrameNanos = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        character = intent?.getStringExtra(EXTRA_CHARACTER) ?: character
        if (petView == null) {
            // Android 14+ exige declarar el tipo de foreground service en startForeground.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIF_ID, buildNotification(),
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIF_ID, buildNotification())
            }
            createPet()
            running = true
        } else {
            // Cambio de personaje en caliente
            recreatePet()
        }
        return START_STICKY
    }

    // ── Crear la mascota ─────────────────────────────────────────────────────
    private fun createPet() {
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        measureScreen()

        val sheet = CharacterRepo.loadSheet(this, character)
        val data = CharacterRepo.loadData(this, character)
        if (sheet == null || data == null) { stopSelf(); return }

        // Tamaño en pantalla: alto objetivo ~140dp, manteniendo aspecto del sprite.
        val targetH = (140 * resources.displayMetrics.density).toInt()
        val sc = targetH.toFloat() / data.frameH
        viewH = targetH
        viewW = (data.frameW * sc).toInt()

        val pv = PetView(this, sheet, data, this)
        petView = pv

        params = WindowManager.LayoutParams(
            viewW, viewH,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,  // minSdk 26 garantiza este tipo
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        // Arranca abajo a la derecha (como en el escritorio)
        val margin = (16 * resources.displayMetrics.density)
        posX = (screenW - viewW - margin).coerceAtLeast(0f)
        posY = (screenH - viewH - margin * 5).coerceAtLeast(0f)
        params.x = posX.toInt()
        params.y = posY.toInt()

        wm.addView(pv, params)
        pv.playOnce(if (data.animations.containsKey("Show")) "Show" else data.randomIdle())
    }

    private fun recreatePet() {
        petView?.let { wm.removeView(it); it.destroy() }
        petView = null
        createPet()
    }

    private fun measureScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.maximumWindowMetrics.bounds
            screenW = b.width(); screenH = b.height()
        } else {
            val dm = resources.displayMetrics
            screenW = dm.widthPixels; screenH = dm.heightPixels
        }
    }

    private fun maxX() = (screenW - viewW).toFloat().coerceAtLeast(0f)
    private fun maxY() = (screenH - viewH).toFloat().coerceAtLeast(0f)

    // ── Callbacks de gestos ──────────────────────────────────────────────────
    override fun onGrab() {
        physicsActive = false
        velX = 0f; velY = 0f
    }

    override fun onMove(dxPx: Float, dyPx: Float) {
        posX = (posX + dxPx).coerceIn(0f, maxX())
        posY = (posY + dyPx).coerceIn(0f, maxY())
        params.x = posX.toInt(); params.y = posY.toInt()
        petView?.let { wm.updateViewLayout(it, params) }
    }

    override fun onFling(vxPxPerSec: Float, vyPxPerSec: Float) {
        velX = vxPxPerSec; velY = vyPxPerSec
        if (abs(velX) < STOP_SPEED && abs(velY) < STOP_SPEED) return
        if (!physicsActive) {
            physicsActive = true
            lastFrameNanos = 0L
            Choreographer.getInstance().postFrameCallback(frameCallback)
        }
    }

    override fun onTap() {
        val data = CharacterRepo.loadData(this, character) ?: return
        petView?.playOnce(data.randomTrick())
        // (sonido real: pendiente — soundOn ya queda listo para cuando se enganche el audio)
    }

    override fun onLongPress() {
        showMenu()
    }

    // ── Bucle de física: rebote entre los bordes ────────────────────────────
    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!physicsActive) return
            if (lastFrameNanos == 0L) { lastFrameNanos = frameTimeNanos
                Choreographer.getInstance().postFrameCallback(this); return }
            val dt = ((frameTimeNanos - lastFrameNanos) / 1e9f).coerceAtMost(0.05f)
            lastFrameNanos = frameTimeNanos

            posX += velX * dt
            posY += velY * dt

            // Rebote en bordes
            val mX = maxX(); val mY = maxY()
            if (posX <= 0f)  { posX = 0f;  velX = -velX * RESTITUTION }
            else if (posX >= mX) { posX = mX; velX = -velX * RESTITUTION }
            if (posY <= 0f)  { posY = 0f;  velY = -velY * RESTITUTION }
            else if (posY >= mY) { posY = mY; velY = -velY * RESTITUTION }

            // Fricción del aire (independiente de FPS)
            val f = exp(-DRAG * dt)
            velX *= f; velY *= f

            params.x = posX.toInt(); params.y = posY.toInt()
            petView?.let { wm.updateViewLayout(it, params) }

            if (abs(velX) < STOP_SPEED && abs(velY) < STOP_SPEED) {
                physicsActive = false
                return
            }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    // ── Menú flotante (long-press) ───────────────────────────────────────────
    private fun showMenu() {
        if (menuView != null) return
        val density = resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()

        val scrim = FrameLayout(this).apply {
            setBackgroundColor(0x66000000.toInt())
            isClickable = true
            setOnClickListener { hideMenu() }
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF20202C.toInt())
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }

        fun item(text: String, action: () -> Unit): Button = Button(this).apply {
            this.text = text
            isAllCaps = false
            setBackgroundColor(0x00000000)
            setTextColor(0xFFECEBF4.toInt())
            setOnClickListener { action() }
        }

        card.addView(TextView(this).apply {
            text = character
            setTextColor(0xFFA394FF.toInt())
            textSize = 16f
            setPadding(dp(8), dp(4), dp(8), dp(8))
        })
        card.addView(item(if (soundOn) "🔊 Sonido: activado" else "🔇 Sonido: desactivado") {
            soundOn = !soundOn
            hideMenu()
        })
        card.addView(item("⚙️ Ajustes") {
            startActivity(Intent(this@PetOverlayService, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            hideMenu()
        })
        card.addView(item("🗑️ Quitar mascota") {
            hideMenu()
            stopSelf()
        })

        val cardLp = FrameLayout.LayoutParams(dp(220), FrameLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.CENTER
        }
        scrim.addView(card, cardLp)

        val menuParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )
        menuView = scrim
        wm.addView(scrim, menuParams)
    }

    private fun hideMenu() {
        menuView?.let { wm.removeView(it) }
        menuView = null
    }

    // ── Notificación ─────────────────────────────────────────────────────────
    private fun buildNotification(): Notification {
        val ch = NotificationChannel(
            CHANNEL_ID, "Mascota Tipejos", NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Mantiene viva a tu mascota flotante" }
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(ch)

        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Tipejos está dando vueltas 🐾")
            .setContentText("Tocá para abrir y elegir personaje")
            .setSmallIcon(R.drawable.ic_pet)
            .setContentIntent(openApp)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        hideMenu()
        petView?.let { wm.removeView(it); it.destroy() }
        petView = null
        super.onDestroy()
    }
}
