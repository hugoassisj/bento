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
- **Parse strictly.** Split on `.` and KEEP empty fields (many split helpers
  drop them, and Kotlin's `split` and Swift's `split` behave differently by
  default). Require the exact field count. Base64url is canonical: no padding,
  and it must re-encode to the same string.
- **Addresses: the vectors are the contract, not a regex.** The reference
  avoids lookbehind, because Rust's `regex` crate has none. Implement the rules
  however your language allows, but pass every row. Phase 1 is ASCII-only: any
  character outside 0x21–0x7E is refused. A domain typed in its `xn--` form is
  accepted as typed.
- **kx placement is unruled** (identity-design §6b). Both the `bind.` and the
  `dev.` kx slots must be EMPTY in the default mode. Rows with `kxMode` A, B or C
  show the format the ruling will select.
- **The consent key is per use on Android** (measured by home-android on the
  emulator): one BiometricPrompt authorises exactly one signature, and the
  Keystore, not the UI, refuses a second. Residency in the TEE or StrongBox still
  needs a real phone.
