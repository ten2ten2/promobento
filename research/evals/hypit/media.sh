#!/usr/bin/env bash
set -euo pipefail

if (( $# < 4 )); then
  echo 'Usage: media.sh <renderer-image> <video> <output-directory> <probe|tile|tiles|frames|cut|boundaries> [options]' >&2
  exit 2
fi
image=$1
video=$(cd -- "$(dirname -- "$2")" && pwd -P)/$(basename -- "$2")
output=$(cd -- "$3" && pwd -P)
command=$4
shift 4
case "$command" in probe|tile|tiles|frames|cut|boundaries) ;; *) echo 'Unsupported local media command.' >&2; exit 2;; esac
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ -f "$video" && -f "$here/node_modules/@hypit/hypit/bin/hypit.mjs" ]] || { echo 'Video or pinned Hypit installation missing.' >&2; exit 1; }

# Only the selected video, the output directory and the installed tools are mounted.
# No project-authored components, secrets, services or network are available here.
exec docker run --rm --label promobento.internal-eval=hypit-media --network none --read-only --tmpfs /tmp:rw,size=512m --memory 2g --cpus 2 --pids-limit 128 \
  --user "$(id -u):$(id -g)" --env HOME=/tmp --env FONTCONFIG_FILE=/hypit/fontconfig.xml --workdir /tmp \
  --mount "type=bind,src=$here,dst=/hypit,readonly" --mount "type=bind,src=$video,dst=/input/video.mp4,readonly" \
  --mount "type=bind,src=$output,dst=/out" --entrypoint node "$image" \
  /hypit/node_modules/@hypit/hypit/bin/hypit.mjs media "$command" /input/video.mp4 "$@"
