package com.demo.tambola

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Shortest allowed gap between calls, in seconds. */
const val MIN_SECONDS = 0.8f

/** Voice loudness range: below 1 lowers the voice, above 1 boosts it past the media volume. */
const val MIN_LOUDNESS = 0.5f
const val MAX_LOUDNESS = 2f

data class Settings(
    /** Ticket games from [gameList] instead of [start] + every [gap]. */
    val useList: Boolean = false,
    val start: Int = 1,
    val gap: Int = 2,
    /** Sorted, no repeats. */
    val gameList: List<Int> = emptyList(),
    /** A ticket game calls all the ticket's numbers within this many calls. */
    val finishBy: Int = CallSequence.DEFAULT_FINISH_BY,
    val slow: Float = 6f,
    val medium: Float = 3f,
    val fast: Float = 1f,
    val nextGame: Int = 1,
)

/** One uploaded ticket. [rows] is null until the photo has been scanned; [raw] is what the scan read. */
data class Ticket(
    val id: String,
    val file: String,
    val rows: List<List<Int>>?,
    val raw: List<String> = emptyList(),
    val scanning: Boolean = false,
) {
    val count get() = rows?.sumOf { it.size } ?: 0
}

/** The game in progress: its call order, how many numbers are called, and the speeds it started with. */
data class Game(val number: Int, val sequence: List<Int>, val called: Int, val seconds: List<Float>)

/** Keeps tickets, settings and the game in progress in SharedPreferences, and ticket photos in app storage. */
class Store(private val context: Context) {
    private val prefs = context.getSharedPreferences("tambola", Context.MODE_PRIVATE)
    private val photos = File(context.filesDir, "tickets")

    fun loadSettings(): Settings {
        val d = Settings()
        return Settings(
            useList = prefs.getBoolean("useList", d.useList),
            start = prefs.getInt("start", d.start),
            gap = prefs.getInt("gap", d.gap),
            gameList = CallSequence.parseGameList(prefs.getString("gameList", "").orEmpty()) ?: d.gameList,
            finishBy = prefs.getInt("finishBy", d.finishBy),
            slow = prefs.getFloat("slow", d.slow),
            medium = prefs.getFloat("medium", d.medium),
            fast = prefs.getFloat("fast", d.fast),
            nextGame = prefs.getInt("nextGame", d.nextGame),
        )
    }

    fun saveSettings(s: Settings) {
        prefs.edit()
            .putBoolean("useList", s.useList)
            .putInt("start", s.start)
            .putInt("gap", s.gap)
            .putString("gameList", s.gameList.joinToString(","))
            .putInt("finishBy", s.finishBy)
            .putFloat("slow", s.slow)
            .putFloat("medium", s.medium)
            .putFloat("fast", s.fast)
            .putInt("nextGame", s.nextGame)
            .apply()
    }

    /** Voice loudness, 0.5–2.0 (1.0 = the phone's media volume). Applies straight away, not per game. */
    fun loadLoudness(): Float = prefs.getFloat("loudness", 1f).coerceIn(MIN_LOUDNESS, MAX_LOUDNESS)

    fun saveLoudness(loudness: Float) {
        prefs.edit().putFloat("loudness", loudness).apply()
    }

    fun loadSpeed(): Speed = Speed.entries.getOrNull(prefs.getInt("speed", Speed.Medium.ordinal)) ?: Speed.Medium

    fun saveSpeed(speed: Speed) {
        prefs.edit().putInt("speed", speed.ordinal).apply()
    }

    fun loadGame(): Game? {
        val sequence = prefs.getString("game.sequence", null)?.split(',')?.mapNotNull { it.toIntOrNull() }
        if (sequence == null || sequence.sorted() != (1..90).toList()) return null
        val seconds = prefs.getString("game.seconds", null)?.split(',')?.mapNotNull { it.toFloatOrNull() }
            ?.takeIf { it.size == 3 }
            ?: Settings().let { listOf(it.slow, it.medium, it.fast) }
        return Game(
            number = prefs.getInt("game.number", 1),
            sequence = sequence,
            called = prefs.getInt("game.called", 0).coerceIn(0, 90),
            seconds = seconds,
        )
    }

    fun saveGame(game: Game?) {
        val edit = prefs.edit()
        if (game == null) {
            edit.remove("game.number").remove("game.sequence").remove("game.called").remove("game.seconds")
        } else {
            edit.putInt("game.number", game.number)
                .putString("game.sequence", game.sequence.joinToString(","))
                .putInt("game.called", game.called)
                .putString("game.seconds", game.seconds.joinToString(","))
        }
        edit.apply()
    }

    fun loadTickets(): List<Ticket> {
        val json = prefs.getString("tickets", null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(json)
            List(array.length()) { i ->
                val o = array.getJSONObject(i)
                val rows = o.optJSONArray("rows")?.let { r ->
                    List(r.length()) { j -> r.getJSONArray(j).let { row -> List(row.length()) { row.getInt(it) } } }
                }
                val raw = o.optJSONArray("raw")?.let { r -> List(r.length()) { r.getString(it) } }.orEmpty()
                Ticket(o.getString("id"), o.getString("file"), rows, raw)
            }
        }.getOrDefault(emptyList())
    }

    fun saveTickets(tickets: List<Ticket>) {
        val array = JSONArray()
        for (t in tickets) {
            val o = JSONObject().put("id", t.id).put("file", t.file)
            t.rows?.let { rows -> o.put("rows", JSONArray(rows.map { JSONArray(it) })) }
            o.put("raw", JSONArray(t.raw))
            array.put(o)
        }
        prefs.edit().putString("tickets", array.toString()).apply()
    }

    /** Copies a picked photo into app storage, so it survives the original being deleted. */
    fun importPhoto(uri: Uri): Ticket {
        photos.mkdirs()
        val id = UUID.randomUUID().toString()
        val name = "$id.img"
        val input = context.contentResolver.openInputStream(uri) ?: error("Can't open $uri")
        input.use { src -> File(photos, name).outputStream().use { src.copyTo(it) } }
        return Ticket(id, name, rows = null)
    }

    fun photoFile(ticket: Ticket) = File(photos, ticket.file)

    fun deletePhoto(ticket: Ticket) {
        photoFile(ticket).delete()
    }
}
