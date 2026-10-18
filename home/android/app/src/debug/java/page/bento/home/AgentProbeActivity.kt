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
    private val msg = "bento/id probe".toByteArray()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.getStringExtra("mode") == "window") { windowProbe(); return }
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
            .setTitle("bento/id probe").setSubtitle("Approve a consent signature")
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
