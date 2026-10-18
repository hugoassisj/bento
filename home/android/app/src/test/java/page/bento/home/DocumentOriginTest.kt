// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import page.bento.home.DocumentOrigin.Claim
import page.bento.home.DocumentOrigin.Decision
import page.bento.home.DocumentOrigin.Facts
import page.bento.home.DocumentOrigin.Findings
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Which storage a document is allowed to read. Each case is one way a different
 * file can arrive at a URI a document used before — the decision must never hand
 * it the previous document's storage — or one way the SAME document comes back,
 * which must keep its recovery copy and member key.
 */
class DocumentOriginTest {

    private val uri = "content://com.android.externalstorage.documents/tree/primary%3ADocuments/document/primary%3ADocuments%2Fdeck.bento.html"
    private val a = "0176ab3a-fd86-4cd6-9d1a-5339e0a3bab4"
    private val b = "7a26ddd3-da56-4f82-b303-b32d086c7000"
    private fun facts(docId: String?, sha: String = "s1") = Facts(uri, docId, sha)
    private fun claim(docId: String?, sha: String = "s1") = Claim("origin-a", docId, sha)
    private val hmac: (ByteArray) -> ByteArray = { m ->
        Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(ByteArray(32) { 7 }, "HmacSHA256")) }.doFinal(m)
    }

    // ------------------------------------------------- a different file arrives

    @Test fun `a different docId at a claimed URI gets a fresh origin`() {
        // folder index (primary:path), Downloads raw:path, and an msf: overwrite all
        // reach the decision the same way: same URI, someone else's document
        assertEquals(Decision.Fresh, DocumentOrigin.decide(facts(b), claim(a)))
    }

    @Test fun `a docless file at a URI claimed by a document gets a fresh origin`() {
        assertEquals(Decision.Fresh, DocumentOrigin.decide(facts(null), claim(a)))
    }

    @Test fun `a docless file with different bytes gets a fresh origin`() {
        assertEquals(Decision.Fresh, DocumentOrigin.decide(facts(null, "s2"), claim(null, "s1")))
    }

    @Test fun `a docId never claims a docless URI's origin, even with matching bytes`() {
        // the claim was issued for a docless instance; a docId'd file is a different case
        assertEquals(Decision.Fresh, DocumentOrigin.decide(facts(a, "s1"), claim(null, "s1")))
    }

    // ------------------------------------------------- the same document returns

    @Test fun `the same docId is reused even when the content changed`() {
        // an edit from another device, a sync, or simply the host's own save
        assertEquals(Decision.Reuse("origin-a"), DocumentOrigin.decide(facts(a, "s9"), claim(a, "s1")))
    }

    @Test fun `a docless file with exactly the recorded bytes is reused`() {
        assertEquals(Decision.Reuse("origin-a"), DocumentOrigin.decide(facts(null, "s1"), claim(null, "s1")))
    }

    // ------------------------------------------------- legacy adoption

    @Test fun `an unclaimed URI is inspected at its legacy origin first`() {
        val d = DocumentOrigin.decide(facts(a), null)
        assertEquals(Decision.InspectLegacy(DocumentOrigin.legacyOrigin(uri)), d)
    }

    @Test fun `the legacy origin is the old scheme, so existing data is found`() {
        // sha24 of the URI string — what every build before this one served
        assertEquals("08d6866eedf14858a1d1583d".length, DocumentOrigin.legacyOrigin(uri).length)
        assertEquals(DocumentOrigin.hex(DocumentOrigin.sha256(uri.toByteArray())).take(24), DocumentOrigin.legacyOrigin(uri))
    }

    @Test fun `legacy data belonging only to this docId is adopted`() {
        assertTrue(DocumentOrigin.mayAdoptLegacy(facts(a), Findings(setOf(a), false)))
        assertTrue(DocumentOrigin.mayAdoptLegacy(facts(a), Findings.EMPTY))
    }

    @Test fun `legacy data belonging to a foreign docId refuses adoption`() {
        assertFalse(DocumentOrigin.mayAdoptLegacy(facts(b), Findings(setOf(a), false)))
        assertFalse(DocumentOrigin.mayAdoptLegacy(facts(a), Findings(setOf(a, b), false)))
    }

    @Test fun `unattributable legacy data refuses adoption`() {
        assertFalse(DocumentOrigin.mayAdoptLegacy(facts(a), Findings(emptySet(), true)))
    }

    @Test fun `a docless file adopts only an empty legacy origin`() {
        assertTrue(DocumentOrigin.mayAdoptLegacy(facts(null), Findings.EMPTY))
        assertFalse(DocumentOrigin.mayAdoptLegacy(facts(null), Findings(setOf(a), false)))
    }

    // ------------------------------------------------- fresh origins

    @Test fun `fresh origins differ per docId and per docless content`() {
        val oa = DocumentOrigin.freshOrigin(facts(a), hmac)
        val ob = DocumentOrigin.freshOrigin(facts(b), hmac)
        val n1 = DocumentOrigin.freshOrigin(facts(null, "s1"), hmac)
        val n2 = DocumentOrigin.freshOrigin(facts(null, "s2"), hmac)
        assertEquals(24, oa.length)
        assertNotEquals(oa, ob); assertNotEquals(n1, n2); assertNotEquals(oa, n1)
        assertNotEquals("a fresh origin is never the legacy one", DocumentOrigin.legacyOrigin(uri), oa)
    }

    @Test fun `a fresh origin depends on the host secret, not only on the file`() {
        val other: (ByteArray) -> ByteArray = { m ->
            Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(ByteArray(32) { 9 }, "HmacSHA256")) }.doFinal(m)
        }
        assertNotEquals(DocumentOrigin.freshOrigin(facts(a), hmac), DocumentOrigin.freshOrigin(facts(a), other))
    }

    // ------------------------------------------------- reading the docId

    private fun doc(json: String) = "<html><head><script type=\"application/bento+json\" id=\"bento-doc\">$json</script></head></html>"

    @Test fun `the top-level docId is read`() {
        assertEquals(a, DocumentOrigin.extractDocId(doc("""{"format":"bento/slides","docId":"$a","title":"x"}""")))
    }

    @Test fun `a docId nested in content is ignored`() {
        val json = """{"format":"bento/slides","slides":[{"html":"{\"docId\":\"$b\"}","clip":{"docId":"$b"}}],"docId":"$a"}"""
        assertEquals(a, DocumentOrigin.extractDocId(doc(json)))
        assertNull(DocumentOrigin.extractDocId(doc("""{"slides":[{"docId":"$b"}]}""")))
    }

    @Test fun `no block, an empty block, an envelope and a malformed id all give null`() {
        assertNull(DocumentOrigin.extractDocId("<html></html>"))
        assertNull(DocumentOrigin.extractDocId(doc("\n")))
        assertNull(DocumentOrigin.extractDocId(doc("""{"format":"bento/enc","v":1,"it":300000,"salt":"x","iv":"y","data":"z"}""")))
        assertNull(DocumentOrigin.extractDocId(doc("""{"docId":""}""")))
        assertNull(DocumentOrigin.extractDocId(doc("""{"docId":"has space"}""")))
        assertNull(DocumentOrigin.extractDocId(doc("""{"docId":"../escape"}""")))
        assertNull(DocumentOrigin.extractDocId(doc("""{"docId":"${"x".repeat(129)}"}""")))
    }

    // ------------------------------------------------- every docId form the apps mint

    private val spacesId = "doc-k3x9q2ab"        // spaces: always uid('doc')
    private val dashId = "d-4fz8w1qplmz9k2"      // dash / slides without crypto.randomUUID

    @Test fun `spaces and fallback docIds are read as docIds, exactly as stored`() {
        assertEquals(spacesId, DocumentOrigin.extractDocId(doc("""{"format":"bento/spaces","docId":"$spacesId"}""")))
        assertEquals(dashId, DocumentOrigin.extractDocId(doc("""{"docId":"$dashId"}""")))
        assertEquals("Doc-MiXeD", DocumentOrigin.extractDocId(doc("""{"docId":"Doc-MiXeD"}""")))
    }

    // These go through extractDocId from real document HTML, as the host does:
    // the bug was in reading the id, so a case that hands decide() the id
    // directly would pass against the broken code.
    private fun factsOf(id: String, sha: String = "s1") =
        Facts(uri, DocumentOrigin.extractDocId(doc("""{"format":"bento/spaces","docId":"$id","title":"t"}""")), sha)

    @Test fun `a doc- id adopts its own legacy storage`() {
        assertTrue(DocumentOrigin.mayAdoptLegacy(factsOf(spacesId), Findings(setOf(spacesId), false)))
    }

    @Test fun `a d- id adopts its own legacy storage`() {
        assertTrue(DocumentOrigin.mayAdoptLegacy(factsOf(dashId), Findings(setOf(dashId), false)))
    }

    @Test fun `a successor with a different doc- id is refused`() {
        assertFalse(DocumentOrigin.mayAdoptLegacy(factsOf("doc-zzzzzzzz"), Findings(setOf(spacesId), false)))
        assertEquals(Decision.Fresh, DocumentOrigin.decide(factsOf("doc-zzzzzzzz"), Claim("o", spacesId, "s1")))
    }

    @Test fun `a doc- id keeps its claim across an external edit`() {
        // the regression: read as docless, it fell to the content hash and lost its storage
        assertEquals(Decision.Reuse("o"), DocumentOrigin.decide(factsOf(spacesId, "s2"), Claim("o", spacesId, "s1")))
    }

    @Test fun `escaped quotes and the save's u003c escaping do not derail the scan`() {
        val json = """{"title":"a \"quoted\" <b>","docId":"$a"}"""
        assertEquals(a, DocumentOrigin.extractDocId(doc(json)))
    }
}
