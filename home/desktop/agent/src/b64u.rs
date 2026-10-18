// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Strict base64url (statements.ts b64uEnc / b64uDec): the alphabet only, no
// padding, and the input must re-encode to exactly the same string, so a
// non-canonical spelling (non-zero trailing bits) is refused.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

pub fn enc(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn dec(s: &str) -> Option<Vec<u8>> {
    if !s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') || s.len() % 4 == 1 {
        return None;
    }
    let out = URL_SAFE_NO_PAD.decode(s).ok()?;
    (enc(&out) == s).then_some(out)
}
