// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

import CryptoKit
import Foundation

/// GATE 1: is this file's runtime a genuine Bento release? A Swift port of
/// kernel/src/gate1.ts (bento/connect K5), held to every row of the conformance
/// corpus in home/fixtures/gate1/ by scripts/test-home-gate1.mjs.
///
/// The port copies the reference's RULES, not this platform's parsers. It works
/// on UTF-16 code units, as a JavaScript string does, so every index, slice and
/// search lands where the reference's would. Its "regular expressions" are
/// written out by hand with JavaScript's `\s` set and ASCII-only case folding.
/// That's what the corpus's scanner-split rows are there to catch.
///
/// - `verifyServed` is this host's path, since it serves the bytes it verified:
///   one release in the signed history must match EVERY block, and the answer
///   comes with the hash-pinned CSP to serve the file under.
/// - `verifyStrict` is the file:// fallback, ported so the corpus holds it too.
///   It only ever gives a result, never grounds for identity (security §16).
/// - `acceptHistory` is anti-rollback for an incoming, signature-checked history.
///
/// "Unknown" is never "tampered": the file is shown without identity.
enum Gate1 {
    typealias S = [UInt16]

    // MARK: - JavaScript string semantics over UTF-16

    static func u(_ s: String) -> S { Array(s.utf16) }
    static func str(_ s: S) -> String { String(decoding: s, as: UTF16.self) }

