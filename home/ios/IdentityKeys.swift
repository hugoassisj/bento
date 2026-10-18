// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors

import CryptoKit
import Foundation
import LocalAuthentication
import Security

/// bento/id's keys on this device (I1). The document side of the contract is
/// kernel/src/identity.ts; this is what answers it.
///
/// - **The account key** is the person. It's a software P-256 key in the Keychain,
///   this device only, because it's re-signed and replaced as devices come and
///   go (identity-design §2g). It's minted only by an explicit setup, never
///   because a read came back empty.
/// - **Two device keys, both in the Secure Enclave**, measured on this hardware:
///   - ROUTINE signs with no prompt: op batches, possession proofs, presence.
///   - CONSENT (`.userPresence`) needs Face ID, Touch ID or the passcode on
///     every use: invites, revocations, linking a device. The chip enforces that
///     split, so no code here can be talked out of it.
///   A Secure Enclave key never leaves the chip. Its opaque blob, useless
///   anywhere else, is kept in the Keychain so the key survives a relaunch.
/// - **Formats, as the kernel speaks them:** a public key is the 65-byte
///   uncompressed point (WebCrypto `exportKey('raw')`); a signature is raw r‖s,
///   64 bytes, LOW-S normalised, never DER. Both are base64url without padding.
///
/// **Never act while blind.** A key read that failed is `unavailable`, never
/// "absent". Minting over a key that is still there would lose this device's
/// identity for good (the lesson of HostDocStore.Read).
///
/// The simulator has no Secure Enclave. It gets software keys behind the same
/// interface, and its consent key checks presence with an explicit device-owner
/// authentication. That stand-in exists ONLY in the simulator.
enum IdentityKeys {
    enum Role: String { case routine, consent }

    enum Failure: Error, Equatable {
        /// nothing set up on this device (no account key)
        case noIdentity
        /// a store or the chip couldn't answer; retry later, never mint over it
        case unavailable
        /// the person declined the presence check
        case declined
    }

    /// One device key: its public half, and a way to sign with it.
    struct DeviceKey {
        let role: Role
        let publicRaw: Data          // 65 bytes, 0x04‖X‖Y
        fileprivate let signRaw: (Data, LAContext?) throws -> Data
        /// raw r‖s, low-S
        func sign(_ message: Data, context: LAContext? = nil) throws -> Data {
            IdentityKeys.lowS(try signRaw(message, context))
        }
    }

    /// Where key material lives: the Keychain in the app, a stand-in in the rig.
    typealias Store = HostDocStore.Secrets

    static let accountItem = "identity/account"
    static let enrolmentItem = "identity/consent-enrolment"
    static func deviceItem(_ r: Role) -> String { "identity/device-\(r.rawValue)" }

    // MARK: account key

    /// The account key, or `.noIdentity` when none is set up.
    static func account(in store: Store) throws -> P256.Signing.PrivateKey {
        switch store.get(accountItem) {
        case .found(let raw):
            guard let k = try? P256.Signing.PrivateKey(rawRepresentation: raw) else { throw Failure.unavailable }
            return k
        case .absent: throw Failure.noIdentity
        case .unavailable: throw Failure.unavailable
        }
    }

    /// Set up an identity on this device: mint the account key. Refuses if one is
    /// there, or if it can't tell whether one is there.
    static func createAccount(in store: Store) throws -> P256.Signing.PrivateKey {
        switch store.get(accountItem) {
        case .found: throw Failure.unavailable   // never silently replace a person
        case .unavailable: throw Failure.unavailable
        case .absent:
            let k = P256.Signing.PrivateKey()
            guard store.set(accountItem, k.rawRepresentation) else { throw Failure.unavailable }
            return k
        }
    }

    // MARK: device keys

    /// This device's key for `role`, minting it on first use. A device key is
    /// minted only when the store says it's truly absent.
    static func device(_ role: Role, in store: Store, enclave: Bool = SecureEnclave.isAvailable,
                       domainState: () -> Data? = IdentityKeys.currentDomainState) throws -> DeviceKey {
        switch store.get(deviceItem(role)) {
        case .found(let blob): return try load(role, blob, enclave: enclave)
        case .unavailable: throw Failure.unavailable
        case .absent:
            let (key, blob) = try mint(role, enclave: enclave)
            guard store.set(deviceItem(role), blob) else { throw Failure.unavailable }
            // the enrolment the consent key was born under: see Enrolment
            if role == .consent { _ = recordEnrolment(domainState(), in: store) }
            return key
        }
    }

