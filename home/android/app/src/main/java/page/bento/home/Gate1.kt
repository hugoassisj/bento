// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

package page.bento.home

import java.security.MessageDigest
import java.util.Base64

/**
 * GATE 1 on Android: is this file's runtime a genuine Bento release? The Kotlin
 * port of kernel/src/gate1.ts, served path only (bento/connect A2). Android
 * always SERVES the bytes it verified, so the file:// strict path never applies
 * here. home/fixtures/gate1 is the contract, and Gate1Test runs every row of it.
 *
 * The scanner mirrors the reference's JavaScript regex semantics exactly, which
 * is where ports drift:
 *   - JS `\s` is Unicode whitespace; Java's is ASCII. Spelled out as [WS].
 *   - JS `\b` is an ASCII word boundary; Java's is Unicode-aware. Spelled out.
 *   - JS `$` without /m is end of input; Java's also matches before a final
 *     newline. `\z` here.
 *   - JS /i without /u never folds non-ASCII to ASCII; Java's default
 *     CASE_INSENSITIVE is ASCII-only. They agree.
 *
 * "Unknown" is never "tampered": not provably one of ours. The host shows the
 * document without identity, and never borrows a release's CSP for it.
 */
object Gate1 {
    /** JavaScript's `\s`, written out. */
    private const val WS = "\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"

    // ---- the release history ----------------------------------------------------------

    class Pins(val loader: String, val remover: String?, val rt: String, val rtCss: String, val scriptSrc: List<String>)
    class Entry(val version: String, val sha256: String, val pins: Pins, val raw: Any?)
    class History(val app: String, val releases: List<Entry>)

    // ---- the scanner ----------------------------------------------------------------------

    class Block(val tag: String, val attrs: String, val text: String,
                val type: String?, val id: String?, val src: String?, val preview: Boolean)

    private val attrCache = HashMap<String, Regex>()
    private fun attr(attrs: String, name: String): String? {
        val re = attrCache.getOrPut(name) {
            // "/" separates attributes as whitespace does (the HTML tokenizer's
            // before-attribute-name state): `<script /type="text/javascript"
            // type="application/bento+json">` RUNS, because the first type wins.
            Regex("(?:^|[$WS/])${Regex.escape(name)}(?:[$WS]*=[$WS]*(?:\"([^\"]*)\"|'([^']*)'|([^$WS\"'>]+)))?(?=[$WS/]|\\z)",
                RegexOption.IGNORE_CASE)
        }
        val m = re.find(attrs) ?: return null
        return m.groups[1]?.value ?: m.groups[2]?.value ?: m.groups[3]?.value ?: ""
    }

    private val OPEN = Regex("<(script|style)(?![A-Za-z0-9_])([^>]*)>", RegexOption.IGNORE_CASE)

    class Malformed(message: String) : Exception(message)

    /** Every <script> and <style> element, with its raw text: to the first `</script` / `</style`, any case. */
    fun scanBlocks(html: String): List<Block> {
        val out = ArrayList<Block>()
        val lower = html.lowercase()
        var from = 0
        while (true) {
            val m = OPEN.find(html, from) ?: break
            val tag = m.groupValues[1].lowercase()
            val start = m.range.last + 1
            val close = lower.indexOf("</$tag", start)
            if (close < 0) throw Malformed("gate1: unterminated <$tag> at ${m.range.first}")
            val attrs = m.groupValues[2]
            out += Block(tag, attrs, html.substring(start, close),
                attr(attrs, "type"), attr(attrs, "id"), attr(attrs, "src"), attr(attrs, "data-bento-preview") != null)
            from = close
        }
        return out
    }

    // ---- the grammar (security, 2026-10-21) ---------------------------------------------

    /** The ONLY inert script types, case-sensitive. Everything else is executable. */
    val DATA_TYPES = setOf("application/bento+json", "application/bento+lang", "bento/deflate-b64", "bento/deflate-b86")

    fun isDataScript(b: Block) = b.tag == "script" && b.src == null && b.type != null && b.type in DATA_TYPES
    private fun executable(blocks: List<Block>) = blocks.filter { it.tag == "script" && !isDataScript(it) }

