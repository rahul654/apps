package com.demo.tambola

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.abs

/** Numbers on a full ticket. Fewer after the first pass triggers the second pass. */
private const val FULL_TICKET = 15

/** What a scan found: the numbers by row, plus the words ML Kit returned, for checking misreads. */
data class ScanResult(val rows: List<List<Int>>, val raw: List<String>)

/** Reads a ticket photo on the device (ML Kit, bundled model) into its numbers, grouped into rows. */
class TicketScanner {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    suspend fun scan(photo: File): ScanResult {
        val bitmap = withContext(Dispatchers.IO) { loadPhoto(photo, maxSide = 2048) }
        val raw = mutableListOf<String>()
        val (firstPass, words) = read(bitmap, offsetY = 0f, scale = 1f)
        raw += "Photo: ${words.joinToString(" ")}"
        var found = firstPass

        if (found.distinctBy { it.value }.size < FULL_TICKET) {
            // Second pass: each row's strip across the full width, enlarged 2×. Adds only numbers
            // not already read, at places where nothing was read.
            val height = medianHeight(found)
            splitRows(found).forEachIndexed { i, row ->
                val top = (row.minOf { it.y } - height).toInt().coerceAtLeast(0)
                val bottom = (row.maxOf { it.y } + height).toInt().coerceAtMost(bitmap.height)
                if (bottom - top < 8) return@forEachIndexed
                val strip = Bitmap.createBitmap(bitmap, 0, top, bitmap.width, bottom - top)
                val big = Bitmap.createScaledBitmap(strip, strip.width * 2, strip.height * 2, true)
                val (more, rowWords) = read(big, offsetY = top.toFloat(), scale = 0.5f)
                raw += "Row ${i + 1} again: ${rowWords.joinToString(" ")}"
                found = found + more.filter { m ->
                    found.none { it.value == m.value || (abs(it.x - m.x) < height && abs(it.y - m.y) < height) }
                }
            }
        }
        return ScanResult(groupIntoRows(found), raw)
    }

    /** Recognises [bitmap] and maps positions back to the photo: photo = bitmap · [scale], shifted down by [offsetY]. */
    private suspend fun read(bitmap: Bitmap, offsetY: Float, scale: Float): Pair<List<Found>, List<String>> {
        val text = recognizer.process(InputImage.fromBitmap(bitmap, 0)).await()
        val words = text.textBlocks.flatMap { it.lines }.flatMap { it.elements }
        val found = words.flatMap { word ->
            val box = word.boundingBox ?: return@flatMap emptyList()
            val values = numbersIn(word.text)
            // Numbers split out of one word share its box; spread them across it, left to right.
            values.mapIndexed { i, v ->
                Found(
                    value = v,
                    x = (box.left + box.width() * (i + 0.5f) / values.size) * scale,
                    y = box.exactCenterY() * scale + offsetY,
                    height = box.height() * scale,
                )
            }
        }
        return found to words.map { it.text }
    }
}

/** A number read from the photo, with its centre and the height of the word it was in. */
data class Found(val value: Int, val x: Float, val y: Float, val height: Float)

/**
 * The numbers 1–90 in one recognised word. Grid lines and stray marks split words; I/l at either
 * end of a part are grid lines and are dropped, inside it they're a 1, and O/o is a 0. Four digits
 * are two neighbouring cells read as one word ("6175" → 61, 75). Other lengths (serials, years) are dropped.
 */
fun numbersIn(word: String): List<Int> =
    word.split(Regex("[^0-9OoIl]+")).flatMap { part ->
        val core = part.trim('I', 'l')
        if (core.none { it.isDigit() }) return@flatMap emptyList()
        val digits = core.map { c -> if (c == 'O' || c == 'o') '0' else if (c == 'I' || c == 'l') '1' else c }.joinToString("")
        when (digits.length) {
            1, 2 -> listOfNotNull(digits.toInt().takeIf { it in 1..90 })
            4 -> listOf(digits.take(2).toInt(), digits.drop(2).toInt()).takeIf { pair -> pair.all { it in 1..90 } }.orEmpty()
            else -> emptyList()
        }
    }

/** Numbers grouped into rows (top to bottom), each row read left to right; a number seen twice is kept once. */
fun groupIntoRows(found: List<Found>): List<List<Int>> {
    val seen = HashSet<Int>()
    return splitRows(found).map { row -> row.sortedBy { it.x }.map { it.value }.filter { seen.add(it) } }.filter { it.isNotEmpty() }
}

/**
 * Splits numbers into rows by vertical position: a gap of more than ~0.6 of a text height starts a new
 * row. A ticket has 3 rows, so with more groups the 3 largest are kept (stray marks above or below
 * a ticket form small groups).
 */
private fun splitRows(found: List<Found>): List<List<Found>> {
    if (found.isEmpty()) return emptyList()
    val sorted = found.sortedBy { it.y }
    val textHeight = medianHeight(found)
    val groups = mutableListOf(mutableListOf(sorted.first()))
    for (f in sorted.drop(1)) {
        if (f.y - groups.last().last().y > textHeight * 0.6f) groups += mutableListOf(f) else groups.last() += f
    }
    return if (groups.size > 3) groups.sortedByDescending { it.size }.take(3).sortedBy { it.first().y } else groups
}

private fun medianHeight(found: List<Found>): Float =
    if (found.isEmpty()) 1f else found.map { it.height }.sorted()[found.size / 2].coerceAtLeast(1f)

/** Decodes a photo upright (EXIF applied), scaled so its longest side is at most [maxSide]. */
fun loadPhoto(file: File, maxSide: Int): Bitmap =
    ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val longest = maxOf(info.size.width, info.size.height)
        if (longest > maxSide) {
            val scale = maxSide.toFloat() / longest
            decoder.setTargetSize(
                (info.size.width * scale).toInt().coerceAtLeast(1),
                (info.size.height * scale).toInt().coerceAtLeast(1),
            )
        }
    }

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
}
