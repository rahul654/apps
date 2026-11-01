package com.demo.tambola

import android.app.Application
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

enum class Speed { Slow, Medium, Fast }

/**
 * App state: the game in progress with its call timer and voice, plus the hidden panel's tickets
 * and settings. A game takes its call order and speeds when it starts, so panel changes apply
 * from the next game.
 */
class Caller(app: Application) : AndroidViewModel(app) {
    private val store = Store(app)
    private val scanner = TicketScanner()
    private val speaker = Speaker(app)
    private val scanLock = Mutex()
    private var loop: Job? = null

    var settings by mutableStateOf(store.loadSettings())
        private set
    var tickets by mutableStateOf(store.loadTickets())
        private set
    var game by mutableStateOf(store.loadGame())
        private set
    var speed by mutableStateOf(store.loadSpeed())
        private set
    var running by mutableStateOf(false)
        private set
    var loudness by mutableStateOf(store.loadLoudness())
        private set

    val isOver get() = game?.let { it.called >= 90 } ?: false

    init {
        speaker.setLoudness(loudness)
        // Photos whose scan was cut short (app closed) are scanned again.
        tickets.filter { it.rows == null }.forEach { scan(it.id) }
    }

    // Game

    fun startGame() {
        pause()
        val number = settings.nextGame
        val rows = ticketIndexFor(number)?.let { tickets[it].rows }
        val sequence = if (rows != null) CallSequence.forTicket(rows, settings.finishBy) else CallSequence.random()
        val started = Game(number, sequence, called = 0, seconds = listOf(settings.slow, settings.medium, settings.fast))
        game = started
        store.saveGame(started)
        updateSettings { it.copy(nextGame = number + 1) }
        runLoop(callFirst = true)
    }

    fun pause() {
        loop?.cancel()
        loop = null
        running = false
        speaker.stop()
    }

    fun resume() {
        if (game != null && !isOver) runLoop(callFirst = false)
    }

    fun selectSpeed(s: Speed) {
        speed = s
        store.saveSpeed(s)
    }

    fun changeLoudness(value: Float) {
        loudness = value.coerceIn(MIN_LOUDNESS, MAX_LOUDNESS)
        speaker.setLoudness(loudness)
        store.saveLoudness(loudness)
    }

    /** Says a sample number at the current loudness, while calling is paused. */
    fun sampleVoice() {
        if (!running) viewModelScope.launch { speaker.say(42, 1f) }
    }

    private fun secondsNow(): Float =
        (game?.seconds ?: listOf(settings.slow, settings.medium, settings.fast))[speed.ordinal]

    /** Calls a number every [secondsNow] seconds, and never before the previous number has been spoken. */
    private fun runLoop(callFirst: Boolean) {
        loop?.cancel()
        running = true
        loop = viewModelScope.launch {
            var lastCall = if (callFirst) 0L else SystemClock.elapsedRealtime()
            while (isActive) {
                val g = game ?: break
                if (g.called >= 90) break
                // Re-checked while waiting, so a speed change takes effect straight away.
                while (SystemClock.elapsedRealtime() - lastCall < secondsNow() * 1000) delay(50)
                lastCall = SystemClock.elapsedRealtime()
                val next = g.copy(called = g.called + 1)
                game = next
                store.saveGame(next)
                speaker.say(g.sequence[g.called], rateFor(secondsNow()))
            }
            running = false
        }
    }

    /** Normal voice at 1.8 s or slower; faster calls speed it up (1 s → 1.8×, 0.8 s → 2.25×). */
    private fun rateFor(seconds: Float) = (1.8f / seconds).coerceIn(1f, 2.5f)

    // Settings

    fun updateSettings(change: (Settings) -> Settings) {
        settings = change(settings)
        store.saveSettings(settings)
    }

    /** The ticket game [game] uses, from the chosen mode (every Nth game or custom list); null = random. */
    private fun ticketIndexFor(game: Int): Int? =
        if (settings.useList) CallSequence.ticketIndexInList(game, settings.gameList, tickets.size)
        else CallSequence.ticketIndexFor(game, settings.start, settings.gap, tickets.size)

    /** Every game that will use a ticket, in order. */
    fun ticketGames(): List<Int> =
        if (settings.useList) settings.gameList.take(tickets.size)
        else CallSequence.ticketGames(settings.start, settings.gap, tickets.size)

    // Tickets

