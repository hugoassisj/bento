#!/usr/bin/env bash
# The PRF interop rig (security §34), Linux, privileged (uhid). One virtual
# OpenSK key (agent-testkit, test-only), an independent WebAuthn client
# (python-fido2), and the agent's libfido2 layer must agree byte for byte;
# then each mutant build must FAIL the same test.
set -euo pipefail
mount -t devtmpfs none /dev
/lib/systemd/systemd-udevd --daemon >/dev/null 2>&1
# Build first (synchronously: a cold nightly build outlasts any wait), then start.
( cd ../agent-testkit && cargo build -q )
cargo build -q --features fido --tests
../agent-testkit/target/debug/bento-agent-testkit 2>/tmp/kit.log &
for i in $(seq 1 30); do [ -e /dev/hidraw0 ] && break; sleep 1; done
[ -e /dev/hidraw0 ] || { cat /tmp/kit.log; echo "FAIL: the virtual key never appeared"; exit 1; }
udevadm trigger; sleep 1
python3 -I ../agent-testkit/prf_client.py /tmp/rig.json
export BENTO_FIDO_RIG=/tmp/rig.json
out=$(cargo test --features fido --test fido_interop 2>&1) || { echo "$out"; exit 1; }
echo "$out" | grep -qE "test result: ok\. 1 passed" || { echo "$out"; echo "FAIL: the interop test did not run"; exit 1; }
echo "interop: PASS (agent == python-fido2)"
for m in rig-mutant-double-hash rig-mutant-raw-hash; do
  mout=$(cargo test --features "$m" --test fido_interop 2>&1) && { echo "FAIL: mutant $m was NOT caught"; exit 1; }
  # It must fail ON THE COMPARISON, not by failing to build or to talk to the key.
  echo "$mout" | grep -q "equals the independent WebAuthn client" || { echo "$mout" | tail -20; echo "FAIL: mutant $m failed for the wrong reason"; exit 1; }
  echo "mutant $m: caught on the PRF comparison"
done
