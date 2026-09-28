"""Voice-over (offline Japanese TTS via Open JTalk) + final mix with the BGM.

    python3 audio/voice.py            -> audio/voice.wav, audio/final_mix.wav

Open JTalk sounds synthetic, so the lines are styled as an on-board "system voice"
(band-limited, slightly crushed, short slapback + room) and the deadpan punchline.
The BGM is ducked under each line. Output: 48 kHz, 24-bit, stereo, exactly 45.000 s.
"""
import json
import os

import numpy as np
import pyopenjtalk
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SR = 48000
CUES = json.load(open(os.path.join(ROOT, "src", "cues.json"), encoding="utf-8"))
DUR = CUES["duration"]
N = int(round(DUR * SR))


def cue(type_, note=None):
    for c in CUES["sfx"]:
        if c["type"] == type_ and (note is None or c.get("note") == note):
            return c["t"]
    raise KeyError(type_)


# (text, start time of the first voiced sample, style, gain dB, speed, half_tone)
LINES = [
    ("しかし", cue("glitch_cut") - 0.03, "whisper", -3.0, 1.35, -3.0),
    ("警告。軌道維持、不能。", cue("alarm_start") + 0.16, "system", -1.0, 1.08, -1.0),
    ("さん", cue("count", "3") - 0.02, "count", 0.0, 1.0, -2.0),
    ("に", cue("count", "2") - 0.02, "count", 0.0, 1.0, -1.0),
    ("いち", cue("count", "1") - 0.02, "count", 0.0, 1.0, 0.0),
    ("キオクシアじゃなくて、俺が。", cue("pon") + 0.12, "deadpan", 0.0, 1.12, -1.0),
]


def tts(text, speed, half_tone):
    x, sr = pyopenjtalk.tts(text, speed=speed, half_tone=half_tone)
    x = x.astype(np.float64) / 32768.0
    if sr != SR:
        x = signal.resample_poly(x, SR, sr)
    # trim leading/trailing silence
    env = np.abs(x)
    thr = 0.02 * env.max()
    idx = np.where(env > thr)[0]
    x = x[max(0, idx[0] - int(0.005 * SR)): idx[-1] + int(0.06 * SR)]
    fade = int(0.004 * SR)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade * 4:] *= np.linspace(1, 0, fade * 4)
    return x / (np.abs(x).max() + 1e-9)


