// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The host's per-document store for `kernel/src/docstore.ts`: a document's
 * crash-recovery copy ('recovery') and this device's member key for it
 * ('memberkey').
 *
 * Without it, the kernel keeps both in the page's own web storage, so the
 * member PRIVATE key sits wherever that origin's data does. Here it leaves the
 * web layer altogether:
 *
 * - **Partitioned by the document's claim** ([DocumentOrigin]), the same
 *   identity that chooses its origin — never by a path, a URI or anything the
 *   page names. A different file at a reused path gets a different claim and
 *   so an empty store.
 * - **Encrypted at rest** with AES-GCM under a key that never leaves the
 *   Android Keystore, in no-backup app storage: not readable by other apps,
 *   not in a backup, not usable on another device.
 * - **Two names only.** Anything else is refused, so the store can never become
 *   a general key-value channel a page could fill.
 * - **Bounded.** A recovery copy is the whole document; one over [MAX_BYTES]
 *   is refused rather than held in memory twice over in base64.
 *
 * Calls run on the caller's ordered executor, so a write followed by a read
 * always sees the write.
 */
class DocStore(context: Context, private val claim: String) {
    companion object {
        val NAMES = setOf("recovery", "memberkey")
        const val MAX_BYTES = 64 * 1024 * 1024
        private const val KEY_ALIAS = "bento-docstore"
        private const val IV_BYTES = 12
        private const val TAG_BYTES = 16
        private val CLAIM = Regex("^[0-9a-f]{24}$")
    }

    private val dir: File = File(context.noBackupFilesDir, "docstore/$claim")

    init {
        // The claim names a directory, so it must be exactly what DocumentOrigin
        // mints and nothing a crafted value could turn into a path.
        require(CLAIM.matches(claim)) { "not a document claim" }
    }

    class Refused(reason: String) : Exception(reason)

    private fun file(name: String): File {
        if (name !in NAMES) throw Refused("refused")
        return File(dir, "$name.bin")
    }

    fun get(name: String): ByteArray? {
        val f = file(name)
        if (!f.exists()) return null
        val blob = f.readBytes()
        // Shorter than an IV plus a GCM tag cannot be an entry we wrote — the
        // atomic rename rules out a torn write, so this is corruption. Absent,
        // for the same reason a failed tag is: anything else would read as
        // "unavailable" and wedge the member identity. (A Keystore or I/O fault
        // still propagates as unavailable, so a transient one never overwrites a
        // good key.)
        if (blob.size < IV_BYTES + TAG_BYTES) return null
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BYTES * 8, blob, 0, IV_BYTES))
        c.updateAAD(boundTo(name))
        return try {
            c.doFinal(blob, IV_BYTES, blob.size - IV_BYTES)
        } catch (e: javax.crypto.AEADBadTagException) {
            // An entry that fails authentication holds nothing usable, so it
            // reads as ABSENT, not as an unanswered request. The kernel treats a
            // store that cannot answer as blind and refuses to mint a member key
            // while blind — so "unavailable" here would wedge this document's
            // member identity for good. Left on disk; the next write replaces it.
            android.util.Log.w("BentoTray", "store entry $name failed authentication; reading as absent")
            null
        }
    }

    fun set(name: String, bytes: ByteArray) {
        val f = file(name)
        if (bytes.size > MAX_BYTES) throw Refused("too-large")
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        c.updateAAD(boundTo(name))
        dir.mkdirs()
        // Written beside, then renamed over: a crash mid-write leaves the old
        // entry, never a truncated one that would fail to decrypt.
        val tmp = File(dir, "$name.tmp")
        tmp.writeBytes(c.iv + c.doFinal(bytes))
        if (!tmp.renameTo(f)) { tmp.delete(); throw Refused("unavailable") }
    }

    fun list(): List<String> = NAMES.filter { File(dir, "$it.bin").exists() }.sorted()

    fun delete(name: String): Boolean {
        val f = file(name)
        return !f.exists() || f.delete()
    }

    /**
     * Authenticated with each entry: which document it belongs to and which
     * entry it is. An entry file copied into another document's directory, or
     * renamed from recovery to memberkey, then fails authentication instead of
     * decrypting as that document's — the directory layout is not trusted to
     * say whose a ciphertext is.
     */
    private fun boundTo(name: String) = "bento-docstore\u001f$claim\u001f$name".toByteArray()

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build())
        }.generateKey()
    }
}
