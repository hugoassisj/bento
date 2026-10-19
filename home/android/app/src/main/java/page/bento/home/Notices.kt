// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import java.io.File

/**
 * The agent's security notices and its own checks (threat model §29, §29a,
 * §29b), the Android twin of home/ios IdentityKeys.swift. Pure over a [Store],
 * so every rule is a JVM test.
 *
 * - **The enrolment tripwire.** The consent key accepts the device PIN, and
 *   Android then does NOT invalidate it when a fingerprint is added (measured:
 *   only a biometric-ONLY key is). So a biometric-only CANARY key stands beside
 *   it, signs nothing, and is read with initSign before every consent: that
 *   throws KeyPermanentlyInvalidatedException with no prompt. A change sends
 *   "biometrics changed on <device>" to every device and the address, queued
 *   durably BEFORE the consent can go on, then asks for re-confirmation.
 * - **Recipients are snapshotted when a notice is queued**: the devices listed
 *   then, plus the address. A device removed later still receives it and still
 *   holds it back. It never clears without the address. A silent device stops
 *   holding it back after 7 days, and only once the address has confirmed.
 * - **A device-list change sends its own notice** to the list as it was BEFORE
 *   the change. The publisher may not publish until it is queued.
 * - **Every device checks each fetched list itself** and raises a local alert
 *   if it, or a device it didn't remove, is gone — whatever the publisher did.
 *   The alert is written before the new list becomes the baseline.
 */
object Notices {

    // ---- storage -----------------------------------------------------------------

    sealed class Read {
        class Found(val text: String) : Read()
        object Absent : Read()
        object Unavailable : Read()
    }

    interface Store {
        fun get(name: String): Read
        fun set(name: String, text: String): Boolean
    }

    /** The app's identity records, in no-backup storage, each written by atomic rename. */
    class FileStore(private val dir: File) : Store {
        private fun f(name: String) = File(dir, name.replace('/', '_'))
        override fun get(name: String): Read = try {
            val file = f(name)
            if (!file.exists()) Read.Absent else Read.Found(file.readText())
        } catch (e: Exception) { Read.Unavailable }
        override fun set(name: String, text: String): Boolean = try {
            dir.mkdirs()
            val tmp = File(dir, f(name).name + ".tmp")
            tmp.writeText(text)
            tmp.renameTo(f(name))
        } catch (e: Exception) { false }
    }

    // ---- the record format: tokens only, so nothing needs escaping ---------------

    private val TOKEN = Regex("^[A-Za-z0-9_-]+$")
    private fun tok(s: String) = s.also { require(TOKEN.matches(it)) { "not a token: $it" } }
    private fun set(s: String): Set<String> = if (s.isEmpty()) emptySet() else s.split(",").toSet()
    private fun join(s: Set<String>) = s.sorted().joinToString(",") { tok(it) }

    data class Notice(
        val kind: String,
        val device: String,
        /** which change it is about (a hash) */
        val state: String,
        val at: Long,
        /** WHO it goes to, fixed when it was queued */
        val recipients: Set<String>,
        /** who has confirmed receiving it */
        val deliveredTo: Set<String> = emptySet(),
    ) {
        fun line() = listOf(tok(kind), tok(device), tok(state), at.toString(), join(recipients), join(deliveredTo)).joinToString("\t")
        companion object {
            fun parse(l: String): Notice? {
                val p = l.split("\t")
                if (p.size != 6) return null
                val at = p[3].toLongOrNull() ?: return null
                return Notice(p[0], p[1], p[2], at, set(p[4]), set(p[5]))
            }
        }
    }

    private fun decode(text: String): List<Notice>? =
        text.lines().filter { it.isNotEmpty() }.map { Notice.parse(it) ?: return null }

    const val OUTBOX = "identity/notice-outbox"
    const val ADDRESS = "address"
    const val SILENT_DEVICE_TIMEOUT_MS = 7 * 86_400_000L

    /** The notices still to deliver, or null if the outbox can't be read. */
    fun pending(store: Store): List<Notice>? = when (val r = store.get(OUTBOX)) {
        is Read.Found -> decode(r.text)
        Read.Absent -> emptyList()
        Read.Unavailable -> null
    }

    private fun save(l: List<Notice>, store: Store) = store.set(OUTBOX, l.joinToString("\n") { it.line() })

    /** Everyone confirmed; or the address did and every silent device has timed out. Never without the address. */
    fun isDone(n: Notice, now: Long): Boolean {
        if (ADDRESS !in n.deliveredTo) return false
        if (n.deliveredTo.containsAll(n.recipients)) return true
        return now - n.at >= SILENT_DEVICE_TIMEOUT_MS
    }