def bandpass(x, lo, hi, order=4):
    sos = signal.butter(order, [lo, hi], btype="bandpass", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def room_ir(length_s, decay_s, seed, bright=6000):
    rng = np.random.default_rng(seed)
    n = int(length_s * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t / decay_s)[:, None]
    sos = signal.butter(2, bright, btype="lowpass", fs=SR, output="sos")
    ir = signal.sosfilt(sos, ir, axis=0)
    ir[: int(0.008 * SR)] *= np.linspace(0, 1, int(0.008 * SR))[:, None]
    return ir / np.sqrt((ir ** 2).sum(axis=0, keepdims=True))


def process(x, style):
    """Mono in -> stereo out."""
    if style in ("system", "count"):
        y = bandpass(x, 220, 5200)
        y = np.tanh(y * 2.2) / np.tanh(2.2)  # radio drive
        # light bit reduction for a digital "announcer" edge
        y = np.round(y * 96) / 96 * 0.35 + y * 0.65
        slap = np.zeros_like(y)
        d = int(0.085 * SR)
        slap[d:] = y[:-d] * 0.28
        y = y + slap
        wet = signal.fftconvolve(y, room_ir(1.2, 0.35, 7)[:, 0])[: len(y) + int(0.8 * SR)]
        wetR = signal.fftconvolve(y, room_ir(1.2, 0.35, 8)[:, 0])[: len(y) + int(0.8 * SR)]
        pad = np.zeros(len(wet) - len(y))
        dry = np.concatenate([y, pad])
        return np.stack([dry + wet * 0.22, dry + wetR * 0.22], axis=1)
    if style == "whisper":
        y = bandpass(x, 120, 7000)
        wetL = signal.fftconvolve(y, room_ir(1.0, 0.18, 3)[:, 0])
        wetR = signal.fftconvolve(y, room_ir(1.0, 0.18, 4)[:, 0])
        n = len(y) + int(0.25 * SR)
        dry = np.concatenate([y, np.zeros(n - len(y))])
        return np.stack([dry + wetL[:n] * 0.3, dry + wetR[:n] * 0.3], axis=1)
    # deadpan: nearly dry, close-mic
    y = bandpass(x, 90, 9000, order=2)
    wetL = signal.fftconvolve(y, room_ir(0.6, 0.08, 5)[:, 0])
    wetR = signal.fftconvolve(y, room_ir(0.6, 0.08, 6)[:, 0])
    n = len(y) + int(0.15 * SR)
    dry = np.concatenate([y, np.zeros(n - len(y))])
    return np.stack([dry + wetL[:n] * 0.12, dry + wetR[:n] * 0.12], axis=1)


def main():
    voice = np.zeros((N, 2))
    duck = np.zeros(N)
    for text, t0, style, gain_db, speed, half in LINES:
        v = process(tts(text, speed, half), style) * (10 ** (gain_db / 20)) * 0.5
        i0 = int(round(t0 * SR))
        i1 = min(N, i0 + len(v))
        voice[i0:i1] += v[: i1 - i0]
        # hard stop "しかし" before the drop so the drop transient stays clean
        if style == "whisper":
            stop = int(round(cue("impact_big") * SR)) - int(0.02 * SR)
            fl = int(0.03 * SR)
            voice[stop - fl: stop] *= np.linspace(1, 0, fl)[:, None]
            voice[stop: stop + int(1.0 * SR)] = 0
        duck[i0:i1] = 1.0
        print(f"{t0:7.3f}s  {style:8s}  {(i1 - i0) / SR:5.2f}s  {text}")

    # smooth ducking envelope: ~30 ms pre-roll (attack), one-pole 250 ms release
    r = np.exp(-1 / (0.25 * SR))
    pre = np.convolve(duck, np.ones(int(0.03 * SR)), mode="same") > 0
    env = signal.lfilter([1 - r], [1, -r], pre.astype(np.float64))
    env = np.clip(env * 1.6, 0, 1)

    sf.write(os.path.join(HERE, "voice.wav"), np.clip(voice, -1, 1), SR, subtype="PCM_24")

    bgm_path = os.path.join(HERE, "bgm.wav")
    if not os.path.exists(bgm_path):
        print("bgm.wav missing -> wrote voice.wav only")
        return
    bgm, sr = sf.read(bgm_path, always_2d=True)
    assert sr == SR, sr
    bgm = bgm[:N]
    if len(bgm) < N:
        bgm = np.concatenate([bgm, np.zeros((N - len(bgm), 2))])
    duck_gain = 10 ** (-6.0 * env / 20)  # up to -6 dB under the voice
    mix = bgm * duck_gain[:, None] + voice * 0.9

    # final safety limiter: soft knee above -1.5 dBFS, hard ceiling -1.0 dBFS
    ceiling = 10 ** (-1.0 / 20)
    peak = np.abs(mix).max()
    if peak > ceiling:
        knee = 10 ** (-3.0 / 20)
        s = np.sign(mix)
        m = np.abs(mix)
        over = m > knee
        m[over] = knee + (ceiling - knee) * np.tanh((m[over] - knee) / (ceiling - knee))
        mix = s * m
    fade = int(0.01 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
    sf.write(os.path.join(HERE, "final_mix.wav"), mix, SR, subtype="PCM_24")
    print(f"final_mix.wav: {len(mix)} samples, peak {20*np.log10(np.abs(mix).max()+1e-12):.2f} dBFS")


if __name__ == "__main__":
    main()
