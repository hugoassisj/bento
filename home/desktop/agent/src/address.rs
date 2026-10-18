// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The ONE definition of "which mailbox is this address" — a port of
// kernel/src/address.ts. The vectors are the contract; two JS semantics are
// reproduced on purpose because they change verdicts:
//   - `String.prototype.trim` strips a different set than Rust's `str::trim`
//     (it includes U+FEFF, which Unicode's White_Space does not);
//   - `s.length` counts UTF-16 code units, and the length check runs BEFORE
//     the ASCII check, so an over-long non-ASCII input is `too-long`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    TooLong,
    NotAscii,
    AtSign,
    LocalPart,
    Domain,
    NumericTld,
}

impl Refusal {
    pub fn as_str(self) -> &'static str {
        match self {
            Refusal::TooLong => "too-long",
            Refusal::NotAscii => "not-ascii",
            Refusal::AtSign => "at-sign",
            Refusal::LocalPart => "local-part",
            Refusal::Domain => "domain",
            Refusal::NumericTld => "numeric-tld",
        }
    }
}

const MAX_ADDRESS: usize = 254;
const MAX_LOCAL: usize = 64;
const MAX_LABEL: usize = 63;

/// ECMAScript WhiteSpace + LineTerminator (what `trim()` removes).
fn js_space(c: char) -> bool {
    matches!(c,
        '\u{0009}' | '\u{000A}' | '\u{000B}' | '\u{000C}' | '\u{000D}' | '\u{0020}' | '\u{00A0}'
        | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}'
        | '\u{3000}' | '\u{FEFF}')
}

/// RFC 5322 atext, lower-cased.
fn atext(c: u8) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || b"!#$%&'*+/=?^_`{|}~-".contains(&c)
}

pub fn normalize(input: &str) -> Result<String, Refusal> {
    let s = input.trim_matches(js_space);
    if s.encode_utf16().count() > MAX_ADDRESS {
        return Err(Refusal::TooLong);
    }
    if !s.bytes().all(|c| (0x21..=0x7e).contains(&c)) {
        return Err(Refusal::NotAscii);
    }
    // ASCII from here on, so byte indices are character indices.
    let at = match s.find('@') {
        Some(at) if at > 0 && Some(at) == s.rfind('@') && at != s.len() - 1 => at,
        _ => return Err(Refusal::AtSign),
    };
    let local = s[..at].to_ascii_lowercase();
    let domain = s[at + 1..].to_ascii_lowercase();
    if local.len() > MAX_LOCAL {
        return Err(Refusal::TooLong);
    }
    if !local.split('.').all(|atom| !atom.is_empty() && atom.bytes().all(atext)) {
        return Err(Refusal::LocalPart);
    }
    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 {
        return Err(Refusal::Domain);
    }
    for label in &labels {
        if label.is_empty() || label.len() > MAX_LABEL
            || !label.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || label.starts_with('-') || label.ends_with('-')
        {
            return Err(Refusal::Domain);
        }
    }
    if labels[labels.len() - 1].bytes().all(|c| c.is_ascii_digit()) {
        return Err(Refusal::NumericTld);
    }
    Ok(format!("{local}@{domain}"))
}

/// True when `s` is already in normal form (what a signed statement carries).
pub fn is_normal(s: &str) -> bool {
    normalize(s).map(|a| a == s).unwrap_or(false)
}
