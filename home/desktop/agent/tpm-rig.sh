#!/usr/bin/env bash
# The H1b TPM rigs against two independent software TPMs (swtpm). Linux only.
set -euo pipefail
for n in A:2321 B:2331; do
  t=${n%%:*}; p=${n##*:}; d=$(mktemp -d)
  swtpm_setup --tpm2 --tpmstate "$d" --create-ek-cert --create-platform-cert --overwrite >/dev/null 2>&1 || true
  swtpm socket --tpm2 --tpmstate dir="$d" --server type=tcp,port=$p --ctrl type=tcp,port=$((p+1)) \
    --flags not-need-init,startup-clear --daemon
done
export BENTO_TPM_TCTI="swtpm:host=127.0.0.1,port=2321" BENTO_TPM_TCTI_OTHER="swtpm:host=127.0.0.1,port=2331"
cargo test --features tpm --test tpm_linux -- --test-threads=1 "$@"
