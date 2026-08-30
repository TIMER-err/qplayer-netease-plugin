#!/usr/bin/env bash
set -euo pipefail

project_dir=$(cd "$(dirname "$0")/.." && pwd)
stage_dir=$(mktemp -d)
trap 'rm -rf "$stage_dir"' EXIT
mkdir -p "$stage_dir/src" "$stage_dir/META-INF" "$project_dir/dist"
cp "$project_dir/plugin.json" "$stage_dir/plugin.json"
cp "$project_dir/src/main.js" "$stage_dir/src/main.js"
(
  cd "$stage_dir"
  sha256sum plugin.json src/main.js | awk '{printf "  \"%s\": \"%s\"", $2, $1; if (NR == 1) printf ","; printf "\n"}' \
    | { printf '{\n'; cat; printf '}\n'; } > META-INF/qplayer-files.json
  signature_args=()
  if [[ -n "${QPLAYER_PLUGIN_SIGNING_KEY:-}" ]]; then
    openssl dgst -sha256 -sign "$QPLAYER_PLUGIN_SIGNING_KEY" \
      -out META-INF/qplayer.sig.bin META-INF/qplayer-files.json
    base64 -w0 META-INF/qplayer.sig.bin > META-INF/qplayer.sig
    rm META-INF/qplayer.sig.bin
    signature_args=(-C "$stage_dir" META-INF/qplayer.sig)
  fi
  jar --create --file "$project_dir/dist/netease-0.1.0.qplug" --no-manifest \
    -C "$stage_dir" plugin.json -C "$stage_dir" src -C "$stage_dir" META-INF/qplayer-files.json \
    "${signature_args[@]}"
)
printf '%s\n' "$project_dir/dist/netease-0.1.0.qplug"