    fun addTickets(uris: List<Uri>) {
        viewModelScope.launch {
            for (uri in uris) {
                val ticket = withContext(Dispatchers.IO) { runCatching { store.importPhoto(uri) }.getOrNull() } ?: continue
                tickets = tickets + ticket
                store.saveTickets(tickets)
                scan(ticket.id)
            }
        }
    }

    fun deleteTicket(id: String) {
        val ticket = tickets.find { it.id == id } ?: return
        tickets = tickets.filter { it.id != id }
        store.saveTickets(tickets)
        store.deletePhoto(ticket)
    }

    fun deleteAllTickets() {
        val old = tickets
        tickets = emptyList()
        store.saveTickets(tickets)
        old.forEach(store::deletePhoto)
    }

    fun photoFile(ticket: Ticket) = store.photoFile(ticket)

    /** Reads a ticket's photo again, e.g. after the scanner has been improved. */
    fun rescanTicket(id: String) {
        if (tickets.find { it.id == id }?.scanning == false) scan(id)
    }

    /** Scans one ticket at a time (full photos are large). A failed scan counts as 0 numbers read. */
    private fun scan(id: String) {
        changeTicket(id) { it.copy(scanning = true) }
        viewModelScope.launch {
            val result = scanLock.withLock {
                val ticket = tickets.find { it.id == id } ?: return@withLock null
                runCatching { scanner.scan(store.photoFile(ticket)) }
                    .getOrElse { ScanResult(emptyList(), listOf("Scan failed: ${it.message}")) }
            } ?: return@launch
            changeTicket(id) { it.copy(rows = result.rows, raw = result.raw, scanning = false) }
            store.saveTickets(tickets)
        }
    }

    private fun changeTicket(id: String, change: (Ticket) -> Ticket) {
        tickets = tickets.map { if (it.id == id) change(it) else it }
    }

    override fun onCleared() {
        pause()
        speaker.shutdown()
    }
}

/**
 * Android TextToSpeech that says only the number, and lets the caller wait until it has been spoken.
 * The voice plays as media on its own audio session, so a LoudnessEnhancer can boost just the voice.
 */
class Speaker(context: Context) {
    private val pending = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private var nextId = 0
    private val session = context.getSystemService(AudioManager::class.java).generateAudioSessionId()
    private val booster = runCatching { LoudnessEnhancer(session) }.getOrNull()

    @Volatile
    private var volume = 1f

    @Volatile
    private var ready = false
    private lateinit var tts: TextToSpeech

    init {
        tts = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                useEnglish()
                ready = true
            }
        }
        tts.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) = finish(utteranceId)

            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) = finish(utteranceId)
            override fun onError(utteranceId: String?, errorCode: Int) = finish(utteranceId)
            override fun onStop(utteranceId: String?, interrupted: Boolean) = finish(utteranceId)
        })
    }

    /** English, so "42" is read as "forty-two" whatever the phone's language. */
    private fun useEnglish() {
        listOf("en-IN", "en-GB", "en-US").any { tts.setLanguage(Locale.forLanguageTag(it)) >= TextToSpeech.LANG_AVAILABLE }
    }

    /**
     * 0.5–1.0 lowers the voice; above 1.0 boosts it by up to +12 dB at 2.0. Without a booster
     * (some phones) the voice stays at the media volume.
     */
    fun setLoudness(loudness: Float) {
        volume = loudness.coerceAtMost(1f)
        booster?.runCatching {
            if (loudness > 1f) {
                setTargetGain(((loudness - 1f) * 1200).toInt())
                enabled = true
            } else {
                enabled = false
            }
        }
    }

    suspend fun say(number: Int, rate: Float) {
        if (!ready) return
        val id = "call-${nextId++}"
        val done = CompletableDeferred<Unit>()
        pending[id] = done
        try {
            tts.setSpeechRate(rate)
            val params = Bundle().apply {
                putInt(TextToSpeech.Engine.KEY_PARAM_SESSION_ID, session)
                putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume)
            }
            if (tts.speak(number.toString(), TextToSpeech.QUEUE_FLUSH, params, id) == TextToSpeech.SUCCESS) {
                withTimeoutOrNull(4000) { done.await() }
            }
        } finally {
            pending.remove(id)
        }
    }

    private fun finish(id: String?) {
        if (id != null) pending.remove(id)?.complete(Unit)
    }

    fun stop() {
        if (ready) tts.stop()
    }

    fun shutdown() {
        tts.shutdown()
        booster?.release()
    }
}
