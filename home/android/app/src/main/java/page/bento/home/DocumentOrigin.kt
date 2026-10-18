// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import java.security.MessageDigest

/**
 * Which web origin a document runs under — and so whose localStorage, IndexedDB
 * autosave and member key it can read.
 *
 * It used to be a hash of the document's URI. But many URIs are PATHS — the
 * folder index (`primary:Documents/x.bento.html`) and the Files app's Downloads
 * view (`raw:/storage/…`) — and a Downloads `msf:` id survives an overwrite. So a
 * DIFFERENT file at the same place inherited the previous one's storage: its
 * unsaved recovery copy, its version history and this device's member key.
 * Measured on the emulator before this change.
 *
 * The origin is now a CLAIM held in a device-local index, bound to the document
 * it was issued for, and the file can never name one:
 *
 * - **docId refuses, never claims.** A document carries a docId (a UUID in its
 *   `#bento-doc` block). On EVERY open, a claim is reused only if it was issued
 *   for that same docId. A different docId at the same URI gets a fresh origin.
 *   A docId alone never selects an origin: an unknown URI never inherits
 *   another URI's claim because the docIds match.
 * - **No docId** (an encrypted envelope, or a never-saved shell): the claim is
 *   reused only if the bytes are exactly those the host last read or wrote
 *   (SHA-256 of the content). An unexplained change gets a fresh origin.
 * - **Legacy origins** (sha24 of the URI, the old scheme) are adopted for a URI
 *   with no claim yet, so existing recovery copies and member keys survive the
 *   update — but only after an inspector page running IN that origin reports
 *   no autosave record and no member key belonging to another docId.
 * - **Nothing is cleared.** An old origin's data is simply left unreachable; its
 *   owner may have moved, and wiping it would destroy their recovery copy.
 *
 * The decision is pure and runs on the JVM rig ([decide]); the Keystore, the
 * index and the inspector are the Android-side callers.
 */
object DocumentOrigin {

    /** What the host knows about the file it is about to serve. */
    data class Facts(val uri: String, val docId: String?, val contentSha256: String)

    /** One URI's claim in the device-local index. */
    data class Claim(val origin: String, val docId: String?, val contentSha256: String)

    /** What an inspector page found in a LEGACY origin's storage. */
    data class Findings(val docIdsWithData: Set<String>, val unattributedData: Boolean) {
        companion object { val EMPTY = Findings(emptySet(), false) }
    }

    sealed class Decision {
        /** Serve under this claim's origin (re-recorded with current facts). */
        data class Reuse(val origin: String) : Decision()
        /** No claim for this URI: look inside the legacy origin first. */
        data class InspectLegacy(val legacyOrigin: String) : Decision()
        /** Mint a new origin: the old one belongs to some other document. */
        object Fresh : Decision()
    }

    /** The first step, before any inspection. */
    fun decide(facts: Facts, claim: Claim?): Decision {
        if (claim == null) return Decision.InspectLegacy(legacyOrigin(facts.uri))
        return if (sameDocument(facts, claim)) Decision.Reuse(claim.origin) else Decision.Fresh
    }

    /**
     * With a docId, ONLY the docId decides: content changes are expected (another
     * device's edit, a sync) and must not lose state. Without one, only identical
     * bytes do.
     */
    fun sameDocument(facts: Facts, claim: Claim): Boolean =
        if (facts.docId != null) facts.docId == claim.docId
        else claim.docId == null && facts.contentSha256 == claim.contentSha256

    /**
     * May an unclaimed URI keep its legacy origin? Only if nothing in that
     * origin belongs to a different document. For a file with no docId, any data
     * at all is someone else's — there is nothing to attribute it to.
     */
    fun mayAdoptLegacy(facts: Facts, found: Findings): Boolean {
        if (found.unattributedData) return false
        val mine = facts.docId ?: return found.docIdsWithData.isEmpty()
        return found.docIdsWithData.all { it == mine }
    }

    /** The scheme every installed build used until now: sha24 of the URI. */
    fun legacyOrigin(uri: String): String = hex(sha256(uri.toByteArray())).take(24)

    /**
     * A new origin: HMAC(host secret, URI ‖ docId) — or ‖ the content hash when
     * the document has no docId, so two different docless files at one URI still
     * get two origins. The secret is device-local (a Keystore key), so nobody
     * else can compute it, and nothing in the file selects it.
     */
    fun freshOrigin(facts: Facts, hmac: (ByteArray) -> ByteArray): String {
        val subject = facts.uri + "\u001f" + (facts.docId ?: ("sha256:" + facts.contentSha256))
        return hex(hmac(subject.toByteArray())).take(24)
    }

