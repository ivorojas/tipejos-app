package com.tipejos.pet

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.Rect
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
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
 * Mantiene viva a la mascota como overlay. Posee la ventana, la física del rebote,
 * los globos de texto, el sonido y el menú del long-press.
 */
class PetOverlayService : Service(), PetView.Callback {

    companion object {
        const val EXTRA_CHARACTER = "character"
        private const val CHANNEL_ID = "tipejos_pet"
        private const val NOTIF_ID = 1

        private const val RESTITUTION = 0.5f     // rebote más suave (antes 0.72)
        private const val DRAG = 1.6f
        private const val STOP_SPEED = 40f

        @Volatile var running = false
    }

    private lateinit var wm: WindowManager
    private lateinit var params: WindowManager.LayoutParams
    private var petView: PetView? = null
    private var menuView: View? = null
    private var bubbleView: View? = null

    private var character = "Clippy"
    private var screenW = 0
    private var screenH = 0
    private var viewW = 0
    private var viewH = 0

    private var posX = 0f
    private var posY = 0f
    private var velX = 0f
    private var velY = 0f
    private var physicsActive = false
    private var bounceOn = true
    private var lastFrameNanos = 0L

    private val ui = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        character = intent?.getStringExtra(EXTRA_CHARACTER) ?: character
        if (petView == null) {
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
            ui.postDelayed(bubbleTimer, 9000)
        } else {
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

        // Recuadro real del muñeco (sin márgenes transparentes) → toca los bordes.
        val bounds: Rect = CharacterRepo.computeContentBounds(sheet, data)
        val contentW = bounds.width().coerceAtLeast(1)
        val contentH = bounds.height().coerceAtLeast(1)

        // Tamaño físico proporcional a la resolución nativa del arte: arte grande
        // (Bonzi ~160px) se ve grande; arte chico (Clippy ~90px) se ve más chico y nítido.
        val density = resources.displayMetrics.density
        val targetHdp = (contentH * 0.85f).coerceIn(64f, 150f)
        val sc = (targetHdp * density) / contentH
        viewH = (contentH * sc).toInt().coerceAtLeast(1)
        viewW = (contentW * sc).toInt().coerceAtLeast(1)

        val pv = PetView(this, sheet, data, bounds, this)
        petView = pv

        params = WindowManager.LayoutParams(
            viewW, viewH,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.START }

        val margin = (16 * density)
        posX = (screenW - viewW - margin).coerceAtLeast(0f)
        posY = (screenH - viewH - margin * 5).coerceAtLeast(0f)
        params.x = posX.toInt(); params.y = posY.toInt()

        wm.addView(pv, params)
        pv.playOnce(if (data.animations.containsKey("Show")) "Show" else data.randomIdle())
    }

    private fun recreatePet() {
        removeBubble()
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
        bounceOn = Prefs.bounce(this)
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
        playSound()
        if (Prefs.bubbles(this)) {
            CharacterRepo.loadPhrases(this, character)?.click?.randomOrNull()?.let { showBubble(it) }
        }
    }

    override fun onLongPress() = showMenu()

