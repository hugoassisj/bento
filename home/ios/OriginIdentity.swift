// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

import CryptoKit
import Foundation

/// Which `bento-tray://<host>` origin a document runs in — and so whose
/// localStorage and IndexedDB it can read.
///
/// The origin used to be a hash of the file's PATH. A different file that later
/// landed at the same path (the original deleted, a new download taking the same
/// name — "Untitled.bento.html" is common) therefore inherited the previous
/// file's storage: its recovery snapshot, its version history, and this device's
/// collab member private key for it. Measured: a second file at a reused path
/// read all three.
///
/// The origin now follows the FILE, not the path:
///
/// - **Anchor: the file's document identifier** (`NSURLDocumentIdentifierKey`),
///   with `UF_TRACKED` set on first open so a local file has one. Measured on the
///   app's own atomic save, a move, and iCloud eviction and re-download: it
///   stays. A copy does not carry it, and a new file at the same path gets a new
///   one. It is filesystem metadata, so nothing in a file can claim another's.
///   Origin = HMAC(this device's host secret, volume ‖ document identifier).
/// - **The index is the authority**, mapping a document to its origin string.
///   That is what lets a moved file keep its storage, and lets a file opened
///   before this change keep the origin its storage already lives in.
/// - **Where there is no document identifier** (a provider that won't track
///   files), a random id in an extended attribute is a HINT, honoured only when
///   the index recorded it for this same file or a move of it. An attribute
///   travels with copies; device-local state is the only thing that can tell
///   "my file" from someone else's copy of it.
/// - **A path once claimed is never adopted again.** A newcomer there gets fresh
///   storage. The old storage is never cleared: its owner may simply have moved.
///
/// Foundation-only, so every rule is checked standalone with `swiftc`
/// (scripts/test-home-origin.mjs). EditorViewController gathers the facts, runs
/// the probe, and loads the page.
enum OriginIdentity {
    /// What the host knows about the file being opened.
    struct Facts: Equatable {
        var path: String
        /// volume ‖ document identifier, when the filesystem provides one
        var documentKey: String?
        /// the extended-attribute hint, when there is no document key
        var hint: String?
        /// the file's current resource identifier (inode-like), for hint checks
        var resourceID: String?
        /// the document's own docId from #bento-doc, when it can be read
        var docId: String?
    }

    struct HintRecord: Codable, Equatable {
        var origin: String
        var path: String
        var resourceID: String?
    }

    struct Index: Codable, Equatable {
        /// document key → origin string
        var byDocument: [String: String] = [:]
        /// extended-attribute hint → where and what it was recorded for
        var hints: [String: HintRecord] = [:]
        /// paths a document has run from. Never adopted again for another.
        var claimedPaths: Set<String> = []
    }

    enum Decision: Equatable {
        /// The index knows this file: use its origin.
        case known(String)
        /// A file never seen at a path never claimed — it may be one opened
        /// before this change. Probe this origin's storage, then `settleLegacy`.
        case probeLegacy(String)
        /// Fresh storage. When `hint` is set, write it to the file's attribute.
        case fresh(String, hint: String?)
    }

    /// The origin every file had before this change: a hash of its path.
    static func legacyOrigin(path: String) -> String {
        hex(SHA256.hash(data: Data(path.utf8)))
    }

    static func freshOrigin(secret: Data, key: String) -> String {
        hex(HMAC<SHA256>.authenticationCode(for: Data(key.utf8), using: SymmetricKey(data: secret)))
    }

    static func decide(_ f: Facts, index: Index, secret: Data, newHint: () -> String) -> Decision {
        if let key = f.documentKey {
            if let origin = index.byDocument[key] { return .known(origin) }
            if index.claimedPaths.contains(f.path) {
                return .fresh(freshOrigin(secret: secret, key: "d:" + key), hint: nil)
            }
            return .probeLegacy(legacyOrigin(path: f.path))
        }
        // No document identifier: the attribute is a hint, never an authority.
        if let hint = f.hint, let rec = index.hints[hint] {
            let sameFile = rec.path == f.path          // in place, or edited elsewhere and synced
            let moved = rec.resourceID != nil && rec.resourceID == f.resourceID
            if sameFile || moved { return .known(rec.origin) }
        }
        if index.claimedPaths.contains(f.path) {
            let token = newHint()
            return .fresh(freshOrigin(secret: secret, key: "x:" + token), hint: token)
        }
        return .probeLegacy(legacyOrigin(path: f.path))
    }

    /// After probing a legacy origin: adopt it only if everything stored there
    /// belongs to this document. docId never CLAIMS an origin; it only refuses
    /// one. A file whose docId can't be read (an encrypted envelope) is refused
    /// whenever the origin holds anything at all.
    static func settleLegacy(_ candidate: String, storedDocIds: Set<String>, f: Facts,
                             secret: Data, newHint: () -> String) -> Decision {
        let own = f.docId.map { storedDocIds.subtracting([$0]).isEmpty } ?? storedDocIds.isEmpty
        if own { return .known(candidate) }
        if let key = f.documentKey { return .fresh(freshOrigin(secret: secret, key: "d:" + key), hint: nil) }
        let token = newHint()
        return .fresh(freshOrigin(secret: secret, key: "x:" + token), hint: token)
    }

    /// Record what was decided, so the next open — or the next open after a
    /// move — finds it.
    static func record(_ origin: String, hint: String?, f: Facts, into index: inout Index) {
        index.claimedPaths.insert(f.path)
        if let key = f.documentKey {
            index.byDocument[key] = origin
        } else if let h = hint ?? f.hint {
            index.hints[h] = HintRecord(origin: origin, path: f.path, resourceID: f.resourceID)
        }
    }

    /// The document's own docId, read from the `#bento-doc` block without
    /// running anything. nil for an encrypted envelope or a file that isn't Bento.
    static func docId(inHTML html: Data) -> String? {
        let s = String(decoding: html, as: UTF8.self)
        guard let tag = s.range(of: "id=\"bento-doc\""),
              let open = s.range(of: ">", range: tag.upperBound..<s.endIndex),
              let close = s.range(of: "</script>", range: open.upperBound..<s.endIndex),
              let obj = try? JSONSerialization.jsonObject(with: Data(s[open.upperBound..<close.lowerBound].utf8)) as? [String: Any]
        else { return nil }
        return obj["docId"] as? String
    }

    private static func hex<D: Sequence>(_ d: D) -> String where D.Element == UInt8 {
        String(d.map { String(format: "%02x", $0) }.joined().prefix(24))
    }
}
