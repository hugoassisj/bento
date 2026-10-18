// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.math.BigInteger
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.security.AlgorithmParameters

/**
 * Consent.kt against kernel/fixtures/identity-v1.json — RE-READ every run, never
 * pinned, so a regenerated fixture is still the contract.
 *
 * The verifier below is a test-side port of statements.ts verifyConsent. Its
 * job is to show that the bytes THIS host stamps are the bytes the reference
 * verifies: every cns row reaches its stated verdict through Consent's own
 * transcript and encoding, and every accepted row's text is rebuilt exactly by
 * Consent.build.
 */
class ConsentTest {
    private val fx: JsonObject = JsonParser.parseString(
        File("../../../kernel/fixtures/identity-v1.json").readText()).asJsonObject

    private fun JsonObject.str(k: String): String? = get(k)?.takeIf { !it.isJsonNull }?.asString

    // --- a raw r‖s, low-S P-256 verifier (what K2's verifyStatementSig does) ---

    private val n = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
    private val p256: ECParameterSpec = AlgorithmParameters.getInstance("EC").run {
        init(ECGenParameterSpec("secp256r1")); getParameterSpec(ECParameterSpec::class.java) }

    private fun verifySig(pubB64: String, sigB64: String, text: String): Boolean {
        val pub = Consent.b64uDec(pubB64) ?: return false
        val sig = Consent.b64uDec(sigB64) ?: return false
        if (pub.size != 65 || pub[0] != 4.toByte() || sig.size != 64) return false
        val r = BigInteger(1, sig.copyOfRange(0, 32)); val s = BigInteger(1, sig.copyOfRange(32, 64))
        if (r.signum() == 0 || s.signum() == 0 || r >= n || s > n.shiftRight(1)) return false   // low-S only
        val key = KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(
            ECPoint(BigInteger(1, pub.copyOfRange(1, 33)), BigInteger(1, pub.copyOfRange(33, 65))), p256))
        fun int(v: BigInteger): ByteArray { val b = v.toByteArray(); return byteArrayOf(2, b.size.toByte()) + b }
        val body = int(r) + int(s)
        return try {
            Signature.getInstance("SHA256withECDSA").run { initVerify(key); update(text.toByteArray()); verify(byteArrayOf(0x30, body.size.toByte()) + body) }
        } catch (e: Exception) { false }
    }

    private val RP_RE = Regex("^(bento|vault-[a-z0-9][a-z0-9-]{0,62})$")
    private val DOCID_RE = Regex("^[A-Za-z0-9_-]{1,128}$")

    private fun verifyConsent(row: JsonObject, consentPub: String, now: Long): String? {
        val text = row.str("text")!!
        if (text.isEmpty() || text.length > 4096 || text.any { it.code < 0x21 || it.code > 0x7e }) return "grammar"
        val p = text.split(".")
        if (p.size != 6 || p[0] != "cns") return "grammar"
        if (row.get("challengeSpent")?.asBoolean == true) return "replay"
        val (_, rp, purposeF, docIdF, transcript, expF) = p
        if (!RP_RE.matches(rp) || Consent.b64uDec(transcript)?.size != 32) return "grammar"
        if (purposeF == "grant" || purposeF == "role") return "reserved-purpose"
        val purpose = Consent.Purpose.of(purposeF) ?: return "grammar"
        val exp = expF.takeIf { Regex("^(0|[1-9][0-9]{0,15})$").matches(it) }?.toLong()?.takeIf { it > 0 } ?: return "grammar"
        if (rp != row.str("rp")) return "rp"
        val payload = row.str("payloadText")!!
        if (!payload.startsWith(purpose.family)) return "payload-family"
        val docId = row.str("docId")
        if (purpose.docScoped) { if (!DOCID_RE.matches(docIdF) || docIdF != docId) return "docid" }
        else if (docIdF != "" || docId != null) return "docid"
        val expected = Consent.transcript(row.str("audience")!!, row.str("challenge")!!, payload)
        if (expected == null || transcript != expected) return "transcript"
        if (now >= exp) return "expired"
        if (exp - now > 5 * 60_000) return "lifetime"
        if (!verifySig(consentPub, row.str("sig")!!, text)) return "signature"
        return null
    }
    private operator fun <T> List<T>.component6() = this[5]

    @Test fun `every cns row reaches its stated verdict`() {
        val now = fx.get("now").asLong
        val consentPub = fx.getAsJsonObject("keys").str("consent")!!
        val rows = fx.getAsJsonArray("statements").map { it.asJsonObject }.filter { it.str("type") == "cns" }
        assertTrue("the fixture has cns rows", rows.size >= 10)
        val seen = mutableSetOf<String>()
        for (row in rows) {
            val reason = verifyConsent(row, consentPub, row.get("now")?.asLong ?: now)
            val name = row.str("name")
            if (row.str("expect") == "accept") assertNull("$name: accepted by the reference, refused here ($reason)", reason)
            else {
                assertNotNull("$name: refused by the reference, accepted here", reason)
                assertEquals("$name: reason", row.str("reason"), reason)
                seen += reason!!
            }
        }
        // security's run-it check for A1: relayed and replayed consents are REJECTED
        assertTrue("the fixture exercises replay", "replay" in seen)
        assertTrue("the fixture exercises relay (transcript)", "transcript" in seen)
    }

    @Test fun `the host stamps byte-identical statements for every accepted row`() {
        val rows = fx.getAsJsonArray("statements").map { it.asJsonObject }
            .filter { it.str("type") == "cns" && it.str("expect") == "accept" }
        assertTrue(rows.isNotEmpty())
        for (row in rows) {
            val p = row.str("text")!!.split(".")
            val t = Consent.transcript(row.str("audience")!!, row.str("challenge")!!, row.str("payloadText")!!)!!
            val rebuilt = Consent.build(p[1], Consent.Purpose.of(p[2])!!, row.str("docId"), t, p[5].toLong())
            assertEquals(row.str("name"), row.str("text"), rebuilt)
        }
    }

    @Test fun `transcripts, including the refusals`() {
        for (r in fx.getAsJsonArray("transcripts").map { it.asJsonObject })
            assertEquals(r.toString(), r.str("transcript"),
                Consent.transcript(r.str("audience")!!, r.str("challenge")!!, r.str("payload")!!))
    }

    @Test fun `routine purposes match exactly the payloads the reference matches`() {
        for (r in fx.getAsJsonArray("purposes").map { it.asJsonObject })
            assertEquals(r.toString(), r.get("match").asBoolean, Consent.payloadMatchesPurpose(r.str("purpose")!!, r.str("payload")!!))
    }

    @Test fun `low-S - the signer folds every high-S signature to the low one`() {
        for (r in fx.getAsJsonArray("lowS").map { it.asJsonObject }) {
            val low = Consent.b64uDec(r.str("low")!!)!!; val high = Consent.b64uDec(r.str("high")!!)!!
            assertEquals(Consent.b64uEnc(low), Consent.b64uEnc(Ecdsa.lowS(high)))
            assertEquals(Consent.b64uEnc(low), Consent.b64uEnc(Ecdsa.lowS(low)))
        }
    }

    // --- stamping: what the host refuses to sign, whatever the page asks --------

    private val challenge = "Aw4ZJC86RVBbZnF8h5KdqLO-ydTf6vUA"

    @Test fun `stamp fixes the rp, the audience and a short expiry`() {
        val text = Consent.stamp(Consent.Purpose.LINK, null, challenge, "dev.x", 1_000)!!
        val p = text.split(".")
        assertEquals(listOf("cns", "bento", "link", ""), p.subList(0, 4))
        assertEquals(Consent.transcript("dir", challenge, "dev.x"), p[4])
        assertEquals("1000${""}".toLong() + Consent.TTL_MS, p[5].toLong())
        assertTrue(Consent.TTL_MS <= 5 * 60_000)
    }

    @Test fun `stamp refuses a mismatched family, a missing docId and a bad challenge`() {
        assertNull("link over an inv. payload", Consent.stamp(Consent.Purpose.LINK, null, challenge, "inv.x", 0))
        assertNull("invite with no host docId", Consent.stamp(Consent.Purpose.INVITE, null, challenge, "inv.x", 0))
        assertNull("invite with a malformed docId", Consent.stamp(Consent.Purpose.INVITE, "a.b", challenge, "inv.x", 0))
        assertNull("short challenge", Consent.stamp(Consent.Purpose.LINK, null, "AAAAAAAAAAA", "dev.x", 0))
        assertNull("padded challenge", Consent.stamp(Consent.Purpose.LINK, null, "$challenge=", "dev.x", 0))
        val inv = Consent.stamp(Consent.Purpose.INVITE, "doc-abc_123", challenge, "inv.x", 0)!!
        assertEquals("doc-abc_123", inv.split(".")[3])
        assertFalse("account-scoped purposes never carry the docId",
            Consent.stamp(Consent.Purpose.LINK, "doc-abc_123", challenge, "dev.x", 0)!!.contains("doc-abc_123"))
    }
}
