// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Gate1.kt against home/fixtures/gate1: every served row, the ambiguous row,
 * the signed history (verified with the corpus's TEST key, as the host verifies
 * the release key), and anti-rollback. The strict file:// rows are not Android's:
 * this host always serves the bytes it verified. The CSP is compared byte for
 * byte with kernel/src/gate1.ts's own, run under Node.
 */
class Gate1Test {
    private val dir = File("../../../home/fixtures/gate1")
    private fun read(p: String) = File(dir, p).readText()
    private val expected = Json.read(read("expected.json")) as Map<*, *>
    private val key = Json.read(read("test-public-key.json")) as Map<*, *>
    private val payload by lazy {
        Gate1.verifyEnvelope(read("history.json"), key["x"] as String, key["y"] as String)
            ?: error("history.json must verify under the test key")
    }
    private val history by lazy { Gate1.historyOf(payload)!! }
    @Suppress("UNCHECKED_CAST") private fun rows(k: String) = expected[k] as List<Map<String, Any?>>

    @Test fun `the signed history verifies, and a tampered payload does not`() {
        val app = expected["app"] as String
        assertEquals(app, history.app)
        assertTrue(Gate1.historyProblems(payload).isEmpty())
        val env = Json.read(read("history.json")) as Map<*, *>
        val tampered = Json.write(mapOf("payload" to (env["payload"] as String).replaceFirst("1.0.0", "1.0.1"), "sig" to env["sig"]))
        assertNull(Gate1.verifyEnvelope(tampered, key["x"] as String, key["y"] as String))
        assertNull("another key refuses it", Gate1.verifyEnvelope(read("history.json"),
            "GMHSKwWcAoJVq-Dz1ZxWZM6TXATWIKbaQBpjoTystH8", "flFNzbdXCmJN8RQYCeG71rBZnnbN-MCEnp1EbCLFrj0"))
    }

    @Test fun `every served row reaches its verdict, genuine ones under their own pins`() {
        val served = rows("served")
        assertEquals("the corpus (51 served rows at #825's head)", 51, served.size)
        var genuine = 0
        for (row in served) {
            val v = Gate1.verifyServed(read(row["case"] as String), history)
            val got = if (v is Gate1.Verdict.Genuine) "genuine ${v.release.version}" else "unknown"
            val want = if (row["verdict"] == "genuine") "genuine ${row["release"]}" else "unknown"
            assertEquals("${row["case"]} (${row["why"]})" + if (v is Gate1.Verdict.Unknown) " — ${v.reason}" else "", want, got)
            if (v is Gate1.Verdict.Genuine) {
                genuine++
                assertTrue(v.csp.startsWith("default-src 'none'"))
                assertTrue(v.csp.contains("'${v.release.pins.scriptSrc[0]}'"))
                assertFalse(v.csp.contains("unsafe-eval"))
            }
        }
        assertTrue("the corpus has genuine rows", genuine >= 4)
    }

    @Test fun `two entries matching every block is UNKNOWN, never the first`() {
        for (row in rows("ambiguous")) {
            val h = Gate1.historyOf(row["history"])!!
            val v = Gate1.verifyServed(read(row["case"] as String), h)
            assertEquals(row["case"] as String, row["verdict"], if (v is Gate1.Verdict.Genuine) "genuine" else "unknown")
        }
    }

    @Test fun `anti-rollback`() {
        val app = expected["app"] as String
        val hist = rows("history")
        assertEquals(8, hist.size)
        for (row in hist)
            assertEquals("${row["name"]}: ${row["why"]}", row["ok"], Gate1.acceptHistory(row["held"], row["incoming"], app) is Gate1.Accept.Ok)
    }

    @Test fun `the CSP is byte-identical to the reference's hostPolicy`() {
        val script = """
            const { hostPolicy } = await import(process.argv[1])
            const env = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'))
            process.stdout.write(hostPolicy(JSON.parse(env.payload).releases[0].pins))
        """.trimIndent()
        val proc = ProcessBuilder("node", "--input-type=commonjs", "-e",
            "(async () => { $script })().catch(e => { console.error(e); process.exit(1) })",
            File("../../../kernel/src/gate1.ts").absolutePath, File(dir, "history.json").absolutePath)
            .redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val ref = proc.inputStream.bufferedReader().readText()
        assertEquals("node must run (this check never skips)", 0, proc.waitFor())
        assertEquals(ref, Gate1.hostPolicy(history.releases[0].pins))
    }

    @Test fun `hashes use the right encoding for each field`() {
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", Gate1.sha256hex(""))
        assertEquals("sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=", Gate1.cspHash(""))
    }

    @Test fun `the JSON writer matches JSON_stringify on key order and numbers`() {
        val s = """{"b":1,"a":[true,null,"x\"y"],"c":{"z":2.5,"y":-3}}"""
        assertEquals(s, Json.write(Json.read(s)))
        assertTrue(Json.write(Json.read("""{"a":1,"b":2}""")) != Json.write(Json.read("""{"b":2,"a":1}""")))
    }
}
