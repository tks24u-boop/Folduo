#!/usr/bin/env bash
# Render one chunk of frames on a fresh cloud container and push it back to the branch.
#   bash videos/kioxia-debris/tools/cloud_render.sh <chunk_index> <from_sec> <to_sec> [workers]
set -euo pipefail
K="$1"; FROM="$2"; TO="$3"; WORKERS="${4:-3}"
cd "$(dirname "$0")/.."
npm ci --silent --no-audit --no-fund
pip install -q imageio-ffmpeg >/dev/null 2>&1 || true
if ! command -v ffmpeg >/dev/null 2>&1; then
  export FFMPEG="$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')"
fi
mkdir -p out/chunks
node tools/render.mjs --from "$FROM" --to "$TO" --workers "$WORKERS" --audio none \
  --segdir "out/segments_$K" --out "out/chunks/chunk_$K.mp4"
BR="$(git rev-parse --abbrev-ref HEAD)"
git add -f "out/chunks/chunk_$K.mp4"
git commit -q -m "Render chunk $K (${FROM}s-${TO}s)"
for i in 1 2 3 4 5 6; do
  git pull -q --rebase origin "$BR" && git push -q origin "HEAD:$BR" && { echo "pushed chunk $K"; exit 0; }
  sleep $((i * 3))
done
echo "push failed for chunk $K" >&2; exit 1
