package com.tipejos.pet

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject

/**
 * Carga los personajes desde app/src/main/assets/agents/.
 * Cada personaje tiene: map.png (sprite sheet), thumb.png, frames.json.
 * frames.json -> { "framesize":[w,h], "animations": { "Name":[ {"x":..,"y":..,"d":..}, ... ] } }
 */
object CharacterRepo {

    data class Frame(val x: Int, val y: Int, val d: Int)
    data class CharData(
        val frameW: Int,
        val frameH: Int,
        val animations: Map<String, List<Frame>>
    ) {
        /** Nombre de una animación idle al azar (o RestPose si no hay idle). */
        fun randomIdle(): String {
            val idles = animations.keys.filter { it.startsWith("Idle", ignoreCase = true) }
            return idles.randomOrNull()
                ?: listOf("RestPose", "Show").firstOrNull { animations.containsKey(it) }
                ?: animations.keys.first()
        }

        /** Una animación "truco" para el tap (gestos, saludos…). */
        fun randomTrick(): String {
            val tricks = animations.keys.filter {
                it.startsWith("Idle", true) || it in setOf(
                    "Greeting", "Wave", "GestureUp", "Pleased", "Congratulate", "GetAttention", "Alert"
                )
            }
            return tricks.randomOrNull() ?: randomIdle()
        }
    }

    private val dataCache = HashMap<String, CharData>()

    fun listCharacters(ctx: Context): List<String> {
        return try {
            val raw = ctx.assets.open("agents/index.json").bufferedReader().use { it.readText() }
            val arr = org.json.JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        } catch (e: Exception) {
            // Fallback: listar carpetas
            ctx.assets.list("agents")?.filter { !it.endsWith(".json") }?.sorted() ?: emptyList()
        }
    }

    fun loadThumb(ctx: Context, name: String): Bitmap? = try {
        ctx.assets.open("agents/$name/thumb.png").use { BitmapFactory.decodeStream(it) }
    } catch (e: Exception) { null }

    fun loadSheet(ctx: Context, name: String): Bitmap? = try {
        val opts = BitmapFactory.Options().apply { inScaled = false }
        ctx.assets.open("agents/$name/map.png").use { BitmapFactory.decodeStream(it, null, opts) }
    } catch (e: Exception) { null }

    fun loadData(ctx: Context, name: String): CharData? {
        dataCache[name]?.let { return it }
        return try {
            val raw = ctx.assets.open("agents/$name/frames.json").bufferedReader().use { it.readText() }
            val obj = JSONObject(raw)
            val fs = obj.getJSONArray("framesize")
            val animsObj = obj.getJSONObject("animations")
            val anims = HashMap<String, List<Frame>>()
            val keys = animsObj.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                val frArr = animsObj.getJSONArray(k)
                val frames = ArrayList<Frame>(frArr.length())
                for (i in 0 until frArr.length()) {
                    val f = frArr.getJSONObject(i)
                    frames.add(Frame(f.getInt("x"), f.getInt("y"), f.optInt("d", 100)))
                }
                anims[k] = frames
            }
            val data = CharData(fs.getInt(0), fs.getInt(1), anims)
            dataCache[name] = data
            data
        } catch (e: Exception) { null }
    }
}