    private fun queue(n: Notice, store: Store): Boolean {
        val l = pending(store) ?: return false
        if (l.any { it.state == n.state && it.kind == n.kind }) return true   // idempotent per change
        return save(l + n, store)
    }

    /** Counts only for a recipient in the notice's own snapshot (removed devices included). */
    fun markDelivered(n: Notice, recipient: String, now: Long, store: Store): Boolean {
        val l = pending(store)?.toMutableList() ?: return false
        val i = l.indexOfFirst { it.state == n.state && it.device == n.device && it.kind == n.kind }
        if (i < 0 || recipient !in l[i].recipients) return false
        l[i] = l[i].copy(deliveredTo = l[i].deliveredTo + recipient)
        return save(l.filterNot { isDone(it, now) }, store)
    }

    fun sweep(now: Long, store: Store): Boolean {
        val l = pending(store) ?: return false
        return save(l.filterNot { isDone(it, now) }, store)
    }

    // ---- the enrolment tripwire ----------------------------------------------------

    enum class Enrolment { UNCHANGED, CHANGED, UNKNOWN }

    /**
     * What the platform says about enrolled biometrics. SENSOR_BUSY
     * (HW_UNAVAILABLE) is often transient; under a "bio" record the canary — a
     * Keystore check, no sensor needed — decides alone (security §29b). Under a
     * "none" record it can't tell whether biometrics were added, so UNKNOWN.
     */
    enum class Biometrics { ENROLLED, NONE, SENSOR_BUSY, UNKNOWN }

    /** What the Keystore says about the canary, read with initSign: never a prompt, never a signature. */
    enum class Canary { USABLE, INVALIDATED, ABSENT, ERROR }

    const val ENROLMENT = "identity/enrolment"

    /**
     * The record is "bio.<generation>" (a canary was minted under the enrolment
     * then) or "none.<generation>" (no biometrics then). A new generation is
     * chosen at every acceptance, so successive changes are distinct notices.
     */
    fun check(record: Read, bio: Biometrics, canary: Canary): Enrolment {
        if (canary == Canary.ERROR || bio == Biometrics.UNKNOWN) return Enrolment.UNKNOWN
        val r = when (record) {
            is Read.Found -> record.text
            Read.Absent -> return Enrolment.CHANGED        // made before the check: re-confirm once
            Read.Unavailable -> return Enrolment.UNKNOWN
        }
        return when {
            r.startsWith("bio.") -> when {
                bio == Biometrics.NONE -> Enrolment.CHANGED
                canary == Canary.USABLE -> Enrolment.UNCHANGED      // ENROLLED, or SENSOR_BUSY: the canary alone
                else -> Enrolment.CHANGED
            }
            r.startsWith("none.") -> when (bio) {
                Biometrics.NONE -> Enrolment.UNCHANGED
                Biometrics.ENROLLED -> Enrolment.CHANGED
                else -> Enrolment.UNKNOWN                           // SENSOR_BUSY: were biometrics added? can't tell
            }
            else -> Enrolment.UNKNOWN
        }
    }

    /** Which change this is: the record it departs from, and what was observed. */
    fun changeTag(record: Read, bio: Biometrics, canary: Canary): String {
        val from = (record as? Read.Found)?.text ?: "-"
        // SENSOR_BUSY under a "bio" record is decided by the canary: tag it as ENROLLED,
        // so a busy sensor and a ready one name the same change.
        val seen = if (bio == Biometrics.NONE) "none" else "bio"
        return Consent.sha256b64u("enrol.$from>$seen.${canary.name}")
    }

    enum class Gate { PROCEED, RECONFIRM, REFUSE }

    /**
     * Run before EVERY consent. On a change the notice is written to the durable
     * outbox FIRST, whether the consent then completes or is cancelled; a
     * restart neither drops nor repeats it. Nothing here takes input from the
     * page. `devices` is the account's device list now, snapshotted with the address.
     */
    fun enrolmentGate(bio: Biometrics, canary: Canary, device: String, devices: Set<String>, now: Long, store: Store): Gate {
        val record = store.get(ENROLMENT)
        return when (check(record, bio, canary)) {
            Enrolment.UNCHANGED -> Gate.PROCEED
            Enrolment.UNKNOWN -> Gate.REFUSE
            Enrolment.CHANGED -> {
                val n = Notice("biometrics-changed", device, changeTag(record, bio, canary), now, devices + ADDRESS)
                if (queue(n, store)) Gate.RECONFIRM else Gate.REFUSE
            }
        }
    }

