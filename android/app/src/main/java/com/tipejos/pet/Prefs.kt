package com.tipejos.pet

import android.content.Context

/** Preferencias persistentes. El service las lee en vivo; MainActivity las escribe. */
object Prefs {
    private fun sp(ctx: Context) = ctx.getSharedPreferences("tipejos", Context.MODE_PRIVATE)

    fun bubbles(ctx: Context) = sp(ctx).getBoolean("bubbles", true)
    fun setBubbles(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean("bubbles", v).apply()

    /** Escala del texto del globo: 0.7 (chico) … 1.4 (grande). */
    fun bubbleScale(ctx: Context) = sp(ctx).getFloat("bubbleScale", 1.0f)
    fun setBubbleScale(ctx: Context, v: Float) = sp(ctx).edit().putFloat("bubbleScale", v).apply()

    fun bounce(ctx: Context) = sp(ctx).getBoolean("bounce", true)
    fun setBounce(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean("bounce", v).apply()

    fun sound(ctx: Context) = sp(ctx).getBoolean("sound", true)
    fun setSound(ctx: Context, v: Boolean) = sp(ctx).edit().putBoolean("sound", v).apply()

    /** Escala del personaje: 0.6 (chico) … 1.6 (grande). 1.0 = tamaño por defecto. */
    fun petScale(ctx: Context) = sp(ctx).getFloat("petScale", 1.0f)
    fun setPetScale(ctx: Context, v: Float) = sp(ctx).edit().putFloat("petScale", v).apply()
}
