// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * The device-local half of [DocumentOrigin]: which origin each URI was issued,
 * and the secret new origins are derived from.
 *
 * Both live only on this device and travel with no file, which is the point:
 * nothing a document carries can select or reproduce an origin. The index is a
 * cache of claims, like [Recents] is a cache of grants — losing it (clear
 * storage) also loses every origin's data, so nothing is stranded.
 */
object OriginIndex {
    private const val TAG = "BentoTray"
    private const val PREFS = "doc-origins"
    private const val KEY_ALIAS = "bento-origin-hmac"

    fun claim(c: Context, uri: String): DocumentOrigin.Claim? {
        val raw = prefs(c).getString(uri, null) ?: return null
        return try {
            val o = JSONObject(raw)
            DocumentOrigin.Claim(
                origin = o.getString("o"),
                docId = if (o.isNull("d")) null else o.getString("d"),
                contentSha256 = o.getString("h"),
            )
        } catch (e: Exception) {
            // An unreadable claim is no claim: the open falls back to inspection,
            // which refuses anything that is not this document's.
            Log.w(TAG, "unreadable origin claim", e); null
        }
    }

    fun record(c: Context, uri: String, claim: DocumentOrigin.Claim) {
        val o = JSONObject().put("o", claim.origin).put("h", claim.contentSha256)
            .put("d", claim.docId ?: JSONObject.NULL)
        prefs(c).edit().putString(uri, o.toString()).apply()
    }

    /**
     * HMAC-SHA256 under a key that never leaves the Keystore. If the Keystore
     * cannot be used on this device, a random secret in no-backup app storage
     * stands in: still device-local, still never in a file a document carries.
     */
    fun hmac(c: Context, message: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(keystoreKey() ?: fallbackKey(c))
        return mac.doFinal(message)
    }

    private fun keystoreKey(): SecretKey? = try {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey) ?: KeyGenerator
            .getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore")
            .apply { init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN).build()) }
            .generateKey()
    } catch (e: Exception) {
        Log.w(TAG, "Keystore HMAC key unavailable; using the app-private secret", e); null
    }

    private fun fallbackKey(c: Context): SecretKey {
        val f = File(c.noBackupFilesDir, "origin-secret")
        val bytes = if (f.length() == 32L) f.readBytes()
                    else ByteArray(32).also { SecureRandom().nextBytes(it); f.writeBytes(it) }
        return SecretKeySpec(bytes, "HmacSHA256")
    }

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