    private val TAG_NAME = Regex("^<([a-zA-Z][a-zA-Z0-9-]*)")
    private val META_BAD = Regex("http-equiv[$WS]*=[$WS]*[\"']?[$WS]*(refresh|content-security-policy)", RegexOption.IGNORE_CASE)
    private val ON_ATTR = Regex("(^|[$WS\"'/])on[a-z0-9_-]*[$WS]*=", RegexOption.IGNORE_CASE)

    /** Markup a genuine Bento file never carries, outside a script or style element's own text. [] = none. */
    fun markupProblems(html: String): List<String> {
        val problems = ArrayList<String>()
        val lower = html.lowercase()
        var i = 0
        while (true) {
            i = html.indexOf('<', i)
            if (i == -1) break
            if (html.startsWith("<!--", i)) {
                val end = html.indexOf("-->", i + 4)
                val body = lower.substring(i + 4, if (end < 0) html.length else end)
                if (body.contains("<script")) problems += "a comment holds a <script>"
                if (end < 0) { problems += "an unterminated comment"; break }
                i = end + 3; continue
            }
            val m = TAG_NAME.find(html.substring(i, minOf(html.length, i + 64)))
            if (m == null) { i++; continue }
            val name = m.groupValues[1].lowercase()
            var j = i + m.value.length
            var q: Char? = null
            while (j < html.length) {
                val c = html[j]
                if (q != null) { if (c == q) q = null }
                else if (c == '"' || c == '\'') q = c
                else if (c == '>') break
                j++
            }
            val attrs = html.substring(i + m.value.length, j)
            if (name in setOf("iframe", "object", "embed", "base")) problems += "a <$name>"
            if (name == "meta" && META_BAD.containsMatchIn(attrs)) problems += "a <meta> refresh or CSP"
            if (ON_ATTR.containsMatchIn(attrs)) problems += "an on*= attribute on <$name>"
            if (name == "script" || name == "style") {
                val close = lower.indexOf("</$name", j)
                if (close < 0) { problems += "an unterminated <$name>"; break }
                if (name == "style" && lower.substring(j, close).contains("<script")) problems += "a <style> holds a <script>"
                i = close + 2; continue
            }
            i = j + 1
        }
        for (b in scanBlocks(html)) if (isDataScript(b) && b.text.contains('<')) problems += "the ${b.type} block contains \"<\""
        return problems
    }

    // ---- hashing ---------------------------------------------------------------------------

    private fun digest(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
    /** sha256 HEX of a string's UTF-8: every `blocks` pin. */
    fun sha256hex(s: String): String = digest(s).joinToString("") { "%02x".format(it.toInt() and 0xff) }
    /** 'sha256-' + BASE64: every `scriptSrc` pin, the CSP form. Never compare it to a hex pin. */
    fun cspHash(s: String): String = "sha256-" + Base64.getEncoder().encodeToString(digest(s))

    /** Problems of a file against ONE release's pins; [] = this release's file. */
    fun checkAgainstPins(html: String, pins: Pins): List<String> {
        val problems = ArrayList(markupProblems(html))
        val blocks = scanBlocks(html)
        for ((id, pin) in listOf("bento-rt" to pins.rt, "bento-rt-css" to pins.rtCss)) {
            val found = blocks.filter { it.id == id }
            if (found.size != 1) problems += "${found.size} #$id blocks (exactly one expected)"
            else if (sha256hex(found[0].text) != pin) problems += "#$id does not match"
        }
        val exec = executable(blocks)
        val hashes = exec.map { sha256hex(it.text) }
        val allowed = setOfNotNull(pins.loader, pins.remover)
        exec.forEachIndexed { k, s ->
            if (s.src != null || hashes[k] !in allowed)
                problems += "an executable script that is neither the pinned loader nor the remover (${if (s.src != null) "src=" + s.src else "${s.text.length}B"})"
        }
        val loaders = hashes.count { it == pins.loader }
        if (loaders == 0) problems += "no pinned loader"
        if (loaders > 1) problems += "more than one loader"
        if (pins.remover != null && hashes.count { it == pins.remover } > 1) problems += "more than one remover"
        return problems
    }

    // ---- the release history ------------------------------------------------------------

    private val SEMVER = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)\\z")
    fun cmpVersion(a: String, b: String): Int {
        val x = SEMVER.find(a) ?: throw Malformed("gate1: not a version: $a")
        val y = SEMVER.find(b) ?: throw Malformed("gate1: not a version: $b")
        for (i in 1..3) {
            val d = x.groupValues[i].toBigInteger().compareTo(y.groupValues[i].toBigInteger())
            if (d != 0) return d
        }
        return 0
    }

