#!/usr/bin/env bash
set -euo pipefail

task_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$task_root"

# mise is preferred. A pre-provisioned PATH is accepted only at the exact same pins.
runner=()
if command -v mise >/dev/null 2>&1; then
  mise trust "$task_root/.mise.toml"
  if [[ ${PROMOBENTO_SETUP_OFFLINE:-0} != 1 ]]; then
    mise install
  else
    mise where node >/dev/null
    mise where pnpm >/dev/null
  fi
  runner=(mise exec --)
fi

expected_node=$(sed -nE 's/^node = "([^"]+)"$/\1/p' .mise.toml)
expected_pnpm=$(sed -nE 's/^pnpm = "([^"]+)"$/\1/p' .mise.toml)
if [[ -z $expected_node || -z $expected_pnpm ]]; then
  echo 'Cannot read exact Node and pnpm pins from .mise.toml.' >&2
  exit 1
fi
actual_node=$("${runner[@]}" node --version) || exit 1
actual_pnpm=$("${runner[@]}" pnpm --version) || exit 1
if [[ $actual_node != "v$expected_node" || $actual_pnpm != "$expected_pnpm" ]]; then
  echo "Expected Node $expected_node and pnpm $expected_pnpm; found $actual_node and $actual_pnpm." >&2
  echo 'Install mise and run setup again, or provision those exact versions from an approved source.' >&2
  exit 1
fi

install_args=(install --frozen-lockfile)
if [[ ${PROMOBENTO_SETUP_OFFLINE:-0} == 1 ]]; then
  install_args+=(--offline)
fi
if [[ -n ${PROMOBENTO_PNPM_STORE_DIR:-} ]]; then
  install_args+=(--store-dir "$PROMOBENTO_PNPM_STORE_DIR" --package-import-method copy)
fi
"${runner[@]}" pnpm "${install_args[@]}"
printf 'Setup ready: Node %s, pnpm %s.\n' "$expected_node" "$expected_pnpm"
