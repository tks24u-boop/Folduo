# KIOXIA SHOCK — デブリになる3秒前

A 45-second, 1920×1080, 60 fps, real-time-3D (Three.js) meme/cinematic short for X, made for the
trader **タック (@tack_trade)** — "8300万溶かした会社員 | デブリになる3秒前", an Astroscale fan
(Astroscale = space-debris removal). The joke: the market crashes, Kioxia (TSE 285A) falls to half
its peak, and *the trader* (not the company) is "on the verge of bankruptcy" — about to become
space debris. Ending: a debris-removal craft rescues him. "それでもガチホが正義。"

Goal: **viewers go "え、これ個人が作ったの!?"**. Every shot must look like a premium motion-graphics
title sequence: deep blacks, hot neon emissives with bloom, glossy/metallic hero objects, bold 3D
Japanese typography slamming on the beat, fast camera moves, cuts on bar lines.

## Facts & safety (must follow)
- Real, sourced facts we may state: Kioxia (キオクシア, TSE 285A) is trading at roughly **half of its
  all-time high** (Nikkei CNBC / news, Sept 2026). Say it as 「高値から半値」/「高値から −50%」.
- Do **not** state or imply Kioxia (the company) is going bankrupt. The bankruptcy joke is about the
  trader: 「破産寸前」→「※キオクシアじゃなくて、俺が。」
- No exact index/price numbers except: −50% (from peak) and the trader's own −83,000,000 (his profile:
  "8300万溶かした"). Candle charts are illustrative (no price axis values).
- No company logos (no Kioxia/Astroscale/Nikkei logos). Plain text names are fine.
- End card carries 「※演出です。投資助言ではありません」.

## Timing grid
128 BPM, 4/4, beat = 0.46875 s, bar = 1.875 s, 24 bars = 45.0 s. Use `B(bar, beat)` from
`src/lib/beats.js`. **Cuts land on bar lines. Slams land on beats.** All cue times are in
`src/cues.json` (the audio generator reads the same file — do not move a cue without updating it).

| time | bar | scene | what happens |
|---|---|---|---|
| 0.000 | 1 | s1_orbit | Black → stars fade in, HUD boot. Camera glides low over Earth's NIGHT side (city lights), toward the terminator. |
| 3.750 | 3 | s1 | SUNRISE: sun bursts over the Earth limb — huge bloom, anamorphic streak, flare. Kick enters. |
| 3.75–7.5 | 3–4 | s1 | Hero reveal: a giant black-and-gold 3D NAND chip ("285A") rises into frame in front of Earth like a rocket/satellite, with rising GREEN candle-streak trails. The trader's avatar coin orbits it. HUD: 「キオクシア (285A)」 tag, green ticker 「AI半導体 爆上げ」. |
| 5.625 | 4 | s1 | Gold 3D text 「最高値更新」 slams in (then flies out by 7.4). |
| 7.5–8.906 | 5 | s1 | Pre-drop: fast push-in on the chip, green gauges max out, riser. |
| 8.906 | 5.4 | s1 | GLITCH: everything flickers green→red, music cuts to silence, screen nearly black, HUD text 「しかし——」. |
| 9.375 | 6 | s2_crash | **DROP.** Red flash + heavy shake. Chip cracks (glowing red fracture lines). 3D text 「キオクシア」 slams. |
| 10.3125 | 6.2 | s2 | 3D text 「急落」 slams (huge, red chrome). |
| 11.25 | 7 | s2 | Chip EXPLODES: lid flies off, the internal stacked 3D-NAND layers separate (exploded view), shards fly at camera. |
| 13.125 | 8 | s2 | Cut: camera DIVES down through a canyon of giant red 3D candlesticks; glowing red price line plunging ahead. |
| 15.000 | 9 | s2 | 3D text 「高値から」 slams |
| 15.9375 | 9.2 | s2 | 3D text 「−50%」 slams (biggest hit of the section). |
| 16.875 | 10 | s3_market | Cut: gigantic curved LED stock board (TSE-style), all red, camera tracking past it. Ticker 「日経平均 ▼」「半導体 総崩れ」. |
| 18.750 | 11 | s3 | 3D text 「日経平均」 + big 3D red ▼ arrow slam. |
| 20.625 | 12 | s3 | Cut: "MY ACCOUNT" — avatar coin hero shot on dark glossy floor; 3D odometer counter rolls down… |
| 22.500 | 13 | s3 | …and locks at 「−83,000,000」 (impact). HUD 「含み損」「追証」. Red yen-coin rain. |
| 24.375 | 14 | s4_decay | Cut to space: the avatar coin tumbles among chip debris, losing orbit above a huge Earth. HUD orange warnings 「軌道維持 不能」「ORBIT DECAY」, alarm. |
| 28.125 | 16 | s4 | Re-entry: orange/white plasma sheath around the coin, streaks, heat shimmer, shake rising. |
| 31.875 | 18 | s4 | 3D text 「デブリになる」 |
| 32.8125 / 33.75 / 34.6875 | 18.2 / 19 / 19.2 | s4 | Giant 3D numerals **3**, **2**, **1** slam one per 2 beats. |
| 35.625 | 20 | s5_finale | HARD CUT TO BLACK + silence (tinnitus). |
| 36.5625 | 20.2 | s5 | 3D text 「破産寸前」 — the heaviest slam of the video (red chrome, debris burst, shake). |
| 38.4375 | 21.2 | s5 | Comedic beat: small pop-in subtitle 「※キオクシアじゃなくて、俺が。」 |
| 39.375 | 22 | s5 | Music returns, triumphant. A debris-removal service craft (solar wings, gold foil, glowing capture plate, blue thrusters) swoops in toward the tumbling coin… |
| 40.3125 | 22.2 | s5 | …magnetic CAPTURE (cyan ring pulse). HUD 「デブリ回収 成功」 |
| 41.250 | 23 | s5 | 3D text 「それでもガチホが正義。」 |
| 43.125 | 24 | s5 | End card: avatar coin + 「タック｜デブリになる3秒前」「@tack_trade」 + 「※演出です。投資助言ではありません」. Fade out 44.4 → 45.0. |