    private val HEX64 = Regex("^[0-9a-f]{64}\\z")

    /** One parsed entry, or null if malformed (the reference's entryOk). */
    private fun entryOf(raw: Any?): Entry? {
        val e = raw as? Map<*, *> ?: return null
        val version = e["version"] as? String ?: return null
        if (!SEMVER.matches(version)) return null
        val sha = e["sha256"] as? String ?: return null
        if (!HEX64.matches(sha)) return null
        if (e["at"] !is String) return null
        val pins = e["pins"] as? Map<*, *> ?: return null
        if (pins["v"] != 1.0) return null
        val blocks = pins["blocks"] as? Map<*, *> ?: return null
        // the reference only checks that blocks is an object; a block pin it
        // can't read never matches, so a missing one is null here, not a refusal
        val str = { k: String -> blocks[k] as? String }
        val src = (pins["scriptSrc"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
        return Entry(version, sha, Pins(str("loader") ?: "", str("remover"), str("bento-rt") ?: "", str("bento-rt-css") ?: "", src), raw)
    }

    /** A parsed payload's shape problems; [] = well-formed (versions unique, newest first). */
    fun historyProblems(h: Any?): List<String> {
        val p = ArrayList<String>()
        val o = h as? Map<*, *>
        if (o == null || o["v"] != 1.0) p += "version ${o?.get("v")} (expected 1)"
        val app = o?.get("app")
        if (app !is String || app.isEmpty()) p += "no app"
        val rel = o?.get("releases") as? List<*>
        if (rel == null) { p += "no releases"; return p }
        val seen = HashSet<String>()
        var prev: Entry? = null
        rel.forEachIndexed { i, raw ->
            val e = entryOf(raw)
            if (e == null) { p += "entry $i is malformed"; prev = null; return@forEachIndexed }
            if (!seen.add(e.version)) p += "version ${e.version} appears twice"
            val pr = prev
            if (i > 0 && pr != null && cmpVersion(pr.version, e.version) <= 0) p += "entries are not newest-first at ${e.version}"
            prev = e
        }
        return p
    }

    /** A well-formed payload as a History, or null. */
    fun historyOf(h: Any?): History? {
        if (historyProblems(h).isNotEmpty()) return null
        val o = h as Map<*, *>
        return History(o["app"] as String, (o["releases"] as List<*>).map { entryOf(it)!! })
    }

    sealed class Accept {
        object Ok : Accept()
        class No(val reason: String) : Accept()
    }

    /**
     * ANTI-ROLLBACK: accept an incoming, signature-verified history given the one
     * held. Refuses one that lacks a held entry, changes one (compared as JSON
     * text in source key order, as the reference's JSON.stringify does), or rolls
     * the newest version back.
     */
    fun acceptHistory(held: Any?, incoming: Any?, app: String): Accept {
        val problems = historyProblems(incoming)
        if (problems.isNotEmpty()) return Accept.No("malformed: ${problems[0]}")
        val inc = historyOf(incoming)!!
        if (inc.app != app) return Accept.No("for ${inc.app}, not $app")
        if (held == null) return Accept.Ok
        val h = historyOf(held) ?: return Accept.No("the held history is malformed")
        if (inc.releases.isEmpty() || (h.releases.isNotEmpty() && cmpVersion(inc.releases[0].version, h.releases[0].version) < 0))
            return Accept.No("rollback: its newest release is older than the newest already held")
        for (e in h.releases) {
            val there = inc.releases.firstOrNull { it.version == e.version }
                ?: return Accept.No("rollback: it lacks ${e.version}, which is already held")
            if (Json.write(there.raw) != Json.write(e.raw)) return Accept.No("${e.version} changed: a history never changes an entry")
        }
        return Accept.Ok
    }

    /** The ONE entry matching every block of the file, or null (none or several: UNKNOWN). */
    fun matchRelease(history: History, html: String): Entry? {
        val rt = scanBlocks(html).filter { it.id == "bento-rt" }
        if (rt.size != 1) return null
        val rtHash = sha256hex(rt[0].text)
        val full = history.releases.filter { it.pins.rt == rtHash && checkAgainstPins(html, it.pins).isEmpty() }
        return full.singleOrNull()
    }

    // ---- the signed envelope ----------------------------------------------------------------

    /**
     * Verify a `{ payload, sig }` envelope (ECDSA P-256 SHA-256, raw r‖s, base64)
     * against a public key given as JWK x/y, and return the parsed payload — or
     * null. The signature covers the EXACT payload string; it is parsed only after.
     * The same envelope and key handling as Releases.verify, without org.json.
     */
    fun verifyEnvelope(raw: String, keyX: String, keyY: String): Any? = try {
        val env = Json.read(raw) as? Map<*, *>
        val payload = env?.get("payload") as? String
        val sig = env?.get("sig") as? String
        if (payload.isNullOrEmpty() || sig.isNullOrEmpty()) null else {
            val params = java.security.AlgorithmParameters.getInstance("EC").apply {
                init(java.security.spec.ECGenParameterSpec("secp256r1"))
            }.getParameterSpec(java.security.spec.ECParameterSpec::class.java)
            val dec = Base64.getUrlDecoder()
            val point = java.security.spec.ECPoint(java.math.BigInteger(1, dec.decode(keyX)), java.math.BigInteger(1, dec.decode(keyY)))
            val key = java.security.KeyFactory.getInstance("EC").generatePublic(java.security.spec.ECPublicKeySpec(point, params))
            val rs = Base64.getMimeDecoder().decode(sig)
            val ok = rs.size == 64 && java.security.Signature.getInstance("SHA256withECDSA").run {
                initVerify(key); update(payload.toByteArray(Charsets.UTF_8)); verify(derOf(rs))
            }
            if (ok) Json.read(payload) else null
        }
    } catch (e: Exception) { null }

    /** Raw r‖s → DER, for Java's SHA256withECDSA. */
    private fun derOf(raw: ByteArray): ByteArray {
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

    // ---- the served path --------------------------------------------------------------------

    /** The CSP a verified document is served under, byte-identical to the reference's hostPolicy. */
    fun hostPolicy(pins: Pins, frameAncestors: String = "'none'"): String = listOf(
        "default-src 'none'",
        "script-src ${pins.scriptSrc.joinToString(" ") { "'$it'" }} blob:",
        "style-src 'unsafe-inline'",
        "img-src data: blob: https:",
        "media-src data: blob: https:",
        "font-src data: blob:",
        "connect-src https://bento.page https://sync.bento.page wss://sync.bento.page",
        "frame-src https:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "worker-src 'none'",
        "frame-ancestors $frameAncestors",
    ).joinToString("; ")

    sealed class Verdict {
        class Genuine(val release: Entry, val csp: String) : Verdict()
        class Unknown(val reason: String) : Verdict()
    }

    /** THE served-path gate. The history must already have passed the signature check and acceptHistory. */
    fun verifyServed(html: String, history: History, frameAncestors: String = "'none'"): Verdict = try {
        val release = matchRelease(history, html)
        if (release == null) {
            val markup = markupProblems(html)
            Verdict.Unknown(if (markup.isNotEmpty()) markup[0] else "no single release matches every block")
        } else Verdict.Genuine(release, hostPolicy(release.pins, frameAncestors))
    } catch (e: Malformed) {
        Verdict.Unknown(e.message ?: "malformed")
    }
}

/**
 * A minimal JSON reader that KEEPS key order (LinkedHashMap), and a writer that
 * mirrors JSON.stringify for what a history holds. Order matters: the reference
 * decides "an entry changed" by comparing JSON text. Numbers read as Double.
 * Strict: anything else is Gate1.Malformed.
 */
object Json {
    fun read(s: String): Any? {
        val p = P(s); p.ws(); val v = p.value(); p.ws()
        if (p.i != s.length) throw Gate1.Malformed("json: trailing data at ${p.i}")
        return v
    }

    private class P(val s: String) {
        var i = 0
        fun ws() { while (i < s.length && s[i] in " \t\n\r") i++ }
        fun fail(): Nothing = throw Gate1.Malformed("json: unexpected input at $i")
        fun value(): Any? {
            if (i >= s.length) fail()
            return when (s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> lit("true", true)
                'f' -> lit("false", false)
                'n' -> lit("null", null)
                else -> num()
            }
        }
        fun lit(w: String, v: Any?): Any? { if (!s.startsWith(w, i)) fail(); i += w.length; return v }
        fun obj(): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>(); i++; ws()
            if (i < s.length && s[i] == '}') { i++; return m }
            while (true) {
                ws(); if (i >= s.length || s[i] != '"') fail()
                val k = str(); ws(); if (i >= s.length || s[i] != ':') fail(); i++; ws()
                m[k] = value(); ws()
                if (i < s.length && s[i] == ',') { i++; continue }
                if (i < s.length && s[i] == '}') { i++; return m }
                fail()
            }
        }
        fun arr(): List<Any?> {
            val a = ArrayList<Any?>(); i++; ws()
            if (i < s.length && s[i] == ']') { i++; return a }
            while (true) {
                ws(); a += value(); ws()
                if (i < s.length && s[i] == ',') { i++; continue }
                if (i < s.length && s[i] == ']') { i++; return a }
                fail()
            }
        }
        fun str(): String {
            val b = StringBuilder(); i++
            while (true) {
                if (i >= s.length) fail()
                val c = s[i++]
                when {
                    c == '"' -> return b.toString()
                    c == '\\' -> {
                        if (i >= s.length) fail()
                        when (val e = s[i++]) {
                            '"', '\\', '/' -> b.append(e)
                            'b' -> b.append('\b'); 'f' -> b.append('\u000c'); 'n' -> b.append('\n')
                            'r' -> b.append('\r'); 't' -> b.append('\t')
                            'u' -> { if (i + 4 > s.length) fail(); b.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
                            else -> fail()
                        }
                    }
                    c < ' ' -> fail()
                    else -> b.append(c)
                }
            }
        }
        fun num(): Double {
            val m = Regex("-?(0|[1-9]\\d*)(\\.\\d+)?([eE][+-]?\\d+)?").matchAt(s, i) ?: fail()
            i += m.value.length
            return m.value.toDouble()
        }
    }

    /** JSON.stringify's output for these values, keys in their stored order. */
    fun write(v: Any?): String = StringBuilder().also { w(v, it) }.toString()
    private fun w(v: Any?, b: StringBuilder) {
        when (v) {
            null -> b.append("null")
            is Boolean -> b.append(v)
            is Double -> b.append(if (v == Math.floor(v) && !v.isInfinite() && Math.abs(v) < 1e21) v.toLong().toString() else v.toString())
            is String -> {
                b.append('"')
                for (c in v) when {
                    c == '"' -> b.append("\\\""); c == '\\' -> b.append("\\\\")
                    c == '\n' -> b.append("\\n"); c == '\r' -> b.append("\\r"); c == '\t' -> b.append("\\t")
                    c == '\b' -> b.append("\\b"); c == '\u000c' -> b.append("\\f")
                    c < ' ' -> b.append("\\u%04x".format(c.code))
                    else -> b.append(c)
                }
                b.append('"')
            }
            is Map<*, *> -> { b.append('{'); var first = true
                for ((k, x) in v) { if (!first) b.append(','); first = false; w(k as String, b); b.append(':'); w(x, b) }
                b.append('}') }
            is List<*> -> { b.append('['); v.forEachIndexed { n, x -> if (n > 0) b.append(','); w(x, b) }; b.append(']') }
            else -> throw Gate1.Malformed("json: cannot write ${v::class.java.simpleName}")
        }
    }
}
