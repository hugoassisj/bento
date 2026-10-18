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
 * The device's bento/connect keys (phase-1 plan A1). Two keys, because the Keystore
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
    /** Biometric-only, never signs: the enrolment tripwire (Notices, §29b). */
    const val CANARY = "bento-agent-canary"

    /** The agent's identity records (enrolment baseline, notice outbox, alerts). */
    fun store(context: Context): Notices.Store = Notices.FileStore(java.io.File(context.noBackupFilesDir, "identity"))

    private fun keystore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    /** Where a key actually lives, as the Keystore reports it — for the probe and logs. */
    enum class Strength { STRONGBOX, TEE, SOFTWARE, UNKNOWN }

    fun ensure(context: Context) {
        val ks = keystore()
        if (!ks.containsAlias(ROUTINE)) generate(ROUTINE, consent = false, strongBox = false)
        // (Requires a secure lock screen: without one, generation throws and
        // the caller reports no identity. A Bento ID key on a phone anyone can
        // pick up and use would vouch for nobody.)
        if (!ks.containsAlias(CONSENT)) {
            // The canary and the enrolment baseline are made WITH the consent
            // key, before any consent can run the gate: otherwise a brand-new
            // identity reads "changed" and its first consent sends every device
            // a false "biometrics changed" (home-ios hit exactly this).
            val sb = Build.VERSION.SDK_INT >= 28 &&
                context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
            try {
                try {
                    generate(CONSENT, consent = true, strongBox = sb)
                } catch (e: StrongBoxUnavailableException) {
                    generate(CONSENT, consent = true, strongBox = false)
                }
            } catch (e: java.security.GeneralSecurityException) {
                // API 26–29 has no per-use key that accepts the device PIN: with
                // no enrolled biometric there is no consent key (security §29,
                // option a). The routine key above still stands, so the device
                // does everyday work. A later ensure() mints the consent key
                // once a fingerprint is enrolled. From 30 on this is a real fault.
                if (Build.VERSION.SDK_INT >= 30) throw e
            }
            if (ks.containsAlias(CONSENT)) {
                val bio = biometrics(context)
                // A canary that fails to mint, or a state the platform can't
                // name, leaves no baseline: the first consent then reads
                // CHANGED (or refuses) — never a baseline nothing backs.
                if (bio == Notices.Biometrics.NONE || (bio == Notices.Biometrics.ENROLLED && remintCanary()))
                    Notices.recordEnrolment(bio == Notices.Biometrics.ENROLLED, generation(), store(context))
            }
        }
    }

    /** The platform's answer, mapped once. Anything unrecognised is UNKNOWN, which refuses. */
    fun biometrics(context: Context): Notices.Biometrics =
        when (androidx.biometric.BiometricManager.from(context)
            .canAuthenticate(androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
            androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS -> Notices.Biometrics.ENROLLED
            androidx.biometric.BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED,
            androidx.biometric.BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> Notices.Biometrics.NONE
            androidx.biometric.BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> Notices.Biometrics.SENSOR_BUSY
            else -> Notices.Biometrics.UNKNOWN
        }

    /** Read the canary with initSign: no prompt, no signature. Invalidated by a new enrolment (measured). */
    fun canary(): Notices.Canary = try {
        val ks = keystore()
        if (!ks.containsAlias(CANARY)) Notices.Canary.ABSENT
        else { Signature.getInstance("SHA256withECDSA").initSign(ks.getKey(CANARY, null) as PrivateKey); Notices.Canary.USABLE }
    } catch (e: android.security.keystore.KeyPermanentlyInvalidatedException) { Notices.Canary.INVALIDATED }
      catch (e: Exception) { Notices.Canary.ERROR }

    /** Replace the canary under the enrolment as it is now. Biometric-only and per-use, so any new enrolment voids it. */
    fun remintCanary(): Boolean = try {
        keystore().deleteEntry(CANARY)
        val b = KeyGenParameterSpec.Builder(CANARY, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        else @Suppress("DEPRECATION") b.setUserAuthenticationValidityDurationSeconds(-1)
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply { initialize(b.build()) }.generateKeyPair()
        true
    } catch (e: Exception) { false }

    fun generation(): String = Consent.b64uEnc(ByteArray(12).also { java.security.SecureRandom().nextBytes(it) })

    /**
     * The gate before EVERY consent (§29b): the notice is queued first on a
     * change. `devices` is the account's device list now.
     */
    fun enrolmentGate(context: Context, device: String, devices: Set<String>, now: Long): Notices.Gate =
        Notices.enrolmentGate(biometrics(context), canary(), device, devices, now, store(context))

    /** After re-confirmation: accept the new enrolment (only once its notice is queued) and re-mint the canary. */
    fun acceptEnrolment(context: Context): Boolean {
        return Notices.acceptEnrolment(biometrics(context), canary(), generation(), store(context)) { remintCanary() }
    }

    /** False on API 26–29 with no enrolled biometric: this device cannot consent. */
    fun hasConsentKey(): Boolean = keystore().containsAlias(CONSENT)

    private fun generate(alias: String, consent: Boolean, strongBox: Boolean) {
        val b = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
        if (!consent) {
            // The HARDWARE floor of §2e (B): no device authentication in the
            // overall period and the Keystore itself refuses, whatever the app
            // believes. It is only a floor — a lock-screen unlock reopens it
            // (measured), so the idle and overall timeouts proper are RoutineGate's.
            b.setUserAuthenticationRequired(true)
            if (Build.VERSION.SDK_INT >= 30) {
                b.setUserAuthenticationParameters(RoutineGate.OVERALL_SECONDS,
                    KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
            } else {
                @Suppress("DEPRECATION") b.setUserAuthenticationValidityDurationSeconds(RoutineGate.OVERALL_SECONDS)
            }
            // Enrolling a new fingerprint must not destroy the device's identity:
            // the routine key carries no consent, and losing it would orphan every
            // room this device is in. (Android 7+; the default would invalidate.)
            b.setInvalidatedByBiometricEnrollment(false)
        } else {
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
        return Ecdsa.lowS(Ecdsa.derToRaw(s.sign()))
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

    /** P-256's group order n. */
    private val N = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
    private val HALF_N = N.shiftRight(1)

    /**
     * Low-S normalisation (K1's SignResult contract): if s > n/2, replace it
     * with n − s. Both verify; only the low one is accepted, so a signature
     * cannot be re-minted into a second valid byte string by a third party.
     * The Keystore does not normalise, so about half its signatures need this.
     */
    fun lowS(raw: ByteArray): ByteArray {
        require(raw.size == 64) { "raw P-256 signature is 64 bytes" }
        val s = BigInteger(1, raw.copyOfRange(32, 64))
        if (s <= HALF_N) return raw
        val t = N.subtract(s).toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
        return raw.copyOfRange(0, 32) + ByteArray(32 - t.size) + t
    }
}
