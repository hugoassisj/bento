// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * The device's bento/id keys (phase-1 plan A1). Two keys, because the Keystore
 * attaches user authentication to a KEY, not to a call:
 *
 * - **routine** — signs edit batches and presence many times a minute; never
 *   prompts. TEE-backed, non-exportable.
 * - **consent** — signs shares, role changes, revocations and device links;
 *   every use needs the person, through a BiometricPrompt that authorises THIS
 *   signature (a CryptoObject), so the prompt is cryptographic, not cosmetic.
 *   StrongBox where the device has one: slower, and only used rarely.
 *
 * Nothing here decides WHAT is signed. The consent statement — origin-bound,
 * with bento's relying-party identity, the purpose, the docId and a channel
 * binding (identity-design §2e (A)) — is kernel's K2 format and its vectors;
 * this only produces raw signatures over the bytes it is given.
 */
object AgentKeys {
    const val ROUTINE = "bento-agent-routine"
    const val CONSENT = "bento-agent-consent"

    private fun keystore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    /** Where a key actually lives, as the Keystore reports it — for the probe and logs. */
    enum class Strength { STRONGBOX, TEE, SOFTWARE, UNKNOWN }

    fun ensure(context: Context) {
        val ks = keystore()
        if (!ks.containsAlias(ROUTINE)) generate(ROUTINE, consent = false, strongBox = false)
        if (!ks.containsAlias(CONSENT)) {
            val sb = Build.VERSION.SDK_INT >= 28 &&
                context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
            try {
                generate(CONSENT, consent = true, strongBox = sb)
            } catch (e: StrongBoxUnavailableException) {
                generate(CONSENT, consent = true, strongBox = false)
            }
        }
    }

    private fun generate(alias: String, consent: Boolean, strongBox: Boolean) {
        val b = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
        if (consent) {
            b.setUserAuthenticationRequired(true)
            // Per-use: a BiometricPrompt must authorise each signature. On 30+
            // the device PIN/pattern also qualifies; before 30 a 0-second
            // per-use key accepts strong biometrics only (plan A1: per-use on
            // 26–29, never a time window).
            if (Build.VERSION.SDK_INT >= 30) {
                b.setUserAuthenticationParameters(0,
                    KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
            } else {
                @Suppress("DEPRECATION") b.setUserAuthenticationValidityDurationSeconds(-1)
            }
        }
        if (strongBox && Build.VERSION.SDK_INT >= 28) b.setIsStrongBoxBacked(true)
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(b.build())
        }.generateKeyPair()
    }

    fun strength(alias: String): Strength = try {
        val key = keystore().getKey(alias, null) as PrivateKey
        val info = KeyFactory.getInstance(key.algorithm, "AndroidKeyStore").getKeySpec(key, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= 31) when (info.securityLevel) {
            KeyProperties.SECURITY_LEVEL_STRONGBOX -> Strength.STRONGBOX
            KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> Strength.TEE
            KeyProperties.SECURITY_LEVEL_SOFTWARE -> Strength.SOFTWARE
            else -> Strength.UNKNOWN
        } else @Suppress("DEPRECATION") if (info.isInsideSecureHardware) Strength.TEE else Strength.SOFTWARE
    } catch (e: Exception) { Strength.UNKNOWN }

    /** The public key as WebCrypto imports it with format "raw": 0x04 ‖ X ‖ Y (65 bytes). */
    fun publicRaw(alias: String): ByteArray {
        val pub = keystore().getCertificate(alias).publicKey as ECPublicKey
        return byteArrayOf(4) + fixed(pub.w.affineX, 32) + fixed(pub.w.affineY, 32)
    }

    /** Sign with the routine key. Returns raw r ‖ s, as WebCrypto verifies. */
    fun signRoutine(message: ByteArray): ByteArray {
        val s = Signature.getInstance("SHA256withECDSA")
        s.initSign(keystore().getKey(ROUTINE, null) as PrivateKey)
        s.update(message)
        return Ecdsa.derToRaw(s.sign())
    }

    /**
     * A Signature over the consent key, initialised for ONE signing operation.
     * Wrap it in a BiometricPrompt.CryptoObject; only after the prompt succeeds
     * will `sign()` work, and then for that one operation.
     */
    fun consentSignature(): Signature = Signature.getInstance("SHA256withECDSA").apply {
        initSign(keystore().getKey(CONSENT, null) as PrivateKey)
    }

    private fun fixed(n: BigInteger, len: Int): ByteArray {
        val b = n.toByteArray()
        return when {
            b.size == len -> b
            b.size > len -> b.copyOfRange(b.size - len, b.size)          // drop the sign byte
            else -> ByteArray(len - b.size) + b                           // left-pad
        }
    }
}

/** ECDSA signature encodings: the Keystore emits DER; WebCrypto wants raw r ‖ s. */
object Ecdsa {
    /**
     * DER `SEQUENCE { INTEGER r, INTEGER s }` → 64-byte raw `r ‖ s` for P-256.
     * Unconverted, a valid signature is rejected by WebCrypto as if tampered —
     * the same silent failure Releases.kt guards against in the other direction.
     */
    fun derToRaw(der: ByteArray): ByteArray {
        require(der.size >= 8 && der[0] == 0x30.toByte()) { "not a DER ECDSA signature" }
        var i = 2
        if (der[1].toInt() and 0x80 != 0) i = 2 + (der[1].toInt() and 0x7f)   // long-form length
        fun int(): ByteArray {
            require(der[i] == 0x02.toByte()) { "expected INTEGER" }
            val len = der[i + 1].toInt() and 0xff
            val v = der.copyOfRange(i + 2, i + 2 + len)
            i += 2 + len
            val trimmed = v.dropWhile { it == 0.toByte() }.toByteArray()
            require(trimmed.size <= 32) { "integer longer than 32 bytes" }
            return ByteArray(32 - trimmed.size) + trimmed
        }
        return int() + int()
    }
}
