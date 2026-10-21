# home/fixtures/gate1 — gate 1: is this runtime a genuine release?

Every host that offers bento/connect identity must first decide whether a
file's runtime is one of Bento's genuine releases. Several hosts implement that
in their own languages: the extension and the hosted runtime in JavaScript,
iOS in Swift, Android in Kotlin, desktop in Rust. **This corpus holds them
together.** `kernel/src/gate1.ts` is the reference. Every row here declares its
expected verdict, and every host's verifier must reach it.

The verdicts are the RULES (security §13–§18, §36, and the 2026-10-21 grammar
ruling). They aren't derived from the reference: the generator
(`scripts/gen-gate1-corpus.ts`) refuses to write the corpus if the reference
disagrees with any declared verdict.

| host | rig |
|---|---|
| reference (JS, kernel/src/gate1.ts) | `node scripts/test-gate1.ts` |
| `home/ios` (Swift) | to build |
| `home/android` (Kotlin) | to build |
| `home/desktop` (Rust) | to build |

## The files

- `history.json`: the signed release history of a synthetic app, `bento-test`,
  in the same envelope as the real one (`{ payload, sig }`, ECDSA P-256 SHA-256,
  IEEE P1363 r‖s, base64). It's signed with a **throwaway test key**, whose
  public half is `test-public-key.json`. Verify it exactly as you verify the
  real history with the release key. The signature is random, so regenerating
  changes it, but no verdict.
- `served/*.html`: files for the **served path** (`verifyServed`).
- `strict/*.html` and `strict-expected.json`: the **file:// fallback**
  (`verifyStrict`).
- `expected.json`: the answer key, with four sections: `served`, `ambiguous`,
  `strict` and `history`.

The releases in the history:
- **1.0.0 and 1.1.0** share a runtime and differ in their loader;
- **1.2.0** has its own runtime;
- **0.9.0** is from before previews, so it saves no remover.

## Encodings, per field (never compare across them)

| field | encoding |
|---|---|
| `pins.blocks.*` (`bento-rt`, `bento-rt-css`, `loader`, `remover`) | sha256 **HEX**, lowercase, of the block's TEXT (UTF-8) |
| `pins.scriptSrc[]` | `'sha256-'` + **BASE64** (standard, padded) of the same text: the CSP form |
| history entry `sha256` | sha256 **HEX** of the release's whole shell FILE (bytes) |
| `remover` | `null` for a release from before previews |

A block's TEXT is everything between its open tag's `>` and the first `</script`
or `</style`, in ANY case, as the HTML tokenizer ends it.

## The served path: the rules

A file is a release's only if ONE history entry matches EVERY block:
1. **Exactly one block per id:** `bento-rt`, `bento-rt-css`, each hash equal to
   its pin.
2. **The grammar.** A `<script>` is inert ONLY if its `type` is exactly one of
   `application/bento+json`, `application/bento+lang`, `bento/deflate-b64` or
   `bento/deflate-b86`. The match is case-sensitive, and the script must have no
   `src`. EVERY other script is executable, and each must be exactly the pinned
   loader or remover by hash. That includes no type, any JavaScript type,
   `module` in any case, an unknown type, and any `src=`.
3. **No foreign markup**, anywhere outside a script or style element's own text:
   - `<iframe>`, `<object>`, `<embed>`, `<base>`;
   - a `<meta http-equiv>` refresh or CSP;
   - any `on*=` attribute;
   - a comment or `<style>` holding `<script`;
   - a data block containing `<`. Bento's never do: the JSON is escaped and the
     b64/b86 alphabets exclude it.
4. **No match, a partial match, or two matching entries:** UNKNOWN.

The verdict comes with the CSP to serve the file under (`hostPolicy`):
`script-src` is the two pins plus `blob:`, styles are `'unsafe-inline'`, and
everything else is closed. UNKNOWN never borrows a release's CSP.

The scanner-split rows are the ones scanners have been seen to read
differently:
- uppercase `SCRIPT`;
- `type="Module"`;
- a NUL in an attribute name;
- unquoted and single-quoted attributes;
- `</script >`;
- tabs and newlines inside a tag;
- a script inside a comment, `<textarea>`, `<title>` or `<style>`.

Your scanner must agree on every one of them.

## The strict path (file://)

`strict-expected.json` holds a genuine save's SKELETON: the whole file with
three spans collapsed to placeholders, each type-checked first:
- the doc block: its exact opening tag, no `<` in its body;
- the preview: no script, no `on*` and no `javascript:` in its markup, then
  exactly the release's remover;
- the `<title>`.

A file passes only if, collapsed the same way, it equals the skeleton **byte
for byte over the whole string, bound at both ends**. That final compare is
load-bearing: it's what catches security's adversarial rows (trailing or
leading bytes, CRLF, `<\tscript>`, uppercase preview scripts).

Both genuine saves pass, and all 16 tamper rows refuse. A file:// result is
never grounds for identity calls (security §16): only a host that serves the
bytes it verified may expose identity.

## Changing the rules

Change `kernel/src/gate1.ts` and the declared rows in
`scripts/gen-gate1-corpus.ts`, regenerate, then re-run every host's rig. A host
that can't match the corpus is the one that's wrong.
