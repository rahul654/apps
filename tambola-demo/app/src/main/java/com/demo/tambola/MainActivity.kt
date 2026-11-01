package com.demo.tambola

import android.media.AudioManager
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.roundToInt
import android.graphics.Color as AndroidColor

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val darkBars = SystemBarStyle.dark(AndroidColor.TRANSPARENT)
        val lightBars = SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
        enableEdgeToEdge(darkBars, darkBars)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // The phone's volume buttons change media volume (the voice), even between calls.
        volumeControlStream = AudioManager.STREAM_MUSIC
        setContent {
            TambolaApp(onAdminShown = { admin ->
                val bars = if (admin) lightBars else darkBars
                enableEdgeToEdge(bars, bars)
            })
        }
    }
}

private object Festive {
    val background = Brush.verticalGradient(listOf(Color(0xFF4A148C), Color(0xFF880E4F), Color(0xFFE65100)))
    val ball = Brush.radialGradient(listOf(Color(0xFFFFF59D), Color(0xFFFFB300), Color(0xFFF57C00)))
    val ink = Color(0xFF4A148C)
    val accent = Color(0xFFF57C00)

    /** Fill colour for called numbers, one per tens row of the board. */
    val rows = listOf(
        Color(0xFFFFD54F), Color(0xFFF48FB1), Color(0xFF80DEEA),
        Color(0xFFDCE775), Color(0xFFFFAB91), Color(0xFFCE93D8),
        Color(0xFFA5D6A7), Color(0xFF90CAF9), Color(0xFFFFF176),
    )

    fun colorOf(n: Int) = rows[((n - 1) / 10).coerceIn(0, 8)]
}

@Composable
private fun TambolaApp(onAdminShown: (Boolean) -> Unit, caller: Caller = viewModel()) {
    var admin by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(admin) { onAdminShown(admin) }
    // Leaving the app (home, another app, screen lock) pauses calling.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { caller.pause() }

    MaterialTheme(colorScheme = lightColorScheme(primary = Festive.ink, secondary = Festive.accent)) {
        if (admin) {
            BackHandler { admin = false }
            AdminPanel(caller, onBack = { admin = false })
        } else {
            GameScreen(caller, onSecretTaps = {
                caller.pause()
                admin = true
            })
        }
    }
}

// Game screen

@Composable
private fun GameScreen(caller: Caller, onSecretTaps: () -> Unit) {
    val game = caller.game
    val calls = game?.let { it.sequence.take(it.called) }.orEmpty()
    val current = calls.lastOrNull()
    val nextGame = caller.settings.nextGame
    var confirmNew by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize().background(Festive.background)) {
        Column(
            Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                SecretTitle(onSecretTaps)
                Spacer(Modifier.weight(1f))
                if (game != null) {
                    Text("Game ${game.number}", color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                val ballSize = minOf(maxHeight - 40.dp, maxWidth * 0.55f, 200.dp).coerceAtLeast(56.dp)
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Ball(current, ballSize)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when {
                            game == null -> "Ready"
                            caller.isOver -> "Game over"
                            else -> "Call ${game.called} / 90"
                        },
                        color = Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
            }

            LastCalls(calls.dropLast(1).takeLast(5).reversed())
            Spacer(Modifier.height(10.dp))
            Board(calls.toSet(), current)
            Spacer(Modifier.height(14.dp))
            SpeedToggle(caller.speed, caller::selectSpeed)
            Spacer(Modifier.height(6.dp))
            LoudnessSlider(caller.loudness, caller::changeLoudness, onDone = caller::sampleVoice)
            Spacer(Modifier.height(6.dp))

            if (game == null || caller.isOver) {
                PillButton("Start game $nextGame", filled = true) { caller.startGame() }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    PillButton(if (caller.running) "Pause" else "Resume", filled = true) {
                        if (caller.running) caller.pause() else caller.resume()
                    }
                    PillButton("New game", filled = false) { confirmNew = true }
                }
            }
        }
    }

    if (confirmNew && game != null) {
        AlertDialog(
            onDismissRequest = { confirmNew = false },
            title = { Text("End game ${game.number}?") },
            text = { Text("Game $nextGame starts straight away.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmNew = false
                    caller.startGame()
                }) { Text("Start game $nextGame") }
            },
            dismissButton = { TextButton(onClick = { confirmNew = false }) { Text("Cancel") } },
        )
    }
}