    /**
     * After the person re-confirmed a consent under a changed enrolment. Refused
     * unless that change's notice is durably queued: the protection is the
     * NOTICE (someone who added their own finger re-confirms trivially).
     * `remint` replaces the canary under the enrolment as it is now and returns
     * true, or false if it couldn't; with no biometrics it mints nothing.
     */
    fun acceptEnrolment(bio: Biometrics, canary: Canary, generation: String, store: Store, remint: () -> Boolean): Boolean {
        // a new baseline is only ever recorded under a state the platform could name
        if (bio != Biometrics.ENROLLED && bio != Biometrics.NONE) return false
        val biometricsNow = bio == Biometrics.ENROLLED
        val record = store.get(ENROLMENT)
        val tag = changeTag(record, bio, canary)
        if (pending(store)?.any { it.kind == "biometrics-changed" && it.state == tag } != true) return false
        if (biometricsNow && !remint()) return false
        return store.set(ENROLMENT, (if (biometricsNow) "bio." else "none.") + tok(generation))
    }

    /** At consent-key creation: the enrolment it was born under (the canary is minted with it). */
    fun recordEnrolment(biometricsNow: Boolean, generation: String, store: Store): Boolean =
        store.set(ENROLMENT, (if (biometricsNow) "bio." else "none.") + tok(generation))

    // ---- a device-list change's own notice -------------------------------------------

    private fun listTag(before: Set<String>, after: Set<String>) =
        Consent.sha256b64u("devices.${before.sorted().joinToString(",")}>${after.sorted().joinToString(",")}")

    /** Queue the notice for a device-list change, to the list BEFORE it. Idempotent per change. */
    fun queueDeviceListChange(before: Set<String>, after: Set<String>, by: String, now: Long, store: Store): Boolean {
        if (before == after) return true
        return queue(Notice("devices-changed", by, listTag(before, after), now, before + ADDRESS), store)
    }

    /** True only once the notice for exactly this change is durably queued. */
    fun mayPublishDeviceList(before: Set<String>, after: Set<String>, store: Store): Boolean {
        if (before == after) return true
        val tag = listTag(before, after)
        return pending(store)?.any { it.kind == "devices-changed" && it.state == tag } ?: false
    }

    // ---- the receiver's own check ---------------------------------------------------

    data class Alert(val kind: String, val device: String, val by: String, val at: Long) {
        fun line() = listOf(tok(kind), tok(device), tok(by), at.toString()).joinToString("\t")
    }

    const val LAST_LIST = "identity/last-device-list"
    const val ALERTS = "identity/local-alerts"

    /**
     * Run on every fetch of the synced device list. Returns the alerts raised, or
     * null if the check couldn't be made; the caller must then not treat the list
     * as checked. `removedHere` is what this device itself removed.
     */
    fun observeDeviceList(current: Set<String>, signedBy: String, me: String, removedHere: Set<String>, now: Long, store: Store): List<Alert>? {
        val last: Set<String>? = when (val r = store.get(LAST_LIST)) {
            is Read.Found -> {
                if (r.text.isNotEmpty() && r.text.split(",").any { !TOKEN.matches(it) }) {
                    raise(listOf(Alert("unknown", me, signedBy, now)), store)   // never adopt a list blind
                    return null
                }
                set(r.text)
            }
            Read.Absent -> null                     // the first fetch sets the baseline
            Read.Unavailable -> return null
        }
        val alerts = mutableListOf<Alert>()
        if (last != null) {
            if (me in last && me !in current) alerts += Alert("this-device-removed", me, signedBy, now)
            for (gone in (last - current - me - removedHere).sorted()) alerts += Alert("device-removed", gone, signedBy, now)
        }
        // the alert first, then the new baseline
        if (alerts.isNotEmpty() && !raise(alerts, store)) return null
        if (!store.set(LAST_LIST, join(current))) return null
        return alerts
    }

    private fun raise(new: List<Alert>, store: Store): Boolean {
        val prior = when (val r = store.get(ALERTS)) {
            is Read.Found -> r.text.lines().filter { it.isNotEmpty() }
            Read.Absent -> emptyList()
            Read.Unavailable -> return false
        }
        return store.set(ALERTS, (prior + new.map { it.line() }).joinToString("\n"))
    }

    /** The alerts raised and not yet shown and dismissed, or null if unreadable. */
    fun localAlerts(store: Store): List<Alert>? = when (val r = store.get(ALERTS)) {
        is Read.Found -> r.text.lines().filter { it.isNotEmpty() }.map {
            val p = it.split("\t"); if (p.size != 4) return null
            Alert(p[0], p[1], p[2], p[3].toLongOrNull() ?: return null)
        }
        Read.Absent -> emptyList()
        Read.Unavailable -> null
    }
}