## Style bible
Palette (sRGB hex): crash red `#ff2a44` (hot `#ff5a6e`), hype green `#1dff8f`, gold `#ffc85a`,
HUD cyan `#39e6ff`, re-entry orange `#ff8a2a`, space navy `#02030a`, white `#f4f7ff`.

Typography:
- Big 3D slams: `makeText3D(ctx.assets.fonts.dela, ...)` (Dela Gothic One). Numbers/Latin 3D: `fonts.orbitron`.
- HUD: `FONTS.noto(px)` for Japanese, `FONTS.orb(px)` for Latin/numbers, `FONTS.mono(px)` for tickers.
- The Unicode minus `−` exists in Dela Gothic One; for Orbitron use '-'.

Look:
- Materials: `MeshPhysicalMaterial`/`MeshStandardMaterial` with `envMap: ctx.envMap` for chrome/gold;
  emissive > 1 (e.g. `emissiveIntensity: 2..6`) for neon that should bloom. Bloom runs in linear HDR
  before tone mapping (ACES), threshold ≈ 0.2 by default (`fx.bloomThreshold`).
- Slams: scale from ~3× → 1× with easeOutBack in ~0.15–0.2 s, plus `fx.flash` (0.3–0.8, red/white),
  `fx.shake` (0.1–0.4), `fx.chroma` spike (10–30 px), `fx.radialBlur` spike, optional debris burst.
  Between slams keep motion alive: slow push-ins, orbit drift, per-glyph subtle wobble.
- Beat sync: `beatPulse(t)` for glow/scale pulses in the drop (9.375–24.375) and decay sections.
- Keep text readable: big slams hold ≥ 0.6 s fully legible; never let two big texts overlap.
- HUD safe zones: the global HUD owns the top-left (x<440, y<130: LIVE badge) and bottom-right
  (x>1480, y>960: @tack_trade). Keep scene HUD elements out of those rectangles. Set
  `fx.globalHud = 0` on the end card and full-black moments.

## Technical contract
- Scene module: see `src/scenes/_template.js`. `create(ctx)` → `{ scene, camera, update(t, lt, fx), hud?(g, t, lt, fx) }`.
- **Determinism**: every visual is a pure function of `t`. No `Math.random()`, no `Date.now()`, no
  state accumulated across frames (frames are rendered out of order by parallel workers). Use
  `rng(seed)` at build time and closed-form motion (p = p0 + v·Δt + ½·a·Δt²) at update time.
- Performance budget (SwiftShader CPU WebGL): ≤ ~2.5 s per 1080p frame including bloom. Keep visible
  triangles < ~400k, use InstancedMesh for many objects, avoid full-screen shaders with > 5 fbm
  octaves, avoid shadow maps, limit big transparent overdraw.
- Shared assets live in `src/lib/` (space.js, chip.js, coin.js, craft.js, market.js, fx3d.js).
  Scene files must not edit shared libs; wrap/extend inside the scene file instead.
- Preview tools:
  - `node tools/still.mjs --t 3.8,5.7 --scenes s1_orbit --out scratch/s1` (1080p stills)
  - `node tools/still.mjs --sheet --from 0 --to 9.375 --step 0.47 --scenes s1_orbit --out scratch/s1_sheet.jpg`
  - `node tools/still.mjs --lab scratch/lab/space_lab.js --t 1,2` (preview an asset in isolation)
  - Look at the resulting JPGs with the Read tool. Iterate until it looks premium.
