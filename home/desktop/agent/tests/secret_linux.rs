// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The no-TPM Linux store against a real Secret Service (gnome-keyring under a
// D-Bus session, as at login). Run via keyring-rig.sh. The EXPOSURE is
// asserted, not hidden: once the keyring is unlocked, a second connection reads
// the account key with no prompt.
#![cfg(all(target_os = "linux", feature = "keyring"))]

use bento_id_agent::agent::{Agent, Caller, Clock, KeyRole, KeyStore, Policy, Refusal};
use bento_id_agent::secret_linux::SecretStore;
use bento_id_agent::{b64u, statements as st};

struct Now;
impl Clock for Now {
    fn now_ms(&self) -> u64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
    }
}
fn profile(tag: &str) -> String {
    format!("rig-{tag}-{}", std::process::id())
}

#[test]
fn routine_key_signs_and_verifies() {
    let mut s = SecretStore::open(&profile("routine")).unwrap();
    let pubk = b64u::enc(&s.create_device_key().unwrap());
    assert_eq!(s.public_key(&KeyRole::Device).unwrap().map(|p| b64u::enc(&p)), Some(pubk.clone()));
    let raw = s.sign(&KeyRole::Device, b"live", None).unwrap();
    assert!(st::verify_statement_sig(&pubk, &b64u::enc(&st::low_s(&raw)), "live"));
    s.wipe().unwrap();
    assert_eq!(s.public_key(&KeyRole::Device).unwrap(), None, "wipe removes the key");
}

#[test]
fn no_consent_key_so_aal3_is_refused() {
    let s = SecretStore::open(&profile("aal3")).unwrap();
    s.create_device_key().unwrap();
    assert!(!s.has_consent_key());
    let mut a = Agent::new(s, Now, Policy::default());
    let caller = Caller { verified: true, doc_id: Some("d1".into()) };
    let r = a.consent(&caller, "revoke", "rev.x", &b64u::enc(&[1u8; 24]));
    assert_eq!(r.unwrap_err(), Refusal::Unavailable, "no consent key on a no-TPM machine: AAL3 refused");
    a.begin_session();
    assert!(a.sign(&caller, "show", "live").is_ok(), "routine signing still works");
}

#[test]
fn stated_exposure_a_second_connection_reads_the_account_key_without_a_prompt() {
    let p = profile("exposure");
    let first = SecretStore::open(&p).unwrap();
    first.store_account(&[9u8; 32]).unwrap();
    drop(first);
    let other = SecretStore::open(&p).unwrap();
    assert_eq!(&other.account().unwrap()[..], &[9u8; 32][..], "RESIDUAL (stated): readable by any same-user process");
    other.wipe().unwrap();
    assert!(other.account().is_err());
}
