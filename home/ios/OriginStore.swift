// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

import Darwin
import Foundation
import Security

/// The device-local half of OriginIdentity: the host secret, the index, and
/// reading the facts a decision needs off a real file.
///
/// The SECRET never leaves this device. It's a Keychain item, this device only
/// and never synchronised. A fresh origin is an HMAC under it, so nobody who
/// knows a file's path or identifier can work out the origin it runs in here.
/// The INDEX is a small JSON file in Application Support: document → origin
/// string, the paths documents have run from, and the extended-attribute hints
/// recorded for files without a document identifier.
final class OriginStore {
    static let shared = OriginStore()

    private(set) var index: OriginIdentity.Index
    let secret: Data
    private let indexURL: URL?

    /// The extended attribute holding the hint, only where there is no document
    /// identifier. Never an authority: see OriginIdentity.
    static let hintAttribute = "page.bento.home.origin"

    private init() {
        secret = Self.loadOrMintSecret()
        // In a folder of our own: on an unsandboxed Mac, Application Support is
        // the person's shared ~/Library/Application Support, not a container.
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "page.bento.home", isDirectory: true)
        indexURL = dir?.appendingPathComponent("origin-index.json")
        if let u = indexURL, let data = try? Data(contentsOf: u),
           let ix = try? JSONDecoder().decode(OriginIdentity.Index.self, from: data) {
            index = ix
        } else {
            index = OriginIdentity.Index()
        }
    }

    func record(_ origin: String, hint: String?, facts: OriginIdentity.Facts) {
        OriginIdentity.record(origin, hint: hint, f: facts, into: &index)
        persist()
    }

    private func persist() {
        guard let u = indexURL, let data = try? JSONEncoder().encode(index) else { return }
        try? FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: u, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func newHint() -> String { UUID().uuidString }

    /// After our own save replaced the file, point the hint at its new resource id.
    func refreshHint(_ hint: String, for url: URL) {
        guard var rec = index.hints[hint] else { return }
        var st = stat()
        guard stat(url.standardizedFileURL.path, &st) == 0 else { return }
        rec.resourceID = "\(st.st_dev):\(st.st_ino)"
        index.hints[hint] = rec
        persist()
    }

    /// What the file itself can tell us. Called with the document's security
    /// scope open.
    static func facts(for url: URL, html: Data) -> OriginIdentity.Facts {
        let path = url.standardizedFileURL.path
        var st = stat()
        let haveStat = stat(path, &st) == 0
        return OriginIdentity.Facts(
            path: path,
            documentKey: documentKey(url, path: path, st: haveStat ? st : nil),
            hint: readHint(path),
            resourceID: haveStat ? "\(st.st_dev):\(st.st_ino)" : nil,
            docId: OriginIdentity.docId(inHTML: html))
    }

    /// volume ‖ document identifier. A plain local file has no document
    /// identifier until it is TRACKED, so set UF_TRACKED first — measured: the
    /// identifier then survives the app's atomic saves, moves, and iCloud
    /// eviction, and a copy doesn't carry it. nil where the filesystem or
    /// provider won't track it; the hint path takes over.
    private static func documentKey(_ url: URL, path: String, st: stat?) -> String? {
        func read() -> (Int?, String?) {
            var u = url
            u.removeAllCachedResourceValues()
            let v = try? u.resourceValues(forKeys: [.documentIdentifierKey, .volumeUUIDStringKey])
            return (v?.documentIdentifier, v?.volumeUUIDString)
        }
        var (id, volume) = read()
        if id == nil, let st, st.st_flags & UInt32(UF_TRACKED) == 0, chflags(path, st.st_flags | UInt32(UF_TRACKED)) == 0 {
            (id, volume) = read()
        }
        guard let id, let volume else { return nil }
        return "\(volume):\(id)"
    }

    private static func readHint(_ path: String) -> String? {
        let n = getxattr(path, hintAttribute, nil, 0, 0, 0)
        guard n > 0, n < 256 else { return nil }
        var buf = [UInt8](repeating: 0, count: n)
        guard getxattr(path, hintAttribute, &buf, n, 0, 0) == n else { return nil }
        return String(decoding: buf, as: UTF8.self)
    }

    static func writeHint(_ hint: String, to url: URL) {
        let bytes = Array(hint.utf8)
        _ = setxattr(url.standardizedFileURL.path, hintAttribute, bytes, bytes.count, 0, 0)
    }

    private static func loadOrMintSecret() -> Data {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "page.bento.home.origin",
            kSecAttrAccount as String: "host-secret",
        ]
        var out: CFTypeRef?
        var read = q
        read[kSecReturnData as String] = true
        if SecItemCopyMatching(read as CFDictionary, &out) == errSecSuccess, let d = out as? Data, d.count == 32 {
            return d
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            var g = SystemRandomNumberGenerator()
            bytes = (0..<32).map { _ in UInt8.random(in: 0...255, using: &g) }
        }
        let secret = Data(bytes)
        var add = q
        add[kSecValueData as String] = secret
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrSynchronizable as String] = false
        SecItemDelete(q as CFDictionary)
        let added = SecItemAdd(add as CFDictionary, nil)
        // A failed add costs less than it looks: the index stores ORIGIN STRINGS,
        // so every document already seen keeps its origin. Only origins minted
        // later would come from a different secret. Say so, rather than nothing.
        if added != errSecSuccess { NSLog("bento/home: origin secret not kept in the Keychain (%d)", added) }
        return secret
    }
}