/** The "Tambola" title. Four taps within 2 seconds opens the panel; there is no ripple or other feedback. */
@Composable
private fun SecretTitle(onOpen: () -> Unit) {
    val open by rememberUpdatedState(onOpen)
    val taps = remember { ArrayDeque<Long>() }
    Text(
        "Tambola",
        color = Color.White,
        fontSize = 26.sp,
        fontWeight = FontWeight.ExtraBold,
        modifier = Modifier.pointerInput(Unit) {
            detectTapGestures {
                val now = SystemClock.uptimeMillis()
                taps.addLast(now)
                while (now - taps.first() > 2000) taps.removeFirst()
                if (taps.size >= 4) {
                    taps.clear()
                    open()
                }
            }
        },
    )
}

@Composable
private fun Ball(number: Int?, size: Dp) {
    val scale = remember { Animatable(1f) }
    LaunchedEffect(number) {
        if (number != null) {
            scale.snapTo(0.6f)
            scale.animateTo(1f, spring(dampingRatio = 0.45f, stiffness = 300f))
        }
    }
    val fontSize = with(LocalDensity.current) { (size * 0.36f).toSp() }
    Box(
        Modifier
            .size(size)
            .graphicsLayer {
                scaleX = scale.value
                scaleY = scale.value
            }
            .shadow(12.dp, CircleShape)
            .background(Festive.ball, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.fillMaxSize(0.72f).background(Color.White, CircleShape), contentAlignment = Alignment.Center) {
            Text(number?.toString() ?: "–", fontSize = fontSize, fontWeight = FontWeight.Black, color = Festive.ink)
        }
    }
}

