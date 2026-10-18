// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The Linux key store for a machine WITHOUT a usable TPM (H1b, the no-TPM
// column of the H1 key table): the freedesktop Secret Service (GNOME Keyring,
// KWallet).
//
// STATED EXPOSURE (security §26): the keyring is unlocked at login, so ANY
// process running as this user can read these keys silently — routine and
// account alike. There is no consent key here, so every AAL3 action is refused
// and routed to a phone or a security key (§2e (E)), and an org's attestation
// policy can refuse such machines outright. The host must say all of this to
// the person when it falls back to this store.
//
// Keys are software P-256 scalars stored as keyring secrets, loaded only for
// the moment they are used and zeroized after.

use crate::agent::{KeyRole, KeyStore, Prompt, StoreError};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use secret_service::blocking::SecretService;
use secret_service::EncryptionType;
use std::collections::HashMap;
use zeroize::Zeroizing;

const APP: &str = "page.bento.home";

fn ss_err(e: impl std::fmt::Display) -> StoreError {
    StoreError::Unavailable(e.to_string())
}

fn role_name(role: &KeyRole) -> &'static str {
    match role {
        KeyRole::Account => "account",
        KeyRole::Device => "device",
        KeyRole::Consent => "consent",
    }
}

pub struct SecretStore {
    ss: SecretService<'static>,
    /// separates profiles (and test runs) within one keyring
    profile: String,
}

impl SecretStore {
    pub fn open(profile: &str) -> Result<SecretStore, StoreError> {
        let ss = SecretService::connect(EncryptionType::Dh).map_err(ss_err)?;
        Ok(SecretStore { ss, profile: profile.to_string() })
    }

    fn attrs<'a>(&'a self, role: &'a KeyRole) -> HashMap<&'a str, &'a str> {
        HashMap::from([("application", APP), ("profile", self.profile.as_str()), ("role", role_name(role))])
    }

    fn read(&self, role: &KeyRole) -> Result<Option<Zeroizing<Vec<u8>>>, StoreError> {
        let items = self.ss.search_items(self.attrs(role)).map_err(ss_err)?;
        let item = match (items.unlocked.first(), items.locked.first()) {
            (Some(i), _) => i,
            (None, Some(i)) => {
                i.unlock().map_err(ss_err)?;
                i
            }
            (None, None) => return Ok(None),
        };
        Ok(Some(Zeroizing::new(item.get_secret().map_err(ss_err)?)))
    }

    fn write(&self, role: &KeyRole, secret: &[u8]) -> Result<(), StoreError> {
        let c = self.ss.get_default_collection().map_err(ss_err)?;
        if c.is_locked().map_err(ss_err)? {
            c.unlock().map_err(ss_err)?;
        }
        c.create_item(&format!("bento/id {} key", role_name(role)), self.attrs(role), secret, true, "application/octet-stream")
            .map_err(ss_err)?;
        Ok(())
    }

    /// Mint the routine device key in software and store it. The consent key
    /// is refused: this store has none (AAL3 is routed elsewhere).
    pub fn create_device_key(&self) -> Result<[u8; 65], StoreError> {
        let key = SigningKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        let d = Zeroizing::new(key.to_bytes().to_vec());
        self.write(&KeyRole::Device, &d)?;
        Ok(key.verifying_key().to_encoded_point(false).as_bytes().try_into().unwrap())
    }

    /// Store the account key's scalar. Readable by any same-user process.
    pub fn store_account(&self, scalar: &[u8]) -> Result<(), StoreError> {
        self.write(&KeyRole::Account, scalar)
    }

    /// The account scalar for one prompted use; zeroized when dropped.
    pub fn account(&self) -> Result<Zeroizing<Vec<u8>>, StoreError> {
        self.read(&KeyRole::Account)?.ok_or(StoreError::NoKey)
    }

    /// Remove every key of this profile (device retirement, wipe path).
    pub fn wipe(&self) -> Result<(), StoreError> {
        for role in [KeyRole::Account, KeyRole::Device, KeyRole::Consent] {
            for item in self.ss.search_items(self.attrs(&role)).map_err(ss_err)?.unlocked {
                item.delete().map_err(ss_err)?;
            }
        }
        Ok(())
    }
}

impl KeyStore for SecretStore {
    fn public_key(&self, role: &KeyRole) -> Result<Option<[u8; 65]>, StoreError> {
        if *role != KeyRole::Device {
            return Ok(None);
        }
        match self.read(role)? {
            Some(d) => {
                let key = SigningKey::from_slice(&d).map_err(ss_err)?;
                Ok(Some(key.verifying_key().to_encoded_point(false).as_bytes().try_into().unwrap()))
            }
            None => Ok(None),
        }
    }

    fn sign(&mut self, role: &KeyRole, msg: &[u8], _prompt: Option<&Prompt>) -> Result<[u8; 64], StoreError> {
        if *role != KeyRole::Device {
            // No consent key on a no-TPM machine; the account key is used by
            // the account flows via `account()`, never through `sign`.
            return Err(StoreError::Unavailable("no hardware consent key on this machine".into()));
        }
        let d = self.read(role)?.ok_or(StoreError::NoKey)?;
        let key = SigningKey::from_slice(&d).map_err(ss_err)?;
        let sig: Signature = key.sign(msg);
        Ok(sig.to_bytes().into())
    }

    fn has_consent_key(&self) -> bool {
        false
    }
}
