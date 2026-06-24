package com.tipejos.pet

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
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

    // ── Frases ───────────────────────────────────────────────────────────────
    data class Phrases(val idle: List<String>, val click: List<String>)

    fun loadPhrases(ctx: Context, name: String): Phrases? = try {
        val raw = ctx.assets.open("agents/$name/phrases.json").bufferedReader().use { it.readText() }
        val obj = JSONObject(raw)
        fun arr(k: String): List<String> {
            val a = obj.optJSONArray(k) ?: return emptyList()
            return (0 until a.length()).map { a.getString(it) }
        }
        Phrases(arr("idle"), arr("click").ifEmpty { arr("idle") })
    } catch (e: Exception) { null }

    // ── Sonidos ──────────────────────────────────────────────────────────────
    fun listSounds(ctx: Context, name: String): List<String> = try {
        ctx.assets.list("agents/$name/sounds")?.map { "agents/$name/sounds/$it" } ?: emptyList()
    } catch (e: Exception) { emptyList() }

    /**
     * Recuadro real del personaje dentro de un frame (píxeles no transparentes),
     * unión sobre todos los frames. Sirve para ajustar la ventana al muñeco y que toque los bordes.
     * Devuelve coords locales [left,top,right,bottom] dentro de un frame de framesize.
     */
    fun computeContentBounds(sheet: Bitmap, data: CharData): Rect {
        val fw = data.frameW; val fh = data.frameH
        if (fw <= 0 || fh <= 0) return Rect(0, 0, 1, 1)
        var minX = fw; var minY = fh; var maxX = 0; var maxY = 0
        val origins = HashSet<Long>()
        for (frames in data.animations.values)
            for (f in frames) origins.add((f.x.toLong() shl 20) or f.y.toLong())
        val px = IntArray(fw * fh)
        val sw = sheet.width; val sh = sheet.height
        for (key in origins) {
            val fx = (key shr 20).toInt(); val fy = (key and 0xFFFFF).toInt()
            if (fx < 0 || fy < 0 || fx + fw > sw || fy + fh > sh) continue
            sheet.getPixels(px, 0, fw, fx, fy, fw, fh)
            for (yy in 0 until fh) {
                val row = yy * fw
                for (xx in 0 until fw) {
                    val a = (px[row + xx] ushr 24) and 0xFF
                    if (a > 16) {
                        if (xx < minX) minX = xx
                        if (xx > maxX) maxX = xx
                        if (yy < minY) minY = yy
                        if (yy > maxY) maxY = yy
                    }
                }
            }
        }
        if (maxX < minX || maxY < minY) return Rect(0, 0, fw, fh)
        return Rect(minX, minY, maxX + 1, maxY + 1)
    }
}
