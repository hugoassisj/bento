// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * DER → raw conversion for the agent's signatures. Real signatures from the
 * JVM's own ECDSA (DER, like the Keystore's) are converted and must verify
 * again after converting back — and must be exactly 64 bytes, including the
 * cases where r or s has a leading zero (31 bytes) or a sign byte (33 bytes),
 * which a sloppy conversion gets wrong about one time in 256.
 */
class EcdsaTest {
    private fun rawToDer(raw: ByteArray): ByteArray {
        fun int(b: ByteArray): ByteArray {
            var i = 0
            while (i < b.size - 1 && b[i] == 0.toByte()) i++
            var v = b.copyOfRange(i, b.size)
            if (v[0].toInt() and 0x80 != 0) v = byteArrayOf(0) + v
            return byteArrayOf(0x02, v.size.toByte()) + v
        }
        val body = int(raw.copyOfRange(0, 32)) + int(raw.copyOfRange(32, 64))
        return byteArrayOf(0x30, body.size.toByte()) + body
    }

    @Test fun `two thousand real signatures convert to 64 bytes and verify both ways`() {
        val kp = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        var sawShort = false; var sawSignByte = false
        repeat(2000) { n ->
            val msg = "message $n".toByteArray()
            val der = Signature.getInstance("SHA256withECDSA").run { initSign(kp.private); update(msg); sign() }
            val rLen = der[3].toInt(); val sLen = der[5 + rLen].toInt()
            if (rLen < 32 || sLen < 32) sawShort = true
            if (rLen == 33 || sLen == 33) sawSignByte = true
            val raw = Ecdsa.derToRaw(der)
            assertEquals(64, raw.size)
            val ok = Signature.getInstance("SHA256withECDSA").run { initVerify(kp.public); update(msg); verify(rawToDer(raw)) }
            assertTrue("signature $n must verify after DER→raw→DER", ok)
        }
        assertTrue("the run must include a short integer (leading zero dropped)", sawShort)
        assertTrue("the run must include a sign-byte integer (33 bytes)", sawSignByte)
    }

    @Test fun `low-S normalisation keeps the signature valid and always lands at or below n over 2`() {
        val n = java.math.BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
        val kp = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        var flipped = 0
        repeat(500) { k ->
            val msg = "low-s $k".toByteArray()
            val raw = Ecdsa.derToRaw(Signature.getInstance("SHA256withECDSA").run { initSign(kp.private); update(msg); sign() })
            val low = Ecdsa.lowS(raw)
            val s = java.math.BigInteger(1, low.copyOfRange(32, 64))
            assertTrue("s must be low", s <= n.shiftRight(1))
            if (!low.contentEquals(raw)) flipped++
            val ok = Signature.getInstance("SHA256withECDSA").run { initVerify(kp.public); update(msg); verify(rawToDer(low)) }
            assertTrue("normalised signature $k must still verify", ok)
            assertArrayEquals("normalising twice changes nothing", low, Ecdsa.lowS(low))
        }
        assertTrue("about half need flipping; got $flipped of 500", flipped in 150..350)
    }

    @Test fun `a hand-built signature with a short r is left-padded`() {
        val r = ByteArray(31) { 0x11 }; val s = ByteArray(32) { 0x7f }
        val der = byteArrayOf(0x30, (2 + 31 + 2 + 32).toByte(), 0x02, 31) + r + byteArrayOf(0x02, 32) + s
        assertArrayEquals(byteArrayOf(0) + r + s, Ecdsa.derToRaw(der))
    }
}