@Composable
private fun LastCalls(numbers: List<Int>) {
    Row(Modifier.height(36.dp), verticalAlignment = Alignment.CenterVertically) {
        if (numbers.isNotEmpty()) {
            Text("Last:", color = Color.White.copy(alpha = 0.85f), fontSize = 15.sp)
            for (n in numbers) {
                Spacer(Modifier.width(8.dp))
                Box(Modifier.size(34.dp).background(Festive.colorOf(n), CircleShape), contentAlignment = Alignment.Center) {
                    Text("$n", color = Festive.ink, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun Board(called: Set<Int>, current: Int?) {
    val cell = RoundedCornerShape(6.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.Black.copy(alpha = 0.18f), RoundedCornerShape(12.dp))
            .padding(4.dp),
    ) {
        for (row in 0 until 9) {
            Row {
                for (col in 1..10) {
                    val n = row * 10 + col
                    val on = n in called
                    Box(
                        Modifier
                            .weight(1f)
                            .aspectRatio(1.25f)
                            .padding(1.5.dp)
                            .background(if (on) Festive.rows[row] else Color.White.copy(alpha = 0.10f), cell)
                            .then(if (n == current) Modifier.border(2.dp, Color.White, cell) else Modifier),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "$n",
                            fontSize = 13.sp,
                            fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                            color = if (on) Festive.ink else Color.White.copy(alpha = 0.75f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SpeedToggle(selected: Speed, onSelect: (Speed) -> Unit) {
    Row(Modifier.background(Color.White.copy(alpha = 0.15f), CircleShape).padding(4.dp)) {
        for (s in Speed.entries) {
            val on = s == selected
            Text(
                s.name,
                color = if (on) Festive.ink else Color.White,
                fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                fontSize = 15.sp,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (on) Color.White else Color.Transparent)
                    .clickable { onSelect(s) }
                    .padding(horizontal = 22.dp, vertical = 9.dp),
            )
        }
    }
}

/** Voice loudness, 50–200% in steps of 10. Letting go says a sample number when calling is paused. */
@Composable
private fun LoudnessSlider(value: Float, onChange: (Float) -> Unit, onDone: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("Voice", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        Slider(
            value = value,
            onValueChange = onChange,
            onValueChangeFinished = onDone,
            valueRange = MIN_LOUDNESS..MAX_LOUDNESS,
            steps = 14,
            colors = SliderDefaults.colors(
                thumbColor = Color.White,
                activeTrackColor = Color.White,
                inactiveTrackColor = Color.White.copy(alpha = 0.3f),
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent,
            ),
            modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
        )
        Text(
            "${(value * 100).roundToInt()}%",
            color = Color.White,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.width(48.dp),
        )
    }
}

@Composable
private fun PillButton(label: String, filled: Boolean, onClick: () -> Unit) {
    if (filled) {
        Button(
            onClick = onClick,
            colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Festive.ink),
            contentPadding = PaddingValues(horizontal = 28.dp, vertical = 14.dp),
        ) { Text(label, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
    } else {
        OutlinedButton(
            onClick = onClick,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
            border = BorderStroke(1.5.dp, Color.White),
            contentPadding = PaddingValues(horizontal = 28.dp, vertical = 14.dp),
        ) { Text(label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) }
    }
}

// Hidden panel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AdminPanel(caller: Caller, onBack: () -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Admin") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Tickets") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Settings") })
            }
            if (tab == 0) TicketsTab(caller) else SettingsTab(caller)
        }
    }
}

@Composable
private fun TicketsTab(caller: Caller) {
    val tickets = caller.tickets
    var confirmDeleteAll by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { caller.addTickets(it) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${tickets.size} loaded", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            Button(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                Text("+ Add photos")
            }
        }
        if (tickets.isEmpty()) {
            Text(
                "Add photos of tickets, one ticket per photo. Each photo is read on this phone as soon as it's added.",
                Modifier.padding(horizontal = 16.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            itemsIndexed(tickets, key = { _, t -> t.id }) { i, t ->
                TicketRow(
                    n = i + 1,
                    ticket = t,
                    photo = caller.photoFile(t),
                    onRescan = { caller.rescanTicket(t.id) },
                    onDelete = { caller.deleteTicket(t.id) },
                )
            }
            if (tickets.isNotEmpty()) {
                item {
                    OutlinedButton(onClick = { confirmDeleteAll = true }, Modifier.padding(top = 8.dp)) {
                        Text("Delete all tickets")
                    }
                }
            }
        }
    }

    if (confirmDeleteAll) {
        AlertDialog(
            onDismissRequest = { confirmDeleteAll = false },
            title = { Text("Delete all ${tickets.size} tickets?") },
            text = { Text("Their photos and numbers are removed from this phone.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDeleteAll = false
                    caller.deleteAllTickets()
                }) { Text("Delete all") }
            },
            dismissButton = { TextButton(onClick = { confirmDeleteAll = false }) { Text("Cancel") } },
        )
    }
}

/** One ticket. Tapping it shows the words the scan read, to see why a number was missed. */
@Composable
private fun TicketRow(n: Int, ticket: Ticket, photo: File, onRescan: () -> Unit, onDelete: () -> Unit) {
    var showRaw by rememberSaveable(ticket.id) { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.Top) {
        Thumbnail(photo, Modifier.size(72.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f).clickable { showRaw = !showRaw }) {
            Text("Ticket $n", style = MaterialTheme.typography.titleSmall)
            if (ticket.scanning || ticket.rows == null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(6.dp))
                    Text("Scanning…", style = MaterialTheme.typography.bodyMedium)
                }
            } else if (ticket.count == 0) {
                Text("No numbers found", style = MaterialTheme.typography.bodyMedium)
            } else {
                Text("${ticket.count} numbers read", style = MaterialTheme.typography.bodyMedium)
                Text(
                    ticket.rows.orEmpty().joinToString("  ·  ") { it.joinToString(" ") },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (showRaw && !ticket.scanning) {
                Text(
                    if (ticket.raw.isEmpty()) "No scan details. Tap rescan to read it again." else ticket.raw.joinToString("\n"),
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
        IconButton(onClick = onRescan, enabled = !ticket.scanning) {
            Icon(Icons.Default.Refresh, contentDescription = "Rescan ticket $n")
        }
        IconButton(onClick = onDelete) { Icon(Icons.Default.Delete, contentDescription = "Delete ticket $n") }
    }
}

@Composable
private fun Thumbnail(file: File, modifier: Modifier) {
    val image by produceState<ImageBitmap?>(null, file) {
        value = withContext(Dispatchers.IO) { runCatching { loadPhoto(file, maxSide = 256).asImageBitmap() }.getOrNull() }
    }
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
        image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
    }
}

@Composable
private fun SettingsTab(caller: Caller) {
    val s = caller.settings
    val games = caller.ticketGames()
    val ticketCount = caller.tickets.size

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Changes apply from the next game.", color = MaterialTheme.colorScheme.onSurfaceVariant)

        SectionTitle("Ticket games")
        ModeOption("Every Nth game", selected = !s.useList) { caller.updateSettings { it.copy(useList = false) } }
        if (!s.useList) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CheckedField("Start at game", s.start.toString(), ::wholeNumberProblem, Modifier.weight(1f)) { v ->
                    caller.updateSettings { it.copy(start = v.trim().toInt()) }
                }
                CheckedField("Then every", s.gap.toString(), ::wholeNumberProblem, Modifier.weight(1f)) { v ->
                    caller.updateSettings { it.copy(gap = v.trim().toInt()) }
                }
            }
        }
        ModeOption("Custom list", selected = s.useList) { caller.updateSettings { it.copy(useList = true) } }
        if (s.useList) {
            CheckedField(
                "Games, e.g. 1, 3, 4, 7, 9",
                s.gameList.joinToString(", "),
                ::gameListProblem,
                Modifier.fillMaxWidth(),
                keyboard = KeyboardType.Text,
            ) { v -> caller.updateSettings { it.copy(gameList = CallSequence.parseGameList(v).orEmpty()) } }
        }
        Text(
            when {
                ticketCount == 0 -> "→ No tickets loaded, so every game is random"
                s.useList && s.gameList.isEmpty() -> "→ No games listed, so every game is random"
                games.size <= 8 -> "→ Games ${games.joinToString(", ")}, then random"
                else -> "→ Games ${games.take(8).joinToString(", ")} … ${games.last()}, then random"
            },
            fontWeight = FontWeight.Medium,
        )
        if (s.useList && s.gameList.isNotEmpty() && ticketCount > s.gameList.size) {
            val unused = ticketCount - s.gameList.size
            Text(
                "$unused ${if (unused == 1) "ticket isn't" else "tickets aren't"} used: the list has ${s.gameList.size} games.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        HorizontalDivider(Modifier.padding(vertical = 6.dp))
        SectionTitle("Ticket finish")
        CheckedField("Done within first N calls", s.finishBy.toString(), ::finishByProblem, Modifier.fillMaxWidth()) { v ->
            caller.updateSettings { it.copy(finishBy = v.trim().toInt()) }
        }
        Text(
            "→ Last ticket number at a random call from ${s.finishBy - CallSequence.FINISH_SPREAD} to ${s.finishBy}",
            fontWeight = FontWeight.Medium,
        )

        HorizontalDivider(Modifier.padding(vertical = 6.dp))
        SectionTitle("Speed (seconds between calls)")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CheckedField("Slow", s.slow.toString(), ::secondsProblem, Modifier.weight(1f), keyboard = KeyboardType.Decimal) { v ->
                caller.updateSettings { it.copy(slow = v.trim().toFloat()) }
            }
            CheckedField("Medium", s.medium.toString(), ::secondsProblem, Modifier.weight(1f), keyboard = KeyboardType.Decimal) { v ->
                caller.updateSettings { it.copy(medium = v.trim().toFloat()) }
            }
            CheckedField("Fast", s.fast.toString(), ::secondsProblem, Modifier.weight(1f), keyboard = KeyboardType.Decimal) { v ->
                caller.updateSettings { it.copy(fast = v.trim().toFloat()) }
            }
        }

        HorizontalDivider(Modifier.padding(vertical = 6.dp))
        SectionTitle("Game counter")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Next game: ${s.nextGame}", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            OutlinedButton(onClick = { caller.updateSettings { it.copy(nextGame = 1) } }, enabled = s.nextGame != 1) {
                Text("Reset to 1")
            }
        }
    }
}

@Composable
private fun ModeOption(label: String, selected: Boolean, onSelect: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().selectable(selected = selected, onClick = onSelect, role = Role.RadioButton),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
}

/** A text box that keeps what's typed, shows why it's invalid, and passes on only valid values. */
@Composable
private fun CheckedField(
    label: String,
    initial: String,
    problem: (String) -> String?,
    modifier: Modifier = Modifier,
    keyboard: KeyboardType = KeyboardType.Number,
    onValid: (String) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf(initial) }
    val error = problem(text)
    OutlinedTextField(
        value = text,
        onValueChange = {
            text = it
            if (problem(it) == null) onValid(it)
        },
        label = { Text(label) },
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = modifier,
    )
}

private fun wholeNumberProblem(text: String): String? {
    val v = text.trim().toIntOrNull() ?: return "Whole number"
    return if (v in 1..9999) null else "1 or more"
}

private fun finishByProblem(text: String): String? {
    val range = CallSequence.FINISH_BY_RANGE
    val v = text.trim().toIntOrNull() ?: return "Whole number"
    return if (v in range) null else "${range.first} to ${range.last}"
}

private fun gameListProblem(text: String): String? =
    if (CallSequence.parseGameList(text) == null) "Game numbers 1 or more, separated by commas" else null

private fun secondsProblem(text: String): String? {
    val v = text.trim().toFloatOrNull() ?: return "Seconds"
    return when {
        v < MIN_SECONDS -> "Min $MIN_SECONDS"
        v > 60f -> "Max 60"
        else -> null
    }
}
