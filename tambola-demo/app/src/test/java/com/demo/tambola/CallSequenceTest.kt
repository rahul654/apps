package com.demo.tambola

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class CallSequenceTest {
    private val ticket15 = listOf(
        listOf(4, 12, 23, 51, 68),
        listOf(7, 30, 44, 58, 81),
        listOf(19, 37, 62, 75, 90),
    )
    private val ticket16 = listOf(
        listOf(1, 15, 22, 39, 47, 88),
        listOf(5, 28, 50, 66, 73),
        listOf(9, 34, 59, 70, 84),
    )
    private val ticket14 = listOf(
        listOf(3, 20, 41, 63),
        listOf(11, 26, 49, 72, 85),
        listOf(16, 38, 55, 77, 89),
    )

    private fun assertAllNinetyOnce(order: List<Int>) {
        assertEquals(90, order.size)
        assertEquals((1..90).toList(), order.sorted())
    }

    @Test
    fun randomGameCallsEveryNumberOnce() {
        repeat(50) { assertAllNinetyOnce(CallSequence.random(Random(it))) }
    }

    @Test
    fun ticketGameCallsEveryNumberOnce() {
        for (ticket in listOf(ticket14, ticket15, ticket16)) {
            repeat(200) { assertAllNinetyOnce(CallSequence.forTicket(ticket, rng = Random(it))) }
        }
    }

    @Test
    fun ticketFinishesBetweenCalls45And55() {
        val finishes = mutableSetOf<Int>()
        for (ticket in listOf(ticket14, ticket15, ticket16)) {
            val numbers = ticket.flatten().toSet()
            repeat(500) { seed ->
                val order = CallSequence.forTicket(ticket, rng = Random(seed))
                val finishCall = order.indexOfLast { it in numbers } + 1
                assertTrue("finished at call $finishCall", finishCall in 45..55)
                assertEquals(numbers, order.take(finishCall).filter { it in numbers }.toSet())
                finishes += finishCall
            }
        }
        // The finish call varies from game to game and covers the whole range.
        assertEquals((45..55).toSet(), finishes)
    }

    @Test
    fun finishCallFollowsTheSetting() {
        for (finishBy in listOf(25, 50, 60, 90)) {
            val finishes = mutableSetOf<Int>()
            for (ticket in listOf(ticket14, ticket15, ticket16)) {
                val numbers = ticket.flatten().toSet()
                repeat(300) { seed ->
                    val order = CallSequence.forTicket(ticket, finishBy, Random(seed))
                    assertAllNinetyOnce(order)
                    finishes += order.indexOfLast { it in numbers } + 1
                }
            }
            assertEquals("finishBy=$finishBy", (finishBy - 10..finishBy).toSet(), finishes)
        }
    }

    @Test
    fun finishSettingOutsideTheAllowedRangeIsClamped() {
        val numbers = ticket15.flatten().toSet()
        repeat(100) { seed ->
            val low = CallSequence.forTicket(ticket15, finishBy = 5, rng = Random(seed))
            assertTrue(low.indexOfLast { it in numbers } + 1 in 15..25)
            val high = CallSequence.forTicket(ticket15, finishBy = 200, rng = Random(seed))
            assertTrue(high.indexOfLast { it in numbers } + 1 in 80..90)
        }
    }

    @Test
    fun ticketNumbersAlternateBetweenRows() {
        for (ticket in listOf(ticket14, ticket15, ticket16)) {
            val rowOf = ticket.flatMapIndexed { r, row -> row.map { it to r } }.toMap()
            val expected = CallSequence.interleave(ticket.mapIndexed { r, row -> row.map { r } })
            repeat(100) { seed ->
                val rowsCalled = CallSequence.forTicket(ticket, rng = Random(seed)).mapNotNull { rowOf[it] }
                assertEquals(expected, rowsCalled)
            }
        }
    }

    @Test
    fun ticketGameIsMixedNotFrontLoaded() {
        val numbers = ticket15.flatten().toSet()
        repeat(100) { seed ->
            val firstFifteen = CallSequence.forTicket(ticket15, rng = Random(seed)).take(15)
            assertNotEquals(numbers, firstFifteen.toSet())
        }
    }

    @Test
    fun interleaveSkipsRowsThatRunOut() {
        assertEquals(
            listOf(1, 10, 20, 2, 11, 21, 3, 22),
            CallSequence.interleave(listOf(listOf(1, 2, 3), listOf(10, 11), listOf(20, 21, 22))),
        )
    }

    @Test
    fun badScanNumbersAreIgnored() {
        val scanned = listOf(listOf(0, 4, 4, 12, 95), listOf(12, 30), emptyList())
        repeat(50) { seed ->
            val order = CallSequence.forTicket(scanned, rng = Random(seed))
            assertAllNinetyOnce(order)
            val finishCall = order.indexOfLast { it in setOf(4, 12, 30) } + 1
            assertTrue(finishCall in 45..55)
        }
    }

    @Test
    fun ticketWithNoNumbersGivesRandomGame() {
        assertAllNinetyOnce(CallSequence.forTicket(emptyList(), rng = Random(1)))
        assertAllNinetyOnce(CallSequence.forTicket(listOf(listOf(0, 91)), rng = Random(1)))
    }

    @Test
    fun defaultPatternUsesOddGamesInUploadOrder() {
        val picks = (1..12).map { CallSequence.ticketIndexFor(it, start = 1, gap = 2, ticketCount = 5) }
        assertEquals(listOf(0, null, 1, null, 2, null, 3, null, 4, null, null, null), picks)
        assertEquals(listOf(1, 3, 5, 7, 9), CallSequence.ticketGames(1, 2, 5))
    }

    @Test
    fun gamesOutsideThePatternOrBeforeStartAreRandom() {
        assertNull(CallSequence.ticketIndexFor(2, start = 3, gap = 3, ticketCount = 4))
        assertEquals(0, CallSequence.ticketIndexFor(3, start = 3, gap = 3, ticketCount = 4))
        assertNull(CallSequence.ticketIndexFor(4, start = 3, gap = 3, ticketCount = 4))
        assertEquals(1, CallSequence.ticketIndexFor(6, start = 3, gap = 3, ticketCount = 4))
        assertEquals(listOf(3, 6, 9, 12), CallSequence.ticketGames(3, 3, 4))
    }

    @Test
    fun usedUpTicketsDoNotCycleBack() {
        assertEquals(1, CallSequence.ticketIndexFor(2, start = 1, gap = 1, ticketCount = 2))
        assertNull(CallSequence.ticketIndexFor(3, start = 1, gap = 1, ticketCount = 2))
        assertNull(CallSequence.ticketIndexFor(101, start = 1, gap = 1, ticketCount = 2))
    }

    @Test
    fun customListUsesTicketsInListOrder() {
        val games = listOf(1, 3, 4, 7, 9)
        val picks = (1..10).map { CallSequence.ticketIndexInList(it, games, ticketCount = 5) }
        assertEquals(listOf(0, null, 1, 2, null, null, 3, null, 4, null), picks)
    }

    @Test
    fun customListLongerThanTicketsIsRandomAfterTicketsRunOut() {
        val games = listOf(2, 5, 6, 8)
        assertEquals(1, CallSequence.ticketIndexInList(5, games, ticketCount = 2))
        assertNull(CallSequence.ticketIndexInList(6, games, ticketCount = 2))
        assertNull(CallSequence.ticketIndexInList(8, games, ticketCount = 2))
        assertNull(CallSequence.ticketIndexInList(2, games, ticketCount = 0))
        assertNull(CallSequence.ticketIndexInList(3, emptyList(), ticketCount = 4))
    }

    @Test
    fun gameListParsing() {
        assertEquals(listOf(1, 3, 4, 7, 9), CallSequence.parseGameList("1,3,4,7,9"))
        assertEquals(listOf(1, 3, 4, 7, 9), CallSequence.parseGameList(" 1, 3 ,4  7,9, "))
        assertEquals(listOf(1, 3, 9), CallSequence.parseGameList("9, 3, 1, 3"))
        assertEquals(emptyList<Int>(), CallSequence.parseGameList(""))
        assertNull(CallSequence.parseGameList("1, 3, x"))
        assertNull(CallSequence.parseGameList("0, 2"))
        assertNull(CallSequence.parseGameList("1.5"))
    }

    @Test
    fun noTicketsMeansEveryGameIsRandom() {
        assertTrue((1..20).all { CallSequence.ticketIndexFor(it, 1, 2, 0) == null })
        assertTrue(CallSequence.ticketGames(1, 2, 0).isEmpty())
    }
}
