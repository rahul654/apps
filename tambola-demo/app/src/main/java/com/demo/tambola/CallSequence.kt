package com.demo.tambola

import kotlin.random.Random

/** Builds the order in which a game calls 1–90, and decides which games use a ticket. */
object CallSequence {
    /** Default for "done within the first N calls". */
    const val DEFAULT_FINISH_BY = 55

    /** The ticket's last number lands on a random call from N − [FINISH_SPREAD] to N (1-based). */
    const val FINISH_SPREAD = 10

    /** Allowed N: the earliest finish (N − spread) still leaves room for a full ticket. */
    val FINISH_BY_RANGE = 25..90

    fun random(rng: Random = Random.Default): List<Int> = (1..90).shuffled(rng)

    /**
     * A ticket game: the ticket's numbers take turns between its rows and are all called within the
     * first [finishBy] calls, mixed in with other numbers; the last one lands on a random call from
     * finishBy − [FINISH_SPREAD] to finishBy. The rest follow at random. Out-of-range and repeated
     * numbers are ignored; a ticket with no usable numbers gives a random game.
     */
    fun forTicket(rows: List<List<Int>>, finishBy: Int = DEFAULT_FINISH_BY, rng: Random = Random.Default): List<Int> {
        val onTicket = HashSet<Int>()
        val cleanRows = rows
            .map { row -> row.filter { it in 1..90 && onTicket.add(it) }.shuffled(rng) }
            .filter { it.isNotEmpty() }
        val ticket = interleave(cleanRows)
        if (ticket.isEmpty()) return random(rng)

        // Positions are 0-based: the last ticket number goes at finish - 1, the others at
        // random earlier positions, in interleaved order.
        val last = finishBy.coerceIn(FINISH_BY_RANGE)
        val finish = rng.nextInt(last - FINISH_SPREAD, last + 1).coerceAtLeast(ticket.size)
        val slots = (0 until finish - 1).shuffled(rng).take(ticket.size - 1).sorted() + (finish - 1)

        val order = IntArray(90)
        slots.forEachIndexed { i, slot -> order[slot] = ticket[i] }
        val others = (1..90).filter { it !in onTicket }.shuffled(rng).iterator()
        for (i in order.indices) if (order[i] == 0) order[i] = others.next()
        return order.toList()
    }

    /** Row 1, row 2, row 3, row 1, … skipping a row once it runs out. */
    fun interleave(rows: List<List<Int>>): List<Int> {
        val out = mutableListOf<Int>()
        var i = 0
        while (rows.any { i < it.size }) {
            for (row in rows) if (i < row.size) out += row[i]
            i++
        }
        return out
    }

    /**
     * The ticket (index in upload order) that game [game] uses, or null for a random game.
     * Games start, start + gap, start + 2·gap, … use tickets 0, 1, 2, …; once tickets run out, games are random.
     */
    fun ticketIndexFor(game: Int, start: Int, gap: Int, ticketCount: Int): Int? {
        if (ticketCount <= 0 || gap < 1 || game < start || (game - start) % gap != 0) return null
        return ((game - start) / gap).takeIf { it < ticketCount }
    }

    /** Every game that will use a ticket, in order. */
    fun ticketGames(start: Int, gap: Int, ticketCount: Int): List<Int> =
        if (gap < 1) emptyList() else List(ticketCount) { start + it * gap }

    /**
     * Custom list: the k-th game in [games] (sorted) uses ticket k. Games not listed, and listed
     * games beyond the number of tickets, are random.
     */
    fun ticketIndexInList(game: Int, games: List<Int>, ticketCount: Int): Int? =
        games.indexOf(game).takeIf { it in 0 until ticketCount }

    /**
     * Game numbers typed as "1, 3, 4, 7, 9" (commas and/or spaces), sorted with repeats removed.
     * Null if anything isn't a whole number from 1 to 9999.
     */
    fun parseGameList(text: String): List<Int>? {
        val parts = text.split(Regex("[,\\s]+")).filter { it.isNotEmpty() }
        val games = parts.map { part -> part.toIntOrNull()?.takeIf { it in 1..9999 } ?: return null }
        return games.distinct().sorted()
    }
}