    // MARK: biometric enrolment tripwire (threat model §29)

    /// The consent key is `.userPresence`, so it accepts the passcode and
    /// survives a change of enrolled faces or fingers. That's deliberate: it
    /// doesn't lock out people without biometrics, or people whose biometrics
    /// fail. Android's key is invalidated by a new enrolment instead. For
    /// parity without the lockout, the enrolment is recorded when the consent
    /// key is created and checked at every consent:
    /// - UNCHANGED: go ahead.
    /// - CHANGED: the agent tells every device and the address "biometrics
    ///   changed on <device>", and asks for the consent to be re-confirmed;
    ///   `acceptEnrolment` then records the new state.
    /// - UNKNOWN: the record couldn't be read. Refuse the consent; never skip
    ///   the check.
    /// A missing record (a key from before this check) is CHANGED, so it gets
    /// re-confirmed once. Measured on the simulator: gaining biometrics
    /// (nil → state) and losing them (state → nil) both show; re-enrolling the
    /// SAME simulated face reads identically. A different face or finger, a real
    /// device's case, is a different state.
    enum Enrolment: Equatable { case unchanged, changed, unknown }

    /// Stands in for "no biometrics enrolled", so losing them is a change too.
    private static let noBiometrics = Data("none".utf8)

    static func currentDomainState() -> Data? {
        let c = LAContext()
        var err: NSError?
        _ = c.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err)
        return c.evaluatedPolicyDomainState
    }

    @discardableResult
    static func recordEnrolment(_ state: Data?, in store: Store) -> Bool {
        store.set(enrolmentItem, state ?? noBiometrics)
    }

    static func checkEnrolment(_ current: Data?, in store: Store) -> Enrolment {
        switch store.get(enrolmentItem) {
        case .found(let recorded): return recorded == (current ?? noBiometrics) ? .unchanged : .changed
        case .absent: return .changed
        case .unavailable: return .unknown
        }
    }

    /// After the person has re-confirmed a consent under a changed enrolment.
    /// Refused unless the notice for this change is durably queued: the
    /// protection is the NOTICE (someone who added their own face re-confirms
    /// trivially), so the new state may never be accepted without it.
    @discardableResult
    static func acceptEnrolment(_ current: Data?, in store: Store) -> Bool {
        guard case .found(let q) = store.get(outboxItem), let queued = try? JSONDecoder().decode([Notice].self, from: q),
              queued.contains(where: { $0.state == stateTag(current) }) else { return false }
        return recordEnrolment(current, in: store)
    }

    // MARK: the notice, before anything else (threat model §29)

    /// "Biometrics changed on <device>", for every device and the address.
    struct Notice: Codable, Equatable {
        var kind = "biometrics-changed"
        let device: String
        /// which new state it's about (a hash, never the state itself)
        let state: String
        let at: Int
        /// WHO it goes to, snapshotted when it was queued: the devices listed
        /// then, plus "address". A later change to the device list never
        /// shrinks it, because the device whose biometrics changed holds the
        /// account key and could otherwise drop the victim's other devices
        /// before delivery, suppressing the very notice that warns about it.
        let recipients: Set<String>
        /// who has confirmed receiving it
        var deliveredTo: Set<String> = []
    }

    /// The anchor recipient: nothing on the device side can remove it.
    static let addressRecipient = "address"
    /// A snapshotted device that can never confirm (wiped, destroyed) stops
    /// holding the notice back after this long — but only once the address has.
    static let silentDeviceTimeoutMs = 7 * 86_400_000

    /// Whether `n` may leave the outbox at `now`: everyone confirmed; or the
    /// address confirmed and every device still silent has timed out. Never
    /// without the address.
    static func isDone(_ n: Notice, now: Int) -> Bool {
        guard n.deliveredTo.contains(addressRecipient) else { return false }
        if n.recipients.isSubset(of: n.deliveredTo) { return true }
        return now - n.at >= silentDeviceTimeoutMs
    }

    static let outboxItem = "identity/notice-outbox"

    private static func stateTag(_ d: Data?) -> String {
        b64url(Data(SHA256.hash(data: d ?? noBiometrics)))
    }

    enum Gate: Equatable {
        /// the enrolment is the one the consent key was made under
        case proceed
        /// changed: the notice IS queued; ask for re-confirmation, then acceptEnrolment
        case reconfirm
        /// the record or the outbox can't be read or written: refuse the consent
        case refuse
    }

    /// Run before every consent. On a change, the notice is written to the
    /// durable outbox FIRST, before the consent can go on, whether it then
    /// completes or is cancelled. Queuing is idempotent per new state, so a
    /// restart neither drops nor repeats it. Nothing here takes input from the
    /// page, so a page can't suppress or delay it.
    /// `devices` is the account's device list as it stands NOW; it's
    /// snapshotted into the notice along with the address.
    static func enrolmentGate(_ current: Data?, device: String, devices: Set<String>, now: Int, in store: Store) -> Gate {
        switch checkEnrolment(current, in: store) {
        case .unchanged: return .proceed
        case .unknown: return .refuse
        case .changed:
            var queued: [Notice] = []
            switch store.get(outboxItem) {
            case .found(let q): guard let l = try? JSONDecoder().decode([Notice].self, from: q) else { return .refuse }; queued = l
            case .absent: break
            case .unavailable: return .refuse
            }
            let tag = stateTag(current)
            if !queued.contains(where: { $0.state == tag }) {
                queued.append(Notice(device: device, state: tag, at: now,
                                     recipients: devices.union([addressRecipient])))
                guard let d = try? JSONEncoder().encode(queued), store.set(outboxItem, d) else { return .refuse }
            }
            return .reconfirm
        }
    }

    /// The notices still to deliver. A notice leaves only when EVERY recipient
    /// has confirmed it (see markDelivered).
    static func pendingNotices(in store: Store) -> [Notice]? {
        switch store.get(outboxItem) {
        case .found(let q): return try? JSONDecoder().decode([Notice].self, from: q)
        case .absent: return []
        case .unavailable: return nil
        }
    }

    // MARK: the device-list change's own notice (threat model §29 point 4, §2g)

    /// The snapshot above defeats "add a face, then drop the victim's devices".
    /// The reverse order (drop them first, then add a face) leaves a snapshot
    /// that already excludes them, and the only thing that warns those devices
    /// is THIS notice: "the device list changed", sent to the list as it was
    /// BEFORE the change, plus the address, under the same snapshot and anchor
    /// rules. It must be queued before the change is published:
    /// `mayPublishDeviceList` is the check the publisher passes.
    private static func changeTag(_ before: Set<String>, _ after: Set<String>) -> String {
        b64url(Data(SHA256.hash(data: Data("devices.\(before.sorted().joined(separator: ","))>\(after.sorted().joined(separator: ","))".utf8))))
    }

    /// Queue the notice for a device-list change. Idempotent per change.
    static func queueDeviceListChange(before: Set<String>, after: Set<String>, by device: String, now: Int, in store: Store) -> Bool {
        guard before != after else { return true }
        var queued: [Notice] = []
        switch store.get(outboxItem) {
        case .found(let q): guard let l = try? JSONDecoder().decode([Notice].self, from: q) else { return false }; queued = l
        case .absent: break
        case .unavailable: return false
        }
        let tag = changeTag(before, after)
        if !queued.contains(where: { $0.state == tag }) {
            queued.append(Notice(kind: "devices-changed", device: device, state: tag, at: now,
                                 recipients: before.union([addressRecipient])))
            return save(queued, in: store)
        }
        return true
    }

    /// True only once the notice for exactly this change is durably queued.
    static func mayPublishDeviceList(before: Set<String>, after: Set<String>, in store: Store) -> Bool {
        if before == after { return true }
        let tag = changeTag(before, after)
        return pendingNotices(in: store)?.contains(where: { $0.state == tag && $0.kind == "devices-changed" }) ?? false
    }

    /// Record that `recipient` confirmed receiving `n`. It counts only if it's
    /// in the notice's own snapshotted recipients (removed devices included);
    /// nothing the caller passes can add to or shrink that set.
    @discardableResult
    static func markDelivered(_ n: Notice, to recipient: String, now: Int, in store: Store) -> Bool {
        guard var l = pendingNotices(in: store),
              let i = l.firstIndex(where: { $0.state == n.state && $0.device == n.device }),
              l[i].recipients.contains(recipient) else { return false }
        l[i].deliveredTo.insert(recipient)
        return save(l.filter { !isDone($0, now: now) }, in: store)
    }

    /// Clear notices whose silent devices have timed out (only once the address
    /// has confirmed). Run when the agent checks its outbox.
    @discardableResult
    static func sweepNotices(now: Int, in store: Store) -> Bool {
        guard let l = pendingNotices(in: store) else { return false }
        return save(l.filter { !isDone($0, now: now) }, in: store)
    }

    private static func save(_ l: [Notice], in store: Store) -> Bool {
        guard let d = try? JSONEncoder().encode(l) else { return false }
        return store.set(outboxItem, d)
    }

    private static func access(_ role: Role) throws -> SecAccessControl {
        let flags: SecAccessControlCreateFlags = role == .consent ? [.privateKeyUsage, .userPresence] : [.privateKeyUsage]
        guard let ac = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, flags, nil)
        else { throw Failure.unavailable }
        return ac
    }

    private static func mint(_ role: Role, enclave: Bool) throws -> (DeviceKey, Data) {
        if enclave {
            let k = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access(role))
            return (wrap(role, k), k.dataRepresentation)
        }
        #if targetEnvironment(simulator) || BENTO_SOFTWARE_DEVICE_KEYS
        let k = P256.Signing.PrivateKey()
        return (wrapSoftware(role, k), k.rawRepresentation)
        #else
        // A real device with no Secure Enclave isn't a supported identity
        // device: device keys are hardware or nothing.
        throw Failure.unavailable
        #endif
    }

    private static func load(_ role: Role, _ blob: Data, enclave: Bool) throws -> DeviceKey {
        if enclave {
            guard let k = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob) else { throw Failure.unavailable }
            return wrap(role, k)
        }
        #if targetEnvironment(simulator) || BENTO_SOFTWARE_DEVICE_KEYS
        guard let k = try? P256.Signing.PrivateKey(rawRepresentation: blob) else { throw Failure.unavailable }
        return wrapSoftware(role, k)
        #else
        throw Failure.unavailable
        #endif
    }

    private static func wrap(_ role: Role, _ k: SecureEnclave.P256.Signing.PrivateKey) -> DeviceKey {
        DeviceKey(role: role, publicRaw: k.publicKey.x963Representation) { msg, ctx in
            do {
                // The consent key's presence check is the chip's, run with this
                // context's prompt text. Without a context it prompts by itself.
                let key = ctx.flatMap { try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: k.dataRepresentation, authenticationContext: $0) } ?? k
                return try key.signature(for: msg).rawRepresentation
            } catch let e as NSError where e.code == Int(errSecUserCanceled) || e.code == LAError.userCancel.rawValue || e.code == LAError.appCancel.rawValue {
                throw Failure.declined
            } catch {
                throw role == .consent ? Failure.declined : Failure.unavailable
            }
        }
    }

    #if targetEnvironment(simulator) || BENTO_SOFTWARE_DEVICE_KEYS
    private static func wrapSoftware(_ role: Role, _ k: P256.Signing.PrivateKey) -> DeviceKey {
        DeviceKey(role: role, publicRaw: k.publicKey.x963Representation) { msg, ctx in
            if role == .consent {
                // the stand-in for the chip's .userPresence: an explicit check
                let c = ctx ?? LAContext()
                var err: NSError?
                guard c.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { throw Failure.declined }
                let sem = DispatchSemaphore(value: 0)
                var passed = false
                c.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Confirm with bento/home") { ok, _ in passed = ok; sem.signal() }
                sem.wait()
                guard passed else { throw Failure.declined }
            }
            return try k.signature(for: msg).rawRepresentation
        }
    }
    #endif

    // MARK: encodings

    /// The P-256 group order n.
    private static let n: [UInt8] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51]
    /// n / 2
    private static let halfN: [UInt8] = [
        0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCF, 0x42, 0x79, 0xDC, 0xE5, 0x61, 0x7E, 0x31, 0x92, 0xA8]

    /// Normalise s to the lower half: (r, s) and (r, n − s) are both valid, and
    /// the contract promises the low one, so a signature has ONE form.
    static func lowS(_ sig: Data) -> Data {
        guard sig.count == 64 else { return sig }
        let r = Array(sig.prefix(32)), s = Array(sig.suffix(32))
        guard s.lexicographicallyPrecedes(halfN) == false, s != halfN else { return sig }
        var out = [UInt8](repeating: 0, count: 32), borrow = 0
        for i in stride(from: 31, through: 0, by: -1) {
            var d = Int(n[i]) - Int(s[i]) - borrow
            borrow = d < 0 ? 1 : 0
            if d < 0 { d += 256 }
            out[i] = UInt8(d)
        }
        return Data(r + out)
    }

    static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
