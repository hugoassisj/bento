// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

import Foundation
import Security

/// The kernel's per-document store (kernel/src/docstore.ts), held natively.
///
/// Without it, a document keeps its crash-recovery copy and this device's collab
/// member PRIVATE key in its web origin's localStorage and IndexedDB. With it,
/// those two leave web storage:
///
/// - **memberkey** goes to the Keychain: this device only, never synchronised, readable
///   after first unlock (an autosave can run while the screen is locked).
/// - **recovery**, which can be megabytes, goes to a file in the app's own Application
///   Support folder, under complete-until-first-authentication protection.
///
/// **The partition is the document's origin string**, the identity #753 mints
/// (OriginIdentity), never a path or anything the page names. So a moved file
/// keeps its entries, and a newcomer at a reused path starts empty, exactly as
/// its web storage does. The kernel also checks that a stored member key's docId
/// is its own before using it.
///
/// Only the two names the kernel uses exist. Anything else is refused.
final class HostDocStore {
    enum Name: String, CaseIterable { case recovery, memberkey }
    /// The bridge reports these as ok, 'too-large' and 'unavailable' (an I/O or
    /// Keychain failure). An unknown NAME is refused before it gets here.
    enum SetResult: Equatable { case stored, tooLarge, unavailable }

    /// What a read found. ABSENT means the entry really isn't there, and nothing
    /// else does: a read that failed is UNAVAILABLE. The difference is the
    /// member key's life. Told "no key" after a transient Keychain failure, the
    /// kernel would mint a new one and the write would replace the valid key,
    /// losing this device's identity in the room for good. Told "unavailable",
    /// it neither mints nor writes while blind (online.ts deviceIdentity).
    enum Read: Equatable { case found(Data), absent, unavailable }

    /// One message per value; the recovery copy is the whole document JSON, and
    /// decks with media are large.
    static let maxBytes = 64 * 1024 * 1024

    /// Where small secrets live. The Keychain in the app; a stand-in in the rig.
    protocol Secrets {
        func get(_ account: String) -> Read
        func set(_ account: String, _ data: Data) -> Bool
        func delete(_ account: String)
    }

    private let secrets: Secrets
    private let root: URL?
    /// Writes and reads per name run in order. Two overlapping writes therefore
    /// never race, and "superseded" never happens on this host.
    private let queue = DispatchQueue(label: "page.bento.home.docstore")

    init(secrets: Secrets = KeychainSecrets(), root: URL? = HostDocStore.defaultRoot()) {
        self.secrets = secrets
        self.root = root
    }

    static func defaultRoot() -> URL? {
        // a folder of our own: on an unsandboxed Mac, Application Support is the
        // person's shared folder, not a container
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "page.bento.home", isDirectory: true)
            .appendingPathComponent("docstore", isDirectory: true)
    }

    /// The origin string becomes a path component and a Keychain account, so
    /// only the shape the host mints is accepted: lowercase hex.
    static func validPartition(_ p: String) -> Bool {
        !p.isEmpty && p.count <= 64 && p.unicodeScalars.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    func get(_ name: Name, in partition: String) -> Read {
        // the partition is host-minted, so a bad one is the host's fault: never "absent"
        guard Self.validPartition(partition) else { return .unavailable }
        return queue.sync {
            switch name {
            case .memberkey: return secrets.get(account(partition, name))
            case .recovery:
                guard let u = file(partition, name) else { return .unavailable }
                // only a file that isn't there is absent; one that is there and
                // can't be read is unavailable, or the next autosave would
                // replace a recovery copy that still exists
                guard FileManager.default.fileExists(atPath: u.path) else { return .absent }
                guard let d = try? Data(contentsOf: u) else { return .unavailable }
                return .found(d)
            }
        }
    }

    func set(_ name: Name, _ data: Data, in partition: String) -> SetResult {
        guard Self.validPartition(partition) else { return .unavailable }
        guard data.count <= Self.maxBytes else { return .tooLarge }
        return queue.sync {
            switch name {
            case .memberkey:
                return secrets.set(account(partition, name), data) ? .stored : .unavailable
            case .recovery:
                guard let u = file(partition, name) else { return .unavailable }
                do {
                    try FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try data.write(to: u, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    return .stored
                } catch { return .unavailable }
            }
        }
    }

    /// The names held, or nil when any of them couldn't be checked.
    func list(in partition: String) -> [Name]? {
        guard Self.validPartition(partition) else { return nil }
        var held: [Name] = []
        for n in Name.allCases {
            switch get(n, in: partition) {
            case .found: held.append(n)
            case .absent: break
            case .unavailable: return nil
            }
        }
        return held
    }

    func delete(_ name: Name, in partition: String) {
        guard Self.validPartition(partition) else { return }
        queue.sync {
            switch name {
            case .memberkey: secrets.delete(account(partition, name))
            case .recovery: if let u = file(partition, name) { try? FileManager.default.removeItem(at: u) }
            }
        }
    }

    private func account(_ p: String, _ n: Name) -> String { "\(p)/\(n.rawValue)" }
    private func file(_ p: String, _ n: Name) -> URL? { root?.appendingPathComponent(p, isDirectory: true).appendingPathComponent(n.rawValue) }
}

/// The Keychain, this device only. Never synchronised: a member key is this
/// device's identity in a room, and must not travel.
struct KeychainSecrets: HostDocStore.Secrets {
    private let service = "page.bento.home.docstore"
    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }
    func get(_ account: String) -> HostDocStore.Read {
        var q = query(account); q[kSecReturnData as String] = true
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        return Self.classify(status, out as? Data)
    }

    /// Only errSecItemNotFound is absence. Every other failure (locked,
    /// interaction not allowed, missing entitlement, …) is unavailable.
    static func classify(_ status: OSStatus, _ data: Data?) -> HostDocStore.Read {
        switch status {
        case errSecSuccess: return data.map { .found($0) } ?? .unavailable
        case errSecItemNotFound: return .absent
        default: return .unavailable
        }
    }
    func set(_ account: String, _ data: Data) -> Bool {
        let q = query(account)
        let update = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return true }
        guard update == errSecItemNotFound else { return false }
        var add = q
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrSynchronizable as String] = false
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
    func delete(_ account: String) { SecItemDelete(query(account) as CFDictionary) }
}
