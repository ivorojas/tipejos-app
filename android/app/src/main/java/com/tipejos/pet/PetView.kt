package com.tipejos.pet

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.VelocityTracker

/**
 * Vista del personaje. Dibuja el frame actual del sprite sheet escalado al tamaño de la vista,
 * cicla la animación según la duración de cada frame, y reporta los gestos a [callback].
 */
@SuppressLint("ClickableViewAccessibility")
class PetView(
    context: Context,
    private val sheet: Bitmap,
    private val data: CharacterRepo.CharData,
    private val callback: Callback
) : View(context) {

    interface Callback {
        fun onGrab()                       // el usuario apoyó el dedo (frena la física)
        fun onMove(dxPx: Float, dyPx: Float)
        fun onFling(vxPxPerSec: Float, vyPxPerSec: Float)
        fun onLongPress()
        fun onTap()
    }

    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val srcRect = Rect()
    private val dstRect = RectF()

    // Animación
    private var frames: List<CharacterRepo.Frame> = emptyList()
    private var frameIdx = 0
    private var loopForever = true
    private var onAnimEnd: (() -> Unit)? = null
    private val handler = Handler(Looper.getMainLooper())

    // Pulso de escala (long-press / tap)
    private var scale = 1f

    private val advance = object : Runnable {
        override fun run() {
            if (frames.isEmpty()) return
            frameIdx++
            if (frameIdx >= frames.size) {
                if (loopForever) {
                    frameIdx = 0
                } else {
                    frameIdx = frames.size - 1
                    invalidate()
                    onAnimEnd?.invoke()
                    return
                }
            }
            invalidate()
            handler.postDelayed(this, frames[frameIdx].d.toLong().coerceAtLeast(16))
        }
    }

    init {
        playLoop(data.randomIdle())
        // Cada cierto tiempo, cambiar a otra animación idle para que parezca vivo.
        scheduleIdleShuffle()
    }

    private fun scheduleIdleShuffle() {
        handler.postDelayed({
            if (loopForever) playLoop(data.randomIdle())
            scheduleIdleShuffle()
        }, (6000..11000).random().toLong())
    }

    /** Reproduce una animación en loop. */
    fun playLoop(name: String) {
        val f = data.animations[name] ?: return
        handler.removeCallbacks(advance)
        frames = f; frameIdx = 0; loopForever = true; onAnimEnd = null
        invalidate()
        if (frames.size > 1) handler.postDelayed(advance, frames[0].d.toLong().coerceAtLeast(16))
    }

    /** Reproduce una animación una vez y vuelve al idle. */
    fun playOnce(name: String) {
        val f = data.animations[name] ?: return
        handler.removeCallbacks(advance)
        frames = f; frameIdx = 0; loopForever = false
        onAnimEnd = { playLoop(data.randomIdle()) }
        invalidate()
        if (frames.size > 1) handler.postDelayed(advance, frames[0].d.toLong().coerceAtLeast(16))
    }

    /** Animación de "squash" rápida (achicar/agrandar) para el long-press. */
    fun pulse() {
        val anim = android.animation.ValueAnimator.ofFloat(1f, 0.78f, 1.12f, 1f)
        anim.duration = 320
        anim.addUpdateListener { scale = it.animatedValue as Float; invalidate() }
        anim.start()
    }

    override fun onDraw(canvas: Canvas) {
        if (frames.isEmpty()) return
        val fr = frames[frameIdx.coerceIn(0, frames.size - 1)]
        srcRect.set(fr.x, fr.y, fr.x + data.frameW, fr.y + data.frameH)

        val cx = width / 2f
        val cy = height / 2f
        val halfW = width / 2f * scale
        val halfH = height / 2f * scale
        dstRect.set(cx - halfW, cy - halfH, cx + halfW, cy + halfH)
        canvas.drawBitmap(sheet, srcRect, dstRect, paint)
    }

    // ── Gestos ────────────────────────────────────────────────────────────────
    private var lastRawX = 0f
    private var lastRawY = 0f
    private var dragging = false
    private var velocityTracker: VelocityTracker? = null

    private val gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onLongPress(e: MotionEvent) {
            dragging = false
            pulse()
            callback.onLongPress()
        }
        override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
            callback.onTap()
            return true
        }
    })

    override fun onTouchEvent(event: MotionEvent): Boolean {
        gestureDetector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastRawX = event.rawX; lastRawY = event.rawY
                dragging = true
                callback.onGrab()
                velocityTracker?.recycle()
                velocityTracker = VelocityTracker.obtain()
                velocityTracker?.addMovement(event)
            }
            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)
                if (dragging) {
                    val dx = event.rawX - lastRawX
                    val dy = event.rawY - lastRawY
                    lastRawX = event.rawX; lastRawY = event.rawY
                    callback.onMove(dx, dy)
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                velocityTracker?.let { vt ->
                    vt.addMovement(event)
                    vt.computeCurrentVelocity(1000) // px/seg
                    if (dragging) callback.onFling(vt.xVelocity, vt.yVelocity)
                    vt.recycle()
                }
                velocityTracker = null
                dragging = false
            }
        }
        return true
    }

    fun destroy() {
        handler.removeCallbacksAndMessages(null)
    }
}