    /**
     * Every form the apps mint: a UUID where `crypto.randomUUID` exists, and
     * otherwise spaces' `doc-<base36>` (always, in fact) and dash's or slides'
     * `d-<base36>…`. An earlier strict-UUID check read those as "no docId", so
     * their documents fell back to the content hash — fresh storage on every
     * external edit — and refused their own legacy storage on update.
     * Compared exactly as stored, never case-folded, the same on every host.
     */
    private val DOC_ID = Regex("^[A-Za-z0-9_-]{1,128}$")

    /**
     * The docId from the document's `#bento-doc` block, or null when there is
     * none to trust: no block, an empty block (a never-saved shell), an
     * encrypted envelope (no top-level docId), or a value outside [DOC_ID].
     *
     * Only the TOP-LEVEL `docId` key counts. Document content can carry the
     * string `"docId"` anywhere — a pasted clip, a comment — so this tracks
     * nesting depth and string state rather than searching for the text.
     */
    fun extractDocId(html: String): String? {
        val anchor = html.indexOf(" id=\"bento-doc\"")
        if (anchor < 0) return null
        val start = html.indexOf('>', anchor)
        if (start < 0) return null
        val end = html.indexOf("</script", start)
        if (end < 0) return null
        val json = html.substring(start + 1, end)
        var depth = 0
        var i = 0
        while (i < json.length) {
            val c = json[i]
            when {
                c == '"' -> {
                    val close = stringEnd(json, i) ?: return null
                    if (depth == 1) {
                        // a key at the top level: is it "docId", followed by ':' and a string?
                        val key = json.substring(i + 1, close)
                        var j = close + 1
                        while (j < json.length && json[j].isWhitespace()) j++
                        if (key == "docId" && j < json.length && json[j] == ':') {
                            j++
                            while (j < json.length && json[j].isWhitespace()) j++
                            if (j < json.length && json[j] == '"') {
                                val vEnd = stringEnd(json, j) ?: return null
                                val v = json.substring(j + 1, vEnd)
                                return if (DOC_ID.matches(v)) v else null
                            }
                            return null
                        }
                    }
                    i = close
                }
                c == '{' || c == '[' -> depth++
                c == '}' || c == ']' -> depth--
            }
            i++
        }
        return null
    }

    /** Index of the closing quote of the string opening at [open], honouring escapes. */
    private fun stringEnd(s: String, open: Int): Int? {
        var k = open + 1
        while (k < s.length) {
            when (s[k]) {
                '\\' -> k += 2
                '"' -> return k
                else -> k++
            }
        }
        return null
    }

    fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)
    fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

    /**
     * The inspector, served AT the legacy origin before anything else runs there.
     * It reports which docIds own data — autosave recovery and version records,
     * and `bento-member-<docId>` keys — and whether anything else is present that
     * cannot be attributed. It only reads: it opens only databases that already
     * exist, so looking does not create one.
     */
    const val INSPECTOR_PATH = "/.bento-host-inspect"
    val INSPECTOR_HTML = """<!doctype html><meta charset="utf-8"><script>
(async () => {
  // docIds that own data here, and whether anything could not be attributed.
  // Reads KEYS only (key cursors), never record bodies.
  const ids = new Set(); let unattributed = false
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  // every key a cursor yields, as a docId; a non-string key is unattributable
  const keysOf = (source, primary) => new Promise((res, rej) => {
    const r = source.openKeyCursor()
    r.onerror = () => rej(r.error)
    r.onsuccess = () => {
      const c = r.result
      if (!c) return res()
      const k = primary ? c.primaryKey : c.key
      if (typeof k === 'string') ids.add(k); else unattributed = true
      c.continue()
    }
  })
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const m = /^bento-member-(.+)${'$'}/.exec(localStorage.key(i))
      if (m) ids.add(m[1])
    }
  } catch (e) { unattributed = true }
  try {
    // No way to list databases means no way to know what is here: that is
    // unattributable, never "empty". Only names that already exist are
    // opened, at their own version, so looking never creates a database.
    if (!indexedDB.databases) throw new Error('cannot list databases')
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue
      const db = await req(indexedDB.open(name))
      for (const st of Array.from(db.objectStoreNames)) {
        const store = db.transaction(st).objectStore(st)
        if (/-autosave${'$'}/.test(name) && st === 'recovery') await keysOf(store, true)          // keyPath docId
        else if (/-autosave${'$'}/.test(name) && st === 'versions' && store.indexNames.contains('docId'))
          await keysOf(store.index('docId'), false)                                            // the docId index
        else if (name === 'bento-handles') await keysOf(store, true)                           // keyed by docId
        // Anything else that holds records cannot be tied to a document —
        // including bento-blobcache, which caches live-session media in
        // PLAINTEXT (sync/blobs.ts), so adopting it would hand a successor the
        // previous document's images. An empty store is harmless.
        else if (await req(store.count()) > 0) unattributed = true
      }
      db.close()
    }
  } catch (e) { unattributed = true }
  __bentoInspect.postMessage(JSON.stringify({ docIds: [...ids], unattributed }))
})()
</script>"""
}
