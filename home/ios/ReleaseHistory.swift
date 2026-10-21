// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

import Foundation

/// Each app's signed release history (K4), which gate 1 checks documents against.
///
/// - A copy is BUNDLED at build time (`release-history/<app>.json` in the app's
///   resources). It's verified with the release key on first read like a fetched
///   copy, and it's the anti-rollback floor.
/// - A newer copy is fetched only when the person asks for something that
///   needs the network anyway: a New document, or an explicit check for updates.
///   Never on open or launch, which would tell the server when documents open.
///   Offline, the held copy is used.
/// - A fetched copy replaces the held one only through `Gate1.acceptHistory`: it
///   must keep every entry already held, unchanged, and never roll back.
///
/// The bytes are kept as fetched (the `{ payload, sig }` envelope) and verified
/// again on every read, so the copy on disk is never trusted for being there.
enum ReleaseHistory {
    static func url(_ app: String) -> String { "https://bento.page/releases/\(app)/history.json" }

    /// The newest verified history this device holds for `app`, or nil when it
    /// holds none (gate 1 then calls every document unknown).
    static func current(_ app: String) -> JSON? {
        #if DEBUG
        if let rig = rigHistory() { return rig }
        #endif
        let floor = bundledData(app).flatMap { open($0, app: app) }
        guard let held = heldData(app).flatMap({ open($0, app: app) }) else { return floor }
        // a held copy counts only while it's a valid successor of the floor
        if let floor, Gate1.acceptHistory(held: floor, incoming: held, app: app) != .ok { return floor }
        return held
    }

    enum Refresh: Equatable { case updated, unchanged, refused(String), failed(String) }

    /// Fetch the published history and keep it if it's a valid successor of
    /// what's held. Call only from something the person asked for.
    static func refresh(_ app: String) async -> Refresh {
        let data: Data
        do { data = try await Releases.fetch(url(app)) } catch { return .failed(error.localizedDescription) }
        return accept(data, app: app)
    }

    /// The decision, apart from the network, so the rig can drive it.
    static func accept(_ data: Data, app: String) -> Refresh {
        guard let incoming = open(data, app: app) else { return .refused("not a valid signed history for \(app)") }
        let held = current(app)
        if let held, held == incoming { return .unchanged }
        switch Gate1.acceptHistory(held: held, incoming: incoming, app: app) {
        case .refused(let why): return .refused(why)
        case .ok:
            guard let dest = heldURL(app) else { return .failed("no place to keep it") }
            do {
                try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: dest, options: .atomic)
            } catch { return .failed(error.localizedDescription) }
            return .updated
        }
    }

    /// A verified, well-formed history for this app, or nil.
    static func open(_ envelope: Data, app: String) -> JSON? {
        guard let h = Gate1.openSigned(envelope, verify: ReleaseKeys.verify),
              Gate1.historyProblems(h).isEmpty, h["app"]?.string == app else { return nil }
        return h
    }

    private static func bundledData(_ app: String) -> Data? {
        Bundle.main.url(forResource: app, withExtension: "json", subdirectory: "release-history").flatMap { try? Data(contentsOf: $0) }
    }

    private static func heldData(_ app: String) -> Data? { heldURL(app).flatMap { try? Data(contentsOf: $0) } }

    /// a folder of our own: on an unsandboxed Mac, Application Support is the
    /// person's shared folder, not a container
    private static func heldURL(_ app: String) -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "page.bento.home", isDirectory: true)
            .appendingPathComponent("release-history", isDirectory: true)
            .appendingPathComponent("\(app).json")
    }

    #if DEBUG
    /// scripts/test-home-gate1-host.mjs: the corpus's history and TEST key stand
    /// in for the release one. DEBUG builds only.
    private static func rigHistory() -> JSON? {
        let env = ProcessInfo.processInfo.environment
        guard let h = env["BENTO_RIG_HISTORY"], let k = env["BENTO_RIG_HISTORY_KEY"],
              let hd = FileManager.default.contents(atPath: h), let kd = FileManager.default.contents(atPath: k),
              let key = Gate1.publicKey(jwk: kd) else { return nil }
        return Gate1.openSigned(hd, publicKey: key)
    }
    #endif
}
