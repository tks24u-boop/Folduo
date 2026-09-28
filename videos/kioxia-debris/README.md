# KIOXIA SHOCK — デブリになる3秒前

45-second, 1920×1080, 60 fps real-time-3D short (Three.js) with an original synthesized BGM and
offline Japanese voice-over. See `STORYBOARD.md` for the shot list and `src/cues.json` for the
beat-synced timeline (128 BPM, 24 bars = 45.0 s).

## Build

```bash
npm ci
pip install numpy scipy soundfile pyloudnorm pyopenjtalk imageio-ffmpeg

python3 audio/bgm.py        # -> audio/bgm.wav (original synthesized track)
python3 audio/voice.py      # -> audio/voice.wav, audio/final_mix.wav (BGM + Open JTalk voice)

# Render (headless Chromium + SwiftShader). Split across machines if needed:
node tools/render.mjs --from 0 --to 45 --workers 3 --audio none --out out/chunks/chunk_00.mp4
#   or one chunk per container: bash tools/cloud_render.sh <k> <from> <to> [workers]

# Join the delivery-encoded chunks losslessly and mux the audio
node tools/concat.mjs out/chunks/chunk_*.mp4 --audio audio/final_mix.wav --out out/kioxia_shock.mp4
```

Previews: `node tools/still.mjs --sheet --from 0 --to 45 --step 0.75 --cols 6 --w 400 --h 225 --out scratch/sheet.jpg`

## Notes
- Every frame is a pure function of time, so frame ranges can be rendered out of order in parallel.
- Market statements are limited to verifiable ones (Kioxia roughly half of its all-time high,
  Sept 2026); the "bankruptcy" joke is explicitly about the trader, not the company.
- Fonts: SIL OFL 1.1 (see `assets/fonts/README.md`). Music, SFX and visuals are generated from code.
