// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** §2e (B): the routine key's app-side session — idle and overall timeouts. */
class RoutineGateTest {
    private val H = 3_600_000L

    @Test fun `nothing signs before the person has authenticated`() {
        assertFalse(RoutineGate().allow(0))
    }

    @Test fun `steady use keeps the session open until the overall timeout`() {
        val g = RoutineGate(); g.authenticated(0)
        var t = 0L
        while (t < 24 * H - 30 * 60_000) { t += 30 * 60_000; assertTrue("use at ${t / 60_000} min", g.allow(t)) }
        assertFalse("24 h after authenticating, even steady use is refused", g.allow(24 * H))
    }

    @Test fun `an hour idle locks it, and it stays locked until re-authentication`() {
        val g = RoutineGate(); g.authenticated(0)
        assertTrue(g.allow(59 * 60_000))
        assertFalse(g.allow(59 * 60_000 + H))
        assertFalse("a refusal is not a use: it must not reopen the session", g.allow(59 * 60_000 + H + 1))
        g.authenticated(3 * H)
        assertTrue(g.allow(3 * H + 1))
    }

    @Test fun `a clock that goes backwards fails closed`() {
        val g = RoutineGate(); g.authenticated(10 * H)
        assertFalse(g.allow(9 * H))
        assertFalse(g.allow(10 * H + 1))
    }

    @Test fun `an organisation may tighten the timeouts but never loosen them`() {
        val g = RoutineGate(idleMs = 15 * 60_000, overallMs = 12 * H); g.authenticated(0)
        assertFalse(g.allow(15 * 60_000))
        assertTrue(runCatching { RoutineGate(idleMs = 2 * H) }.isFailure)
    }
}
