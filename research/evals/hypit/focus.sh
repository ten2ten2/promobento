#!/usr/bin/env bash
set -euo pipefail
if (( $# != 1 )); then echo 'Usage: focus.sh <existing-renderer-image> < focus-input.json' >&2; exit 2; fi
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ -f "$here/node_modules/@hypit/visual-track/dist/index.js" ]] || { echo 'Pinned internal Hypit installation missing.' >&2; exit 1; }
# The input is inert JSON; no Hypit project modules, secrets or network are mounted.
exec docker run --rm -i --network none --read-only --tmpfs /tmp:rw,size=256m --memory 1g --cpus 1 --pids-limit 128 \
  --user "$(id -u):$(id -g)" --env HOME=/tmp \
  --mount "type=bind,src=$here,dst=/app/research/evals/hypit,readonly" --entrypoint node "$1" /app/research/evals/hypit/focus.mjs
