# bento/id conformance vectors

`identity-v1.json` is the contract every host's statement code must pass:
the iOS/macOS agent (Swift), the Android agent (Kotlin), the desktop agent
(Rust), the extension (JS) and the directory. Each host must reach the stated
verdict on every row. The `reason` field is informative: match it where you can,
but the verdict is what counts.

The reference implementation is `kernel/src/statements.ts` (statements) and
`kernel/src/address.ts` (address normalisation). `scripts/test-statements.ts`
proves the reference passes every row. `scripts/gen-identity-vectors.ts`
regenerates the file. Regenerate only when the rules change: signatures are
random, so a regeneration changes bytes but not verdicts.

**The keys in this file are TEST KEYS ONLY.** Never use them for anything else.

## What each section checks

- `statements`: one row per case. `type` names the verifier. `text` and `sig`
  are what arrives. The other fields are what the VERIFIER brings: its `now`,
  `kxMode`, the `bindText` it holds, and for `cns` its own `rp`, `audience`,
  `challenge`, `payloadText` and `docId`. `challengeSpent: true` means its
  challenge book has already seen that challenge.
- `transcripts`: the consent channel binding (security §24), including the
  refusals (a dotted audience, a challenge under 16 bytes, a padded challenge).
- `webauthn`: the light tier's `clientDataJSON.challenge` derivation (§27).
- `lowS`: pairs of valid ECDSA signatures. Verifiers must refuse the high-S one,
  and signers must emit only the low-S form.
- `purposes`: which payload each routine `SignPurpose` may sign.
- `addresses`: the one normal form for an email address.

## Notes for native implementers

- **Signatures are raw r‖s (64 bytes), low-S, base64url.** Android Keystore and
  Apple's Security framework emit DER: convert, then fold s to the lower half,
  before anything crosses the bridge. A DER or high-S signature is refused here,
  so a forgotten conversion fails loudly rather than silently.
- **Parse strictly.** Split on `.` and KEEP empty fields, then require the
  exact field count. The traps, by language:
  - Swift's `split(separator:)` DROPS empty fields by default
    (`omittingEmptySubsequences: true`). Use `components(separatedBy: ".")`, or
    pass `omittingEmptySubsequences: false`.
  - Kotlin's plain `split(".")` keeps them, like JS. A `limit` argument or a
    `.filter { it.isNotEmpty() }` loses them. (home-android, measured)
  - Rust's `str::split('.')` keeps them; `split_terminator` and filters don't.

  Base64url is canonical: no padding, and it must re-encode to the same string.
- **Addresses: the vectors are the contract, not a regex.** The reference
  avoids lookbehind, because Rust's `regex` crate has none. Implement the rules
  however your language allows, but pass every row. Phase 1 is ASCII-only: any
  character outside 0x21–0x7E is refused. A domain typed in its `xn--` form is
  accepted as typed.
- **Display names: embed the fixture's `displayForbidden` table.** Don't use
  your platform's `\p{Cf}`-style categories. Those come from each platform's
  Unicode tables, so a character newly assigned to a category would be refused
  on one host and accepted on another, and a name would verify on one device
  and not the next. The table is frozen at Unicode 17.0 as explicit ranges, and
  changing it is a format decision. On top of the table: NFC is required, at
  most 64 code points, and ZWNJ/ZWJ (U+200C/U+200D) are allowed only mid-text.
  (home-desktop found the drift.)
- **Spend the consent challenge FIRST.** A `cns.` attempt that gets past the
  grammar check must consume its challenge even when it is refused (rp, docId,
  transcript, expiry, signature). Otherwise a refused attempt's challenge stays
  live to be retried. A verdict can't show the order, so every `cns` row carries
  `spendCalled`: assert your spend callback was (or was not) invoked. A port
  that spends late passes every verdict and fails these. (home-desktop found the
  gap.)
- **kx placement is unruled** (identity-design §6b). Both the `bind.` and the
  `dev.` kx slots must be EMPTY in the default mode. Rows with `kxMode` A, B or C
  show the format the ruling will select.
- **The consent key is per use on Android** (measured by home-android on the
  emulator): one BiometricPrompt authorises exactly one signature, and the
  Keystore, not the UI, refuses a second. Residency in the TEE or StrongBox still
  needs a real phone.
