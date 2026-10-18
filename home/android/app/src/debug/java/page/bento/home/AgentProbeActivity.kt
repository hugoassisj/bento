// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricManager.Authenticators
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * DEBUG ONLY — exercises AgentKeys on a device before any bridge exists.
 * Every result goes to logcat under "BentoAgentProbe". Launch with
 *   adb shell am start -n page.bento.home/.AgentProbeActivity
 * and answer the prompt with a fingerprint (emulator: `adb emu finger touch 1`).
 */
class AgentProbeActivity : AppCompatActivity() {
    private fun log(m: String) = Log.i("BentoAgentProbe", m)
    private val msg = "bento/connect probe".toByteArray()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.getStringExtra("mode") == "window") { windowProbe(); return }
        if (intent.getStringExtra("mode") == "consent") { consentProbe(); return }
        if (intent.getStringExtra("mode") == "keystate") { keyState(); return }
        if (intent.getStringExtra("mode") == "gate") { gateProbe(); return }
        AgentKeys.ensure(this)
        log("sdk=${Build.VERSION.SDK_INT} routine=${AgentKeys.strength(AgentKeys.ROUTINE)} consent=${AgentKeys.strength(AgentKeys.CONSENT)}")
        val routineSig = AgentKeys.signRoutine(msg)
        log("routine: ${routineSig.size}-byte raw signature, verifies=${verifyRaw(AgentKeys.ROUTINE, routineSig)}")
        log("routine pub (raw, ${AgentKeys.publicRaw(AgentKeys.ROUTINE).size} B): ${Base64.encodeToString(AgentKeys.publicRaw(AgentKeys.ROUTINE), Base64.NO_WRAP)}")

        // Consent WITHOUT authenticating: the Keystore must refuse to sign.
        val unauth = try {
            AgentKeys.consentSignature().run { update(msg); sign() }; "SIGNED (WRONG)"
        } catch (e: Exception) { "refused: ${e.javaClass.simpleName}" }
        log("consent without auth: $unauth")

        // Consent WITH a prompt that authorises exactly this Signature.
        val sig = AgentKeys.consentSignature()
        val allowed = if (Build.VERSION.SDK_INT >= 30) Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL
                      else Authenticators.BIOMETRIC_STRONG
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("bento/connect probe").setSubtitle("Approve a consent signature")
            .setAllowedAuthenticators(allowed)
            .apply { if (Build.VERSION.SDK_INT < 30) setNegativeButtonText("Cancel") }
            .build()
        BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val s = result.cryptoObject!!.signature!!
                s.update(msg)
                val raw = Ecdsa.derToRaw(s.sign())
                log("consent after auth: ${raw.size}-byte raw signature, verifies=${verifyRaw(AgentKeys.CONSENT, raw)}")
                // The authorisation covered ONE operation. A second, fresh Signature must be refused.
                val again = try { AgentKeys.consentSignature().run { update(msg); sign() }; "SIGNED (WRONG)" }
                            catch (e: Exception) { "refused: ${e.javaClass.simpleName}" }
                log("consent second use without a new prompt: $again")
                log("DONE")
            }
            override fun onAuthenticationError(code: Int, err: CharSequence) { log("prompt error $code: $err"); log("DONE") }
        }).authenticate(info, BiometricPrompt.CryptoObject(sig))
    }

    /**
     * Does a DEVICE UNLOCK open a Keystore auth-validity window? A throwaway key
     * valid for 300 s after the user authenticates; sign with it and report.
     * Run right after unlocking the screen (no app prompt in between).
     */
    private fun windowProbe() {
        val alias = "bento-probe-window"
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!ks.containsAlias(alias)) {
            java.security.KeyPairGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(android.security.keystore.KeyGenParameterSpec.Builder(alias, android.security.keystore.KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                    .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(true)
                    .setUserAuthenticationParameters(300,
                        android.security.keystore.KeyProperties.AUTH_BIOMETRIC_STRONG or android.security.keystore.KeyProperties.AUTH_DEVICE_CREDENTIAL)
                    .build())
            }.generateKeyPair()
            log("window: key created")
        }
        val r = try {
            Signature.getInstance("SHA256withECDSA").run { initSign(ks.getKey(alias, null) as java.security.PrivateKey); update(msg); sign() }
            "SIGNED without an app prompt"
        } catch (e: Exception) { "refused: ${e.javaClass.simpleName}" }
        log("window: $r")
        log("DONE")
        finish()
    }

    /**
     * A host-stamped consent end to end: stamp a `cns.` for the given challenge
     * and statement, sign it with the consent key inside a BiometricPrompt, and
     * log text, signature and keys for kernel's reference verifier to judge.
     */
    private fun consentProbe() {
        AgentKeys.ensure(this)
        val challenge = intent.getStringExtra("challenge")!!
        val payload = intent.getStringExtra("payload")!!
        val purpose = Consent.Purpose.of(intent.getStringExtra("purpose") ?: "link")!!
        val text = Consent.stamp(purpose, intent.getStringExtra("docId"), challenge, payload, System.currentTimeMillis())
        if (text == null) { log("consent: host REFUSED to stamp"); log("DONE"); return }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Link a new device?").setSubtitle("bento/connect probe")
            .setAllowedAuthenticators(Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL)
            .build()
        BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val s = result.cryptoObject!!.signature!!
                s.update(text.toByteArray(Charsets.UTF_8))
                val sig = Ecdsa.lowS(Ecdsa.derToRaw(s.sign()))
                log("CNS text=$text")
                log("CNS sig=${Consent.b64uEnc(sig)}")
                log("CNS consentPub=${Consent.b64uEnc(AgentKeys.publicRaw(AgentKeys.CONSENT))}")
                log("CNS routinePub=${Consent.b64uEnc(AgentKeys.publicRaw(AgentKeys.ROUTINE))}")
                log("DONE")
            }
            override fun onAuthenticationError(code: Int, err: CharSequence) { log("prompt error $code: $err"); log("DONE") }
        }).authenticate(info, BiometricPrompt.CryptoObject(AgentKeys.consentSignature()))
    }

    /**
     * Is each key still usable? Initialising a Signature needs no
     * authentication, but throws KeyPermanentlyInvalidatedException for a key
     * the platform invalidated — the enrolment tripwire, observed directly.
     * "fresh" first deletes both keys and mints them anew.
     */
    private fun keyState() {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (intent.getBooleanExtra("fresh", false)) { ks.deleteEntry(AgentKeys.ROUTINE); ks.deleteEntry(AgentKeys.CONSENT) }
        try { AgentKeys.ensure(this) } catch (e: Exception) { log("ensure threw ${e.javaClass.simpleName}: ${e.message}") }
        // POSITIVE CONTROL: a biometric-ONLY per-use key, which the platform
        // documents as invalidated by a new enrolment. If this one never reads
        // INVALIDATED either, the probe cannot see invalidation at all.
        if (intent.getBooleanExtra("canary", false)) {
            ks.deleteEntry("bento-probe-canary")
            java.security.KeyPairGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                initialize(android.security.keystore.KeyGenParameterSpec.Builder("bento-probe-canary", android.security.keystore.KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                    .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(true)
                    .setUserAuthenticationParameters(0, android.security.keystore.KeyProperties.AUTH_BIOMETRIC_STRONG)
                    .build())
            }.generateKeyPair()
            log("keystate: canary minted")
        }
        val bm = androidx.biometric.BiometricManager.from(this)
        log("keystate: biometricStrong=${bm.canAuthenticate(Authenticators.BIOMETRIC_STRONG)} (0=enrolled)")
        for (alias in listOf(AgentKeys.ROUTINE, AgentKeys.CONSENT, "bento-probe-canary")) {
            val r = if (!ks.containsAlias(alias)) "ABSENT" else try {
                Signature.getInstance("SHA256withECDSA").initSign(ks.getKey(alias, null) as java.security.PrivateKey); "usable"
            } catch (e: android.security.keystore.KeyPermanentlyInvalidatedException) { "INVALIDATED" }
              catch (e: Exception) { "error ${e.javaClass.simpleName}" }
            log("keystate: $alias $r")
        }
        log("DONE"); finish()
    }

    /**
     * The §29b gate on real keys. "fresh" deletes everything and starts a new
     * identity; "accept" re-confirms. Logs the gate, the canary and the outbox.
     */
    private fun gateProbe() {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (intent.getBooleanExtra("fresh", false)) {
            for (a in listOf(AgentKeys.ROUTINE, AgentKeys.CONSENT, AgentKeys.CANARY)) ks.deleteEntry(a)
            java.io.File(noBackupFilesDir, "identity").deleteRecursively()
        }
        AgentKeys.ensure(this)
        val devices = setOf("devA", "devB", "devC")
        if (intent.getBooleanExtra("accept", false)) log("gate: accept=${AgentKeys.acceptEnrolment(this)}")
        log("gate: canary=${AgentKeys.canary()} biometrics=${AgentKeys.biometrics(this)}")
        log("gate: ${AgentKeys.enrolmentGate(this, "devA", devices, System.currentTimeMillis())}")
        val st = AgentKeys.store(this)
        log("gate: outbox=${Notices.pending(st)?.map { it.kind + "->" + it.recipients.sorted() }}")
        log("gate: record=${(st.get(Notices.ENROLMENT) as? Notices.Read.Found)?.text?.substringBefore('.')}")
        log("DONE"); finish()
    }

    /** Verify a raw r‖s signature against the key's certificate, as a verifier elsewhere would. */
    private fun verifyRaw(alias: String, raw: ByteArray): Boolean {
        val ks = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val pub = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(ks.getCertificate(alias).publicKey.encoded))
        fun int(b: ByteArray): ByteArray { var i = 0; while (i < b.size - 1 && b[i] == 0.toByte()) i++
            var v = b.copyOfRange(i, b.size); if (v[0].toInt() and 0x80 != 0) v = byteArrayOf(0) + v
            return byteArrayOf(0x02, v.size.toByte()) + v }
        val body = int(raw.copyOfRange(0, 32)) + int(raw.copyOfRange(32, 64))
        val der = byteArrayOf(0x30, body.size.toByte()) + body
        return Signature.getInstance("SHA256withECDSA").run { initVerify(pub); update(msg); verify(der) }
    }
}