    // ── Física: rebote entre bordes ──────────────────────────────────────────
    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!physicsActive) return
            if (lastFrameNanos == 0L) {
                lastFrameNanos = frameTimeNanos
                Choreographer.getInstance().postFrameCallback(this); return
            }
            val dt = ((frameTimeNanos - lastFrameNanos) / 1e9f).coerceAtMost(0.05f)
            lastFrameNanos = frameTimeNanos

            posX += velX * dt
            posY += velY * dt

            val mX = maxX(); val mY = maxY()
            if (posX <= 0f)      { posX = 0f;  velX = if (bounceOn) -velX * RESTITUTION else 0f }
            else if (posX >= mX) { posX = mX;  velX = if (bounceOn) -velX * RESTITUTION else 0f }
            if (posY <= 0f)      { posY = 0f;  velY = if (bounceOn) -velY * RESTITUTION else 0f }
            else if (posY >= mY) { posY = mY;  velY = if (bounceOn) -velY * RESTITUTION else 0f }

            val f = exp(-DRAG * dt)
            velX *= f; velY *= f

            params.x = posX.toInt(); params.y = posY.toInt()
            petView?.let { wm.updateViewLayout(it, params) }

            if (abs(velX) < STOP_SPEED && abs(velY) < STOP_SPEED) { physicsActive = false; return }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    // ── Sonido ───────────────────────────────────────────────────────────────
    private fun playSound() {
        if (!Prefs.sound(this)) return
        val sounds = CharacterRepo.listSounds(this, character)
        if (sounds.isEmpty()) return
        try {
            val afd = assets.openFd(sounds.random())
            val mp = MediaPlayer()
            mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            mp.setOnCompletionListener { it.release(); runCatching { afd.close() } }
            mp.setOnErrorListener { _, _, _ -> mp.release(); runCatching { afd.close() }; true }
            mp.setOnPreparedListener { it.start() }
            mp.prepareAsync()
        } catch (e: Exception) { /* sin sonido */ }
    }

    // ── Globos de texto ──────────────────────────────────────────────────────
    private val bubbleTimer = object : Runnable {
        override fun run() {
            if (Prefs.bubbles(this@PetOverlayService) && petView != null && menuView == null) {
                CharacterRepo.loadPhrases(this@PetOverlayService, character)?.idle?.randomOrNull()
                    ?.let { showBubble(it) }
            }
            ui.postDelayed(this, (22000..38000).random().toLong())
        }
    }

    private val bubbleDismiss = Runnable { removeBubble() }

    private fun showBubble(text: String) {
        removeBubble()
        val density = resources.displayMetrics.density
        fun dp(v: Int) = (v * density).toInt()
        val tv = TextView(this).apply {
            this.text = text
            setTextColor(0xFF15151D.toInt())
            textSize = 13f * Prefs.bubbleScale(this@PetOverlayService)
            setPadding(dp(12), dp(8), dp(12), dp(8))
            maxWidth = dp(220)
            setBackgroundResource(R.drawable.bubble_bg)
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = posX.toInt().coerceIn(0, (screenW - dp(230)).coerceAtLeast(0))
            y = if (posY > dp(70)) (posY.toInt() - dp(54)) else (posY.toInt() + viewH)
        }
        bubbleView = tv
        try { wm.addView(tv, lp) } catch (e: Exception) { bubbleView = null; return }
        ui.removeCallbacks(bubbleDismiss)
        ui.postDelayed(bubbleDismiss, 3800)
    }

    private fun removeBubble() {
        ui.removeCallbacks(bubbleDismiss)
        bubbleView?.let { runCatching { wm.removeView(it) } }
        bubbleView = null
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
        fun item(text: String, action: () -> Unit) = Button(this).apply {
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
        val soundNow = Prefs.sound(this)
        card.addView(item(if (soundNow) "🔊 Sonido: activado" else "🔇 Sonido: desactivado") {
            Prefs.setSound(this, !soundNow); hideMenu()
        })
        val bubblesNow = Prefs.bubbles(this)
        card.addView(item(if (bubblesNow) "💬 Globos: activados" else "💬 Globos: desactivados") {
            Prefs.setBubbles(this, !bubblesNow); if (bubblesNow) removeBubble(); hideMenu()
        })
        card.addView(item("⚙️ Ajustes") {
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            hideMenu()
        })
        card.addView(item("🗑️ Quitar mascota") { hideMenu(); stopSelf() })

        scrim.addView(card, FrameLayout.LayoutParams(dp(230), FrameLayout.LayoutParams.WRAP_CONTENT)
            .apply { gravity = Gravity.CENTER })

        val menuParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )
        menuView = scrim
        wm.addView(scrim, menuParams)
    }

    private fun hideMenu() {
        menuView?.let { runCatching { wm.removeView(it) } }
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
        ui.removeCallbacksAndMessages(null)
        Choreographer.getInstance().removeFrameCallback(frameCallback)
        removeBubble()
        hideMenu()
        petView?.let { runCatching { wm.removeView(it) }; it.destroy() }
        petView = null
        super.onDestroy()
    }
}
