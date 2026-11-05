#!/usr/bin/env bash
# Source inside the test step; secrets stay in this shell, not GITHUB_ENV.
# Usage: . scripts/load-provider-vault-secrets.sh "$TEST_PROVIDER" [core|provider]

case "${2:-core}" in
  core|provider) ;;
  *)
    echo "::error::Unknown vault credential mode: ${2}" >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

provider_registry="$(dirname "${BASH_SOURCE[0]}")/integration-providers.json"
provider_config=$(jq -ce --arg provider "${1:-}" '.[$provider] // error("Unsupported provider: " + $provider)' "$provider_registry") || {
  return 1 2>/dev/null || exit 1
}
mapfile -t required_keys < <(jq -r '.requiredEnv[]' <<< "$provider_config")
mapfile -t vault_keys < <(jq -r '[.requiredEnv[], .optionalEnv[]?, .aliases[]?[]] | unique[]' <<< "$provider_config")
if [ "${2:-core}" = provider ] && [ "$1" != archil ]; then
  # Existing direct-provider tests may optionally use the SDK gateway.
  vault_keys+=(COMPUTESDK_API_KEY)
fi

# Inherited Actions/environment values must not hide missing vault entries.
unset "${vault_keys[@]}"
provider_keys_regex=$(IFS='|'; printf '^(%s)=' "${vault_keys[*]}")
. "$(dirname "${BASH_SOURCE[0]}")/load-vault-secrets.sh" "$provider_keys_regex" || {
  return 1 2>/dev/null || exit 1
}

# Benchmarks calls its sandbox disk ARCHIL_DISK_ID_SANDBOX and its platform
# key BENCHMARKS_PLATFORM_API_KEY. Resolve declared aliases without eval.
for required_key in "${required_keys[@]}"; do
  mapfile -t alias_keys < <(jq -r --arg key "$required_key" '.aliases[$key][]?' <<< "$provider_config")
  if [ "$(jq -r '.canonicalFirst // false' <<< "$provider_config")" = true ]; then
    candidate_keys=("$required_key" "${alias_keys[@]}")
  else
    candidate_keys=("${alias_keys[@]}" "$required_key")
  fi
  for candidate_key in "${candidate_keys[@]}"; do
    if [ -n "${!candidate_key:-}" ]; then
      printf -v "$required_key" '%s' "${!candidate_key}"
      export "$required_key"
      break
    fi
  done
  if [ -z "${!required_key:-}" ]; then
    echo "::error::Namespace vault did not supply $required_key for $1" >&2
    return 1 2>/dev/null || exit 1
  fi
done

# Package names do not always match benchmark IDs (cloud-run, createos).
TEST_PROVIDER_PACKAGE=$(jq -r '.package' <<< "$provider_config")
export TEST_PROVIDER_PACKAGE
