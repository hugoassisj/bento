// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The RECEIVER-side removal check (security §29a.5–6).
//
// A device-list change must notify the list as it was BEFORE the change, and
// the publishing agent waits until that notice is durably queued. But on a
// desktop the account key that publishes the list can be used OUTSIDE the
// genuine agent — on a machine without a TPM, or in the window while it is
// unsealed for a prompted use — so the publisher's gate can be skipped. So
// every agent also checks what it RECEIVES: whenever a fetched list drops a
// device this agent did not remove itself, it raises its own local alert,
// whatever any notice said.
//
// Devices are identified by their routine key (`devicePub`). The synced list's
// format comes with the directory work; this is the pure check it must feed.

use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Removal {
    /// the removed device's routine key
    pub device_pub: String,
    /// true when it is THIS device: "this device was removed from your account"
    pub is_self: bool,
    /// who published the list that dropped it, when the list names a publisher
    pub by: Option<String>,
}

/// Compare the last list this agent saw with a freshly fetched one.
/// `own_removals` are the devices this agent removed itself (a confirmed
/// removal it published), which raise no alert. Additions are not alerts here:
/// a new device is announced by the §2f fetch notice and the linking flow.
pub fn removals(
    last_seen: &[String],
    fetched: &[String],
    own_removals: &BTreeSet<String>,
    this_device: &str,
    publisher: Option<&str>,
) -> Vec<Removal> {
    let now: BTreeSet<&str> = fetched.iter().map(String::as_str).collect();
    last_seen
        .iter()
        .filter(|d| !now.contains(d.as_str()) && !own_removals.contains(*d))
        .map(|d| Removal { device_pub: d.clone(), is_self: d == this_device, by: publisher.map(str::to_string) })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn v(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_list_shrunk_behind_the_gates_back_raises_the_alert_on_the_next_fetch() {
        // A,B,C published; then A alone, published by A without the notice gate.
        // B's next fetch must alert for itself AND for C.
        let r = removals(&v(&["A", "B", "C"]), &v(&["A"]), &BTreeSet::new(), "B", Some("A"));
        assert_eq!(r.len(), 2);
        assert!(r.iter().any(|x| x.device_pub == "B" && x.is_self && x.by.as_deref() == Some("A")));
        assert!(r.iter().any(|x| x.device_pub == "C" && !x.is_self));
    }

    #[test]
    fn control_a_removal_this_agent_made_itself_raises_nothing() {
        let own: BTreeSet<String> = ["C".to_string()].into();
        assert!(removals(&v(&["A", "B", "C"]), &v(&["A", "B"]), &own, "B", Some("B")).is_empty());
    }

    #[test]
    fn additions_and_reorders_are_not_removals() {
        assert!(removals(&v(&["A", "B"]), &v(&["B", "A", "D"]), &BTreeSet::new(), "B", None).is_empty());
    }
}
