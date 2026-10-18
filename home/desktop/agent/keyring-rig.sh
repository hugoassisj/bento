#!/usr/bin/env bash
# The no-TPM store's rigs against gnome-keyring under a D-Bus session, the
# login keyring unlocked as a desktop session would. Linux only.
set -euo pipefail
exec dbus-run-session -- bash -euo pipefail -c '
  echo -n "rig-login-password" | gnome-keyring-daemon --unlock --components=secrets >/dev/null
  out=$(cargo test --features keyring --test secret_linux -- --test-threads=1 "$@" 2>&1) || { echo "$out"; exit 1; }
  echo "$out"
  echo "$out" | grep -qE "test result: ok\. [1-9][0-9]* passed" || { echo "FAIL: no keyring rig ran"; exit 1; }
' -- "$@"
