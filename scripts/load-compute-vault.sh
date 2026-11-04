#!/usr/bin/env bash
# Source INSIDE an approved Actions job, never on the developer VM.
# Same nsc list/export protocol as benchmarks-stealth's load-vault-secrets.sh.
# Only requested metadata reaches the temporary envdef; values stay in memory.
load_compute_vault() {
  local vault_json envdef exported key value
  if ! command -v nsc >/dev/null; then
    printf '%s\n' 'BLOCKED: Namespace vault tooling is unavailable' >&2
    return 2
  fi
  if ! nsc version ensure --at_least 0.0.550 >/dev/null 2>&1; then
    printf '%s\n' 'BLOCKED: Namespace vault tooling version is unavailable' >&2
    return 2
  fi
  if ! vault_json=$(nsc vault list --output json 2>/dev/null); then
    printf '%s\n' 'BLOCKED: Namespace vault metadata is unavailable' >&2
    return 2
  fi
  envdef=$(mktemp "${TMPDIR:-/tmp}/compute-conformance-vault.XXXXXX")
  chmod 600 "$envdef"
  if ! node scripts/compute-conformance.mjs envdef <<< "$vault_json" > "$envdef"; then
    rm -f -- "$envdef"
    printf '%s\n' 'BLOCKED: missing, invalid or ambiguous Namespace vault metadata' >&2
    return 2
  fi
  if [ ! -s "$envdef" ]; then
    rm -f -- "$envdef"
    return 0 # Missing optional values do not invalidate existing required config.
  fi
  if ! exported=$(nsc vault export --envdef "$envdef" --shell=bash 2>/dev/null); then
    rm -f -- "$envdef"
    printf '%s\n' 'BLOCKED: Namespace vault export failed' >&2
    return 2
  fi
  if ! eval "$exported" >/dev/null 2>&1; then
    rm -f -- "$envdef"
    printf '%s\n' 'BLOCKED: Namespace vault environment export was invalid' >&2
    return 2
  fi
  while IFS='=' read -r key _; do
    value="${!key-}"
    # Standard Actions masking protocol; never emit credential diagnostics.
    # No exported shell program, value file or raw error is persisted.
    if [ -n "$value" ]; then
      value="${value//'%'/'%25'}"
      value="${value//$'\r'/'%0D'}"
      value="${value//$'\n'/'%0A'}"
      printf '::add-mask::%s\n' "$value"
    fi
  done < "$envdef"
  rm -f -- "$envdef"
}
load_compute_vault