    /// JavaScript's `\s`
    static func isSpace(_ c: UInt16) -> Bool {
        switch c {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default: return false
        }
    }
    /// `\w` without the u flag
    static func isWord(_ c: UInt16) -> Bool {
        (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F
    }
    /// the i flag without u: only ASCII letters fold
    static func fold(_ c: UInt16) -> UInt16 { (c >= 0x41 && c <= 0x5A) ? c + 32 : c }
    static func isLetter(_ c: UInt16) -> Bool { (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) }
    static func isDigit(_ c: UInt16) -> Bool { c >= 0x30 && c <= 0x39 }

    /// does `h` hold `word` (lowercase ASCII) at `at`, case-insensitively?
    static func ci(_ h: S, _ at: Int, _ word: S) -> Bool {
        guard at >= 0, at + word.count <= h.count else { return false }
        for k in 0..<word.count where fold(h[at + k]) != word[k] { return false }
        return true
    }
    static func at(_ h: S, _ i: Int, _ n: S) -> Bool {
        guard i >= 0, i + n.count <= h.count else { return false }
        for k in 0..<n.count where h[i + k] != n[k] { return false }
        return true
    }
    /// String.prototype.indexOf
    static func indexOf(_ h: S, _ n: S, _ from: Int = 0) -> Int {
        var i = max(0, from)
        if n.isEmpty { return min(i, h.count) }
        while i + n.count <= h.count { if at(h, i, n) { return i }; i += 1 }
        return -1
    }
    /// String.prototype.lastIndexOf
    static func lastIndexOf(_ h: S, _ n: S, _ from: Int) -> Int {
        var i = min(max(from, 0), h.count - n.count)
        while i >= 0 { if at(h, i, n) { return i }; i -= 1 }
        return -1
    }
    /// String.prototype.slice, negative indexes included
    static func slice(_ h: S, _ a: Int, _ b: Int? = nil) -> S {
        let n = h.count
        let s = a < 0 ? max(n + a, 0) : min(a, n)
        let e0 = b ?? n
        let e = e0 < 0 ? max(n + e0, 0) : min(e0, n)
        return s < e ? Array(h[s..<e]) : []
    }
    static func includes(_ h: S, _ n: S) -> Bool { indexOf(h, n) >= 0 }
    /// `h.split(n).length - 1`
    static func count(_ h: S, _ n: S) -> Int {
        var c = 0, i = 0
        while true { let k = indexOf(h, n, i); if k < 0 { return c }; c += 1; i = k + n.count }
    }
    /// case-insensitive search: /word/i.test(h)
    static func ciIncludes(_ h: S, _ word: S) -> Bool {
        guard h.count >= word.count else { return false }
        for i in 0...(h.count - word.count) where ci(h, i, word) { return true }
        return false
    }
    /// String.prototype.toLowerCase: the full Unicode mapping, whose length can
    /// differ from the original's (U+0130), exactly as the reference's `lower` does
    static func jsLower(_ h: S) -> S { u(str(h).lowercased()) }

    // MARK: - the scanner

    struct Block {
        let tag: String           // "script" | "style"
        let attrs: S
        let text: S
        let start: Int
        let type: String?
        let id: String?
        let src: String?
        let preview: Bool
    }

    struct Unterminated: Error { let tag: String; let at: Int }

    /// /(?:^|\s)NAME(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?(?=\s|$)/i
    static func attr(_ attrs: S, _ name: String) -> String? {
        let n = u(name), len = attrs.count
        var p = 0
        while p + n.count <= len {
            defer { p += 1 }
            guard p == 0 || isSpace(attrs[p - 1]), ci(attrs, p, n) else { continue }
            let q = p + n.count
            if let (v, end) = value(attrs, q), end == len || isSpace(attrs[end]) { return str(v) }
            if q == len || isSpace(attrs[q]) { return "" }
        }
        return nil
    }

    /// `\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))` at `q`: the value and where it ends
    private static func value(_ a: S, _ q: Int) -> (S, Int)? {
        var k = q
        while k < a.count, isSpace(a[k]) { k += 1 }
        guard k < a.count, a[k] == 0x3D else { return nil }
        k += 1
        while k < a.count, isSpace(a[k]) { k += 1 }
        guard k < a.count else { return nil }
        let c = a[k]
        if c == 0x22 || c == 0x27 {
            var e = k + 1
            while e < a.count, a[e] != c { e += 1 }
            guard e < a.count else { return nil }
            return (Array(a[(k + 1)..<e]), e + 1)
        }
        var e = k
        while e < a.count, !isSpace(a[e]), a[e] != 0x22, a[e] != 0x27, a[e] != 0x3E { e += 1 }
        return e > k ? (Array(a[k..<e]), e) : nil
    }

    /// Every <script> and <style> element, with its raw text: /<(script|style)\b([^>]*)>/gi,
    /// each ending at the first `</script` / `</style` in any case.
    static func scanBlocks(_ html: S) throws -> [Block] {
        var out: [Block] = []
        let lower = jsLower(html)
        var pos = 0, i = 0
        let tags: [(String, S)] = [("script", u("script")), ("style", u("style"))]
        while true {
            i = pos
            var found: (tag: String, i: Int, nameEnd: Int, gt: Int)?
            while i < html.count, found == nil {
                if html[i] == 0x3C {
                    for (t, w) in tags where ci(html, i + 1, w) {
                        let e = i + 1 + w.count
                        if e < html.count, isWord(html[e]) { continue }      // \b
                        var gt = e
                        while gt < html.count, html[gt] != 0x3E { gt += 1 }
                        if gt < html.count { found = (t, i, e, gt); break }
                    }
                }
                if found == nil { i += 1 }
            }
            guard let f = found else { return out }
            let start = f.gt + 1
            let close = indexOf(lower, u("</" + f.tag), start)
            if close < 0 { throw Unterminated(tag: f.tag, at: f.i) }
            let attrs = Array(html[f.nameEnd..<f.gt])
            out.append(Block(tag: f.tag, attrs: attrs, text: slice(html, start, close), start: start,
                             type: attr(attrs, "type"), id: attr(attrs, "id"), src: attr(attrs, "src"),
                             preview: attr(attrs, "data-bento-preview") != nil))
            pos = close
        }
    }

    // MARK: - the grammar (security, 2026-10-21)

    /// The data types Bento writes, matched exactly (case-sensitive). Anything
    /// else in a <script> is executable.
    static let dataTypes: Set<String> = ["application/bento+json", "application/bento+lang", "bento/deflate-b64", "bento/deflate-b86"]
    static func isDataScript(_ b: Block) -> Bool { b.tag == "script" && b.src == nil && b.type.map(dataTypes.contains) == true }
    static func executableScripts(_ blocks: [Block]) -> [Block] { blocks.filter { $0.tag == "script" && !isDataScript($0) } }

    /// /http-equiv\s*=\s*["']?\s*(refresh|content-security-policy)/i
    private static func metaRefreshOrCSP(_ a: S) -> Bool {
        let he = u("http-equiv")
        guard a.count >= he.count else { return false }
        for p in 0...(a.count - he.count) where ci(a, p, he) {
            var k = p + he.count
            while k < a.count, isSpace(a[k]) { k += 1 }
            guard k < a.count, a[k] == 0x3D else { continue }
            k += 1
            while k < a.count, isSpace(a[k]) { k += 1 }
            if k < a.count, a[k] == 0x22 || a[k] == 0x27 { k += 1 }
            while k < a.count, isSpace(a[k]) { k += 1 }
            if ci(a, k, u("refresh")) || ci(a, k, u("content-security-policy")) { return true }
        }
        return false
    }

    /// /(^|[\s"'/])on[a-z0-9_-]*\s*=/i
    private static func onAttribute(_ a: S) -> Bool {
        for p in 0..<a.count {
            if p > 0 { let c = a[p - 1]; guard isSpace(c) || c == 0x22 || c == 0x27 || c == 0x2F else { continue } }
            guard ci(a, p, u("on")) else { continue }
            var k = p + 2
            while k < a.count, isLetter(a[k]) || isDigit(a[k]) || a[k] == 0x5F || a[k] == 0x2D { k += 1 }
            while k < a.count, isSpace(a[k]) { k += 1 }
            if k < a.count, a[k] == 0x3D { return true }
        }
        return false
    }

    /// Markup a genuine Bento file never carries, outside a script or style
    /// element's own text. [] = none.
    static func markupProblems(_ html: S) throws -> [String] {
        var problems: [String] = []
        let lower = jsLower(html)
        var i = 0
        while true {
            i = indexOf(html, u("<"), i)
            if i < 0 { break }
            if at(html, i, u("<!--")) {
                let end = indexOf(html, u("-->"), i + 4)
                let body = slice(lower, i + 4, end < 0 ? html.count : end)
                if includes(body, u("<script")) { problems.append("a comment holds a <script>") }
                if end < 0 { problems.append("an unterminated comment"); break }
                i = end + 3; continue
            }
            // /^<([a-zA-Z][a-zA-Z0-9-]*)/ within the next 64 code units
            let window = min(html.count, i + 64)
            var ne = i + 1
            guard ne < window, isLetter(html[ne]) else { i += 1; continue }
            ne += 1
            while ne < window, isLetter(html[ne]) || isDigit(html[ne]) || html[ne] == 0x2D { ne += 1 }
            let name = str(Array(html[(i + 1)..<ne])).lowercased()
            // the tag's attributes, quote-aware, up to its closing '>'
            var j = ne
            var q: UInt16? = nil
            while j < html.count {
                let c = html[j]
                if let qq = q { if c == qq { q = nil } } else if c == 0x22 || c == 0x27 { q = c } else if c == 0x3E { break }
                j += 1
            }
            let attrs = slice(html, ne, j)
            if ["iframe", "object", "embed", "base"].contains(name) { problems.append("a <\(name)>") }
            if name == "meta", metaRefreshOrCSP(attrs) { problems.append("a <meta> refresh or CSP") }
            if onAttribute(attrs) { problems.append("an on*= attribute on <\(name)>") }
            if name == "script" || name == "style" {
                let close = indexOf(lower, u("</" + name), j)
                if close < 0 { problems.append("an unterminated <\(name)>"); break }
                if name == "style", includes(slice(lower, j, close), u("<script")) { problems.append("a <style> holds a <script>") }
                i = close + 2; continue
            }
            i = j + 1
        }
        for b in try scanBlocks(html) where isDataScript(b) && b.text.contains(0x3C) {
            problems.append("the \(b.type ?? "") block contains \"<\"")
        }
        return problems
    }

    // MARK: - hashing

    /// sha256 HEX of the text's UTF-8 bytes: every `blocks` pin
    static func sha256hex(_ s: S) -> String {
        SHA256.hash(data: Data(str(s).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    /// 'sha256-' + BASE64: every `scriptSrc` pin. Never compared with a hex pin.
    static func cspHash(_ s: S) -> String {
        "sha256-" + Data(SHA256.hash(data: Data(str(s).utf8))).base64EncodedString()
    }

    // MARK: - pins, and checking a file against one release

    struct Pins {
        let rt: String?, rtCss: String?, loader: String?, remover: String?
        let scriptSrc: [String]
        init(_ j: JSON) {
            let b = j["blocks"]
            rt = b?["bento-rt"]?.string; rtCss = b?["bento-rt-css"]?.string
            loader = b?["loader"]?.string; remover = b?["remover"]?.string
            scriptSrc = j["scriptSrc"]?.array?.compactMap { $0.string } ?? []
        }
        func block(_ id: String) -> String? { id == "bento-rt" ? rt : rtCss }
    }

    static let codeIds = ["bento-rt", "bento-rt-css"]

    /// Problems with this file as ONE release's: [] = it's that release's file.
    static func checkAgainstPins(_ html: S, _ pins: Pins) throws -> [String] {
        var problems = try markupProblems(html)
        let blocks = try scanBlocks(html)
        for id in codeIds {
            let found = blocks.filter { $0.id == id }
            if found.count != 1 { problems.append("\(found.count) #\(id) blocks (exactly one expected)") }
            else if sha256hex(found[0].text) != pins.block(id) { problems.append("#\(id) does not match") }
        }
        let exec = executableScripts(blocks)
        let hashes = exec.map { sha256hex($0.text) }
        // `.filter(Boolean)`: null and "" drop out
        let allowed = Set([pins.loader, pins.remover].compactMap { $0 }.filter { !$0.isEmpty })
        for (k, s) in exec.enumerated() where s.src != nil || !allowed.contains(hashes[k]) {
            problems.append("an executable script that is neither the pinned loader nor the remover (\(s.src.map { "src=" + $0 } ?? "\(s.text.count)B"))")
        }
        let n = { (h: String?) in hashes.filter { $0 == h }.count }
        if n(pins.loader) == 0 { problems.append("no pinned loader") }
        if n(pins.loader) > 1 { problems.append("more than one loader") }
        if let r = pins.remover, !r.isEmpty, n(r) > 1 { problems.append("more than one remover") }
        return problems
    }

    // MARK: - the release history

    /// /^(\d+)\.(\d+)\.(\d+)$/
    static func semver(_ s: String) -> [Double]? {
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.utf16.allSatisfy(isDigit) }) else { return nil }
        return parts.map { Double($0)! }
    }
    static func cmpVersion(_ a: String, _ b: String) -> Int {
        let x = semver(a)!, y = semver(b)!
        for i in 0..<3 where x[i] != y[i] { return x[i] < y[i] ? -1 : 1 }
        return 0
    }
    /// `/^[0-9a-f]{64}$/.test(v ?? '')`, with JavaScript's coercion of non-strings
    private static func hex64(_ v: JSON?) -> Bool {
        func coerce(_ v: JSON?) -> String? {
            switch v {
            case nil, .null?: return ""
            case .string(let s)?: return s
            case .array(let a)?: return a.map { coerce($0) ?? "\u{0}" }.joined(separator: ",")
            default: return nil   // a number, bool or object never reads as 64 hex digits
            }
        }
        guard let s = coerce(v), s.utf16.count == 64 else { return false }
        return s.utf16.allSatisfy { isDigit($0) || ($0 >= 0x61 && $0 <= 0x66) }
    }
    /// typeof x === 'object' (null included)
    private static func isObjectish(_ v: JSON?) -> Bool {
        switch v { case .object?, .array?, .null?: return true; default: return false }
    }
    static func entryOk(_ e: JSON?) -> Bool {
        guard let e, e.truthy, let v = e["version"]?.string, semver(v) != nil, hex64(e["sha256"]),
              e["at"]?.string != nil, e["pins"]?["v"]?.number == 1, isObjectish(e["pins"]?["blocks"]) else { return false }
        return true
    }

    /// A history payload's shape problems; [] = well-formed (versions unique, newest first).
    static func historyProblems(_ h: JSON?) -> [String] {
        var p: [String] = []
        if h?.truthy != true || h?["v"]?.number != 1 { p.append("version \(h?["v"].map(String.init(describing:)) ?? "undefined") (expected 1)") }
        if (h?["app"]?.string ?? "").isEmpty { p.append("no app") }
        guard let rel = h?["releases"]?.array else { p.append("no releases"); return p }
        var seen = Set<String>()
        for (i, e) in rel.enumerated() {
            guard entryOk(e) else { p.append("entry \(i) is malformed"); continue }
            let v = e["version"]!.string!
            if seen.contains(v) { p.append("version \(v) appears twice") }
            seen.insert(v)
            if i > 0, entryOk(rel[i - 1]), cmpVersion(rel[i - 1]["version"]!.string!, v) <= 0 { p.append("entries are not newest-first at \(v)") }
        }
        return p
    }

    enum Accept: Equatable { case ok, refused(String) }

    /// ANTI-ROLLBACK: a host's acceptance of an incoming, signature-checked
    /// history, given the newest it holds.
    static func acceptHistory(held: JSON?, incoming: JSON, app: String) -> Accept {
        let problems = historyProblems(incoming)
        if let first = problems.first { return .refused("malformed: \(first)") }
        if incoming["app"]?.string != app { return .refused("for \(incoming["app"]?.string ?? ""), not \(app)") }
        guard let held, held != .null else { return .ok }
        let inc = incoming["releases"]?.array ?? [], hr = held["releases"]?.array ?? []
        if inc.isEmpty || (!hr.isEmpty && cmpVersion(inc[0]["version"]!.string!, hr[0]["version"]?.string ?? "0.0.0") < 0) {
            return .refused("rollback: its newest release is older than the newest already held")
        }
        for e in hr {
            let v = e["version"]?.string
            guard let there = inc.first(where: { $0["version"]?.string == v }) else {
                return .refused("rollback: it lacks \(v ?? ""), which is already held")
            }
            // JSON.stringify equality: same values AND the same key order
            if there != e { return .refused("\(v ?? "") changed: a history never changes an entry") }
        }
        return .ok
    }

    /// The ONE entry matching every block, or nil (none, or more than one: UNKNOWN).
    static func matchRelease(_ history: JSON, _ html: S) throws -> JSON? {
        let rt = try scanBlocks(html).filter { $0.id == "bento-rt" }
        guard rt.count == 1 else { return nil }
        let rtHash = sha256hex(rt[0].text)
        var full: [JSON] = []
        for e in history["releases"]?.array ?? [] where e["pins"]?["blocks"]?["bento-rt"]?.string == rtHash {
            if try checkAgainstPins(html, Pins(e["pins"]!)).isEmpty { full.append(e) }
        }
        return full.count == 1 ? full[0] : nil
    }

    // MARK: - the served path

    /// The CSP a verified document is served under (security §17/§18, §36a).
    static func hostPolicy(_ pins: Pins, frameAncestors: String = "'none'") -> String {
        [
            "default-src 'none'",
            "script-src \(pins.scriptSrc.map { "'\($0)'" }.joined(separator: " ")) blob:",
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
            "frame-ancestors \(frameAncestors)",
        ].joined(separator: "; ")
    }

    enum Served {
        case genuine(version: String, entry: JSON, csp: String)
        case unknown(String)
    }

    /// THE served-path gate. The history must already have passed the release-key
    /// signature check (`openSigned`) and `acceptHistory`.
    static func verifyServed(_ html: S, history: JSON, frameAncestors: String = "'none'") -> Served {
        if let first = historyProblems(history).first { return .unknown("the history is malformed: \(first)") }
        do {
            guard let release = try matchRelease(history, html) else {
                let markup = try markupProblems(html)
                return .unknown(markup.first ?? "no single release matches every block")
            }
            return .genuine(version: release["version"]!.string!, entry: release,
                            csp: hostPolicy(Pins(release["pins"]!), frameAncestors: frameAncestors))
        } catch let e as Unterminated {
            return .unknown("an unterminated <\(e.tag)> at \(e.at)")
        } catch {
            return .unknown("unreadable")
        }
    }

    // MARK: - the signed history envelope

    /// `{ payload, sig }`: ECDSA P-256 SHA-256 over the payload's UTF-8, r‖s in
    /// base64. The payload, parsed, when the signature verifies; nil otherwise.
    static func openSigned(_ envelope: Data, publicKey: P256.Signing.PublicKey) -> JSON? {
        guard let env = try? JSON.parse(envelope), let payload = env["payload"]?.string, let sigB64 = env["sig"]?.string,
              let sigRaw = Data(base64Encoded: sigB64), let sig = try? P256.Signing.ECDSASignature(rawRepresentation: sigRaw),
              publicKey.isValidSignature(sig, for: Data(payload.utf8)) else { return nil }
        return try? JSON.parse(Data(payload.utf8))
    }

    /// A public key from its JWK (EC, P-256).
    static func publicKey(jwk: Data) -> P256.Signing.PublicKey? {
        guard let j = try? JSON.parse(jwk), j["kty"]?.string == "EC", j["crv"]?.string == "P-256",
              let x = j["x"]?.string.flatMap(b64url), let y = j["y"]?.string.flatMap(b64url), x.count == 32, y.count == 32
        else { return nil }
        return try? P256.Signing.PublicKey(x963Representation: Data([4]) + x + y)
    }
    private static func b64url(_ s: String) -> Data? {
        var t = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while t.count % 4 != 0 { t += "=" }
        return Data(base64Encoded: t)
    }

    // MARK: - the strict file:// fallback (security §15)

    struct StrictExpected {
        let skeleton: S
        let remover: S?
    }

    static let closeTag = u("</" + "script>")
    static let docAnchor = u(" id=\"bento-doc\"")
    static let docOpen = u("<script type=\"application/bento+json\" id=\"bento-doc\">")

    /// /\son[a-z]+\s*=/i
    private static func spaceOnAttr(_ b: S) -> Bool {
        for p in 0..<b.count where isSpace(b[p]) && ci(b, p + 1, u("on")) {
            var k = p + 3
            let s = k
            while k < b.count, isLetter(b[k]) { k += 1 }
            guard k > s else { continue }
            while k < b.count, isSpace(b[k]) { k += 1 }
            if k < b.count, b[k] == 0x3D { return true }
        }
        return false
    }

    /// h.replace(/<title>[^<]*<\/title>/, '<title><!--TITLE--></title>')
    private static func collapseTitle(_ h: S) -> S {
        let open = u("<title>"), close = u("</title>")
        var p = indexOf(h, open)
        while p >= 0 {
            var k = p + open.count
            while k < h.count, h[k] != 0x3C { k += 1 }
            if at(h, k, close) { return Array(h[..<p]) + u("<title><!--TITLE--></title>") + Array(h[(k + close.count)...]) }
            p = indexOf(h, open, p + 1)
        }
        return h
    }

    private static func collapse(_ h0: S, _ remover: S?) -> Result<S, Refusal> {
        var h = h0
        let anchors = count(h, docAnchor)
        if anchors != 1 { return .failure(.init("doc anchor count \(anchors)")) }
        let di = indexOf(h, docAnchor)
        let dOpen = lastIndexOf(h, u("<"), di)
        let dTagEnd = indexOf(h, u(">"), di) + 1
        let dEnd = indexOf(h, closeTag, di) + closeTag.count
        if slice(h, dOpen, dTagEnd) != docOpen { return .failure(.init("doc block opening tag altered")) }
        if dEnd < closeTag.count || includes(slice(h, dTagEnd, dEnd - closeTag.count), u("<")) {
            return .failure(.init("\"<\" inside the doc block"))
        }
        h = slice(h, 0, dOpen) + u("<!--DOC-->") + slice(h, dEnd)
        if count(h, u("data-bento-preview")) > 0 {
            guard let remover, count(h, u("<script data-bento-preview")) == 1, count(h, remover) == 1 else {
                return .failure(.init("remover missing, altered or repeated"))
            }
            let pOpen = lastIndexOf(h, u("<"), indexOf(h, u("data-bento-preview")))
            let rem = indexOf(h, remover)
            let body = slice(h, pOpen, rem)
            if ciIncludes(body, u("<script")) { return .failure(.init("script inside the preview markup")) }
            if spaceOnAttr(body) || ciIncludes(body, u("javascript:")) { return .failure(.init("handler or javascript: in the preview markup")) }
            h = slice(h, 0, pOpen) + u("<!--PREVIEW-->") + slice(h, rem + remover.count)
        }
        return .success(collapseTitle(h))
    }

    struct Refusal: Error { let reason: String; init(_ r: String) { reason = r } }

    /// The strict check: each variable span type-checked and collapsed, then the
    /// WHOLE string equal to the release's saved skeleton, bound at both ends.
    static func verifyStrict(_ html: S, _ expected: StrictExpected) -> Result<Void, Refusal> {
        switch collapse(html, expected.remover) {
        case .failure(let r): return .failure(r)
        case .success(let c): return c == expected.skeleton ? .success(()) : .failure(.init("skeleton differs from the release's saved form"))
        }
    }
}

// MARK: - JSON, keeping key order

/// JSON as JSON.parse reads it, with each object's KEY ORDER kept, so that
/// equality is JSON.stringify equality (a reordered entry is a changed entry).
/// A repeated key keeps its first position and its last value, as JSON.parse does.
indirect enum JSON: Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSON]), object([(String, JSON)])

    static func == (a: JSON, b: JSON) -> Bool {
        switch (a, b) {
        case (.null, .null): return true
        case (.bool(let x), .bool(let y)): return x == y
        case (.number(let x), .number(let y)): return x == y
        case (.string(let x), .string(let y)): return Array(x.utf16) == Array(y.utf16)
        case (.array(let x), .array(let y)): return x == y
        case (.object(let x), .object(let y)):
            return x.count == y.count && zip(x, y).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: return false
        }
    }

    subscript(_ k: String) -> JSON? { if case .object(let o) = self { return o.first { $0.0 == k }?.1 }; return nil }
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
    var array: [JSON]? { if case .array(let a) = self { return a }; return nil }
    var truthy: Bool {
        switch self {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        default: return true
        }
    }

    struct ParseError: Error {}

    static func parse(_ d: Data) throws -> JSON {
        var p = Parser(Array(String(decoding: d, as: UTF8.self).utf16))
        let v = try p.value()
        p.ws()
        guard p.i == p.s.count else { throw ParseError() }
        return v
    }

    private struct Parser {
        let s: [UInt16]
        var i = 0
        init(_ s: [UInt16]) { self.s = s }
        mutating func ws() { while i < s.count, [0x20, 0x09, 0x0A, 0x0D].contains(s[i]) { i += 1 } }
        mutating func lit(_ w: String) throws { for c in w.utf16 { guard i < s.count, s[i] == c else { throw ParseError() }; i += 1 } }
        mutating func value() throws -> JSON {
            ws()
            guard i < s.count else { throw ParseError() }
            switch s[i] {
            case 0x7B:   // {
                i += 1; var o: [(String, JSON)] = []
                ws()
                if i < s.count, s[i] == 0x7D { i += 1; return .object(o) }
                while true {
                    ws(); let k = try string(); ws(); try lit(":")
                    let v = try value()
                    if let at = o.firstIndex(where: { $0.0 == k }) { o[at].1 = v } else { o.append((k, v)) }
                    ws()
                    guard i < s.count else { throw ParseError() }
                    if s[i] == 0x2C { i += 1; continue }
                    if s[i] == 0x7D { i += 1; return .object(o) }
                    throw ParseError()
                }
            case 0x5B:   // [
                i += 1; var a: [JSON] = []
                ws()
                if i < s.count, s[i] == 0x5D { i += 1; return .array(a) }
                while true {
                    a.append(try value()); ws()
                    guard i < s.count else { throw ParseError() }
                    if s[i] == 0x2C { i += 1; continue }
                    if s[i] == 0x5D { i += 1; return .array(a) }
                    throw ParseError()
                }
            case 0x22: return .string(try string())
            case 0x74: try lit("true"); return .bool(true)
            case 0x66: try lit("false"); return .bool(false)
            case 0x6E: try lit("null"); return .null
            default: return .number(try number())
            }
        }
        mutating func string() throws -> String {
            guard i < s.count, s[i] == 0x22 else { throw ParseError() }
            i += 1
            var out: [UInt16] = []
            while true {
                guard i < s.count else { throw ParseError() }
                let c = s[i]; i += 1
                if c == 0x22 { return String(decoding: out, as: UTF16.self) }
                if c < 0x20 { throw ParseError() }
                if c != 0x5C { out.append(c); continue }
                guard i < s.count else { throw ParseError() }
                let e = s[i]; i += 1
                switch e {
                case 0x22, 0x5C, 0x2F: out.append(e)
                case 0x62: out.append(0x08)
                case 0x66: out.append(0x0C)
                case 0x6E: out.append(0x0A)
                case 0x72: out.append(0x0D)
                case 0x74: out.append(0x09)
                case 0x75:
                    guard i + 4 <= s.count, let v = UInt16(String(decoding: s[i..<(i + 4)], as: UTF16.self), radix: 16) else { throw ParseError() }
                    out.append(v); i += 4
                default: throw ParseError()
                }
            }
        }
        mutating func number() throws -> Double {
            let st = i
            if i < s.count, s[i] == 0x2D { i += 1 }
            guard i < s.count, Gate1.isDigit(s[i]) else { throw ParseError() }
            if s[i] == 0x30 { i += 1 } else { while i < s.count, Gate1.isDigit(s[i]) { i += 1 } }
            if i < s.count, s[i] == 0x2E {
                i += 1; guard i < s.count, Gate1.isDigit(s[i]) else { throw ParseError() }
                while i < s.count, Gate1.isDigit(s[i]) { i += 1 }
            }
            if i < s.count, s[i] == 0x65 || s[i] == 0x45 {
                i += 1; if i < s.count, s[i] == 0x2B || s[i] == 0x2D { i += 1 }
                guard i < s.count, Gate1.isDigit(s[i]) else { throw ParseError() }
                while i < s.count, Gate1.isDigit(s[i]) { i += 1 }
            }
            guard let d = Double(String(decoding: s[st..<i], as: UTF16.self)) else { throw ParseError() }
            return d
        }
    }
}
