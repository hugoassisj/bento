// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento/id — the desktop agent core (Windows, Linux).
//
// The reference for every byte is kernel/src/statements.ts and
// kernel/src/address.ts; the CONTRACT is kernel/fixtures/identity-v1.json,
// which tests/conformance.rs runs row by row. This crate never re-derives a
// rule from prose: where the reference makes a choice (an order of checks, a
// JS string semantic), it is mirrored here and commented.

pub mod address;
pub mod agent;
pub mod b64u;
pub mod statements;
