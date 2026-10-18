// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import page.bento.home.Notices.Canary
import page.bento.home.Notices.Enrolment
import page.bento.home.Notices.Gate
import page.bento.home.Notices.Read

/**
 * Threat model §29 / §29a / §29b, the same cases as home/ios's
 * test-home-id-keys.mjs, against Notices.kt. The store is in memory; a
 * "restart" is a fresh read of the same map, and a blind store refuses reads.
 */
class NoticesTest {
    private class Mem(var blind: Boolean = false) : Notices.Store {
        val m = HashMap<String, String>()
        override fun get(name: String): Read = if (blind) Read.Unavailable else m[name]?.let { Read.Found(it) } ?: Read.Absent
        override fun set(name: String, text: String): Boolean { if (blind) return false; m[name] = text; return true }
    }
    private val day = 86_400_000L
    private val me = "devA"
    private val list = setOf("devA", "devB", "devC")

    // ---- the tripwire ----

    @Test fun `the enrolment the consent key was made under reads unchanged`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        assertEquals(Enrolment.UNCHANGED, Notices.check(s.get(Notices.ENROLMENT), true, Canary.USABLE))
    }

    @Test fun `a new finger invalidates the canary - CHANGED`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        assertEquals(Enrolment.CHANGED, Notices.check(s.get(Notices.ENROLMENT), true, Canary.INVALIDATED))
        assertEquals("a missing canary is a change too", Enrolment.CHANGED, Notices.check(s.get(Notices.ENROLMENT), true, Canary.ABSENT))
    }

    @Test fun `biometrics removed, or gained where there were none, is CHANGED`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        assertEquals(Enrolment.CHANGED, Notices.check(s.get(Notices.ENROLMENT), false, Canary.USABLE))
        Notices.recordEnrolment(false, "g2", s)
        assertEquals(Enrolment.UNCHANGED, Notices.check(s.get(Notices.ENROLMENT), false, Canary.ABSENT))
        assertEquals(Enrolment.CHANGED, Notices.check(s.get(Notices.ENROLMENT), true, Canary.ABSENT))
    }

    @Test fun `no record is CHANGED once, an unreadable record or a Keystore error is UNKNOWN`() {
        assertEquals(Enrolment.CHANGED, Notices.check(Read.Absent, true, Canary.USABLE))
        assertEquals(Enrolment.UNKNOWN, Notices.check(Read.Unavailable, true, Canary.USABLE))
        assertEquals(Enrolment.UNKNOWN, Notices.check(Read.Found("bio.g1"), true, Canary.ERROR))
        assertEquals(Enrolment.UNKNOWN, Notices.check(Read.Found("garbage"), true, Canary.USABLE))
    }

    // ---- the notice comes first ----

    @Test fun `an unchanged enrolment proceeds and queues nothing`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        assertEquals(Gate.PROCEED, Notices.enrolmentGate(true, Canary.USABLE, me, list, 0, s))
        assertEquals(0, Notices.pending(s)!!.size)
    }

    @Test fun `a third finger - the notice is queued BEFORE re-confirmation, and survives a kill`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        assertFalse("cannot be accepted before its notice is queued",
            Notices.acceptEnrolment(true, Canary.INVALIDATED, "g2", s) { true })
        assertEquals(Gate.RECONFIRM, Notices.enrolmentGate(true, Canary.INVALIDATED, me, list, 0, s))
        val q = Notices.pending(s)!!
        assertEquals(1, q.size); assertEquals("biometrics-changed", q[0].kind)
        // killed here, before acceptance: a restart reads the same store
        val restarted = Mem().also { it.m.putAll(s.m) }
        assertEquals("still queued after the kill", 1, Notices.pending(restarted)!!.size)
        assertEquals("and still not accepted", Enrolment.CHANGED,
            Notices.check(restarted.get(Notices.ENROLMENT), true, Canary.INVALIDATED))
        assertEquals(Gate.RECONFIRM, Notices.enrolmentGate(true, Canary.INVALIDATED, me, list, 5, restarted))
        assertEquals("the gate after a restart neither drops nor repeats it", 1, Notices.pending(restarted)!!.size)
    }

    @Test fun `after acceptance a fresh canary under the new enrolment is UNCHANGED, and the notice stays until sent`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        Notices.enrolmentGate(true, Canary.INVALIDATED, me, list, 0, s)
        var reminted = false
        assertTrue(Notices.acceptEnrolment(true, Canary.INVALIDATED, "g2", s) { reminted = true; true })
        assertTrue("the canary was re-minted", reminted)
        assertEquals(Gate.PROCEED, Notices.enrolmentGate(true, Canary.USABLE, me, list, 10, s))
        assertEquals("accepting doesn't send it", 1, Notices.pending(s)!!.size)
        assertEquals("a later finger is a NEW change", Gate.RECONFIRM, Notices.enrolmentGate(true, Canary.INVALIDATED, me, list, 20, s))
        assertEquals(2, Notices.pending(s)!!.size)
    }

    @Test fun `a failed re-mint is not an acceptance`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        Notices.enrolmentGate(true, Canary.INVALIDATED, me, list, 0, s)
        assertFalse(Notices.acceptEnrolment(true, Canary.INVALIDATED, "g2", s) { false })
        assertEquals(Enrolment.CHANGED, Notices.check(s.get(Notices.ENROLMENT), true, Canary.INVALIDATED))
    }

    @Test fun `a store that cannot be read refuses the consent`() {
        assertEquals(Gate.REFUSE, Notices.enrolmentGate(true, Canary.USABLE, me, list, 0, Mem(blind = true)))
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        assertEquals("a Keystore error refuses", Gate.REFUSE, Notices.enrolmentGate(true, Canary.ERROR, me, list, 0, s))
    }

    // ---- recipients and the anchor ----

    private fun queued(s: Mem): Notices.Notice {
        Notices.recordEnrolment(true, "g1", s)
        Notices.enrolmentGate(true, Canary.INVALIDATED, me, list, 0, s)
        return Notices.pending(s)!!.single()
    }

    @Test fun `recipients are snapshotted at queue time - the devices then, plus the address`() {
        val s = Mem(); val n = queued(s)
        assertEquals(list + Notices.ADDRESS, n.recipients)
    }

    @Test fun `partial delivery keeps it, strangers are ignored, removed devices still hold it back`() {
        val s = Mem(); val n = queued(s)
        assertTrue(Notices.markDelivered(n, Notices.ADDRESS, 1, s))
        assertTrue(Notices.markDelivered(n, "devB", 1, s))
        assertEquals("partial", 1, Notices.pending(s)!!.size)
        assertFalse("a stranger's confirmation is ignored", Notices.markDelivered(n, "devZ", 1, s))
        // devC is dropped from the account now; it is still in the snapshot
        assertEquals("removed devC still holds it back at 6 days", 1, Notices.apply { sweep(6 * day, s) }.pending(s)!!.size)
        assertTrue(Notices.sweep(7 * day, s))
        assertEquals("and stops at 7 days, the address having confirmed", 0, Notices.pending(s)!!.size)
    }

    @Test fun `everyone confirming clears it at once`() {
        val s = Mem(); val n = queued(s)
        for (r in n.recipients) Notices.markDelivered(n, r, 1, s)
        assertEquals(0, Notices.pending(s)!!.size)
    }

    @Test fun `without the ADDRESS a notice never clears`() {
        val s = Mem(); val n = queued(s)
        for (r in list) Notices.markDelivered(n, r, 1, s)
        Notices.sweep(365 * day, s)
        assertEquals(1, Notices.pending(s)!!.size)
        Notices.markDelivered(n, Notices.ADDRESS, 365 * day, s)
        assertEquals(0, Notices.pending(s)!!.size)
    }

    // ---- device-list changes ----

    @Test fun `remove-then-enrol - the list notice goes to the BEFORE list, publish waits for it`() {
        val s = Mem(); Notices.recordEnrolment(true, "g1", s)
        val after = setOf("devA")
        assertFalse("not publishable before its notice is queued", Notices.mayPublishDeviceList(list, after, s))
        assertTrue(Notices.queueDeviceListChange(list, after, me, 0, s))
        assertTrue(Notices.mayPublishDeviceList(list, after, s))
        // then a finger: that notice is snapshotted from the SHRUNK list…
        Notices.enrolmentGate(true, Canary.INVALIDATED, me, after, 1, s)
        val bio = Notices.pending(s)!!.single { it.kind == "biometrics-changed" }
        assertFalse("the finger notice excludes the dropped devices", "devB" in bio.recipients)
        // …but the list notice reaches them and waits for them
        val dl = Notices.pending(s)!!.single { it.kind == "devices-changed" }
        assertEquals(list + Notices.ADDRESS, dl.recipients)
        Notices.markDelivered(dl, Notices.ADDRESS, 2, s); Notices.markDelivered(dl, "devA", 2, s)
        assertTrue("waits for the removed devices", Notices.pending(s)!!.any { it.kind == "devices-changed" })
        assertTrue(Notices.queueDeviceListChange(list, after, me, 3, s))
        assertEquals("queuing the same change twice queues one", 1, Notices.pending(s)!!.count { it.kind == "devices-changed" })
    }

    @Test fun `enrol-then-remove - the finger notice keeps the devices removed after it`() {
        val s = Mem(); val n = queued(s)
        Notices.queueDeviceListChange(list, setOf("devA"), me, 1, s)
        assertEquals(list + Notices.ADDRESS, Notices.pending(s)!!.single { it.kind == "biometrics-changed" }.recipients)
        assertEquals(n.recipients, Notices.pending(s)!!.first().recipients)
    }

    // ---- the receiver's own check ----

    @Test fun `a publish that skipped the gate is caught by the receiver`() {
        val b = Mem()   // device B's own store
        assertEquals(emptyList<Notices.Alert>(), Notices.observeDeviceList(list, "devA", "devB", emptySet(), 0, b))
        // a hostile devA publishes {devA} without ever queuing a notice
        val alerts = Notices.observeDeviceList(setOf("devA"), "devA", "devB", emptySet(), 1, b)!!
        assertEquals(listOf("this-device-removed", "device-removed"), alerts.map { it.kind })
        assertEquals("devC", alerts[1].device)
        assertEquals("recorded durably", 2, Notices.localAlerts(b)!!.size)
    }

    @Test fun `removals made here raise nothing, and an unreadable baseline is never adopted blind`() {
        val a = Mem()
        Notices.observeDeviceList(list, "devA", "devA", emptySet(), 0, a)
        assertEquals(0, Notices.observeDeviceList(setOf("devA", "devB"), "devA", "devA", setOf("devC"), 1, a)!!.size)
        val blind = Mem(blind = true)
        assertNull(Notices.observeDeviceList(list, "devA", "devB", emptySet(), 0, blind))
        val bad = Mem().also { it.m[Notices.LAST_LIST] = "devA,de vB" }
        assertNull(Notices.observeDeviceList(list, "devA", "devB", emptySet(), 0, bad))
        assertEquals("unknown", Notices.localAlerts(bad)!!.single().kind)
        assertEquals("the bad baseline was not replaced", "devA,de vB", bad.m[Notices.LAST_LIST])
    }

    @Test fun `the alert is written before the baseline`() {
        val order = mutableListOf<String>()
        val s = object : Notices.Store {
            val m = HashMap<String, String>()
            override fun get(name: String): Read = m[name]?.let { Read.Found(it) } ?: Read.Absent
            override fun set(name: String, text: String): Boolean { order += name; m[name] = text; return true }
        }
        Notices.observeDeviceList(list, "devA", "devB", emptySet(), 0, s); order.clear()
        Notices.observeDeviceList(setOf("devA"), "devA", "devB", emptySet(), 1, s)
        assertEquals(listOf(Notices.ALERTS, Notices.LAST_LIST), order)
    }
}
