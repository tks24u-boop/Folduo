#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KIOXIA SHOCK -- デブリになる3秒前 : original score + sound design (45.000 s)

100 % original synthesis (numpy / scipy): no samples, no downloads.
Output: audio/bgm.wav  -- 48 kHz, 24-bit PCM, stereo, exactly duration*48000 samples.

Every event time is read from src/cues.json (sections + sfx cues) and the musical grid is derived
from its bpm, so picture and sound stay locked.  128 BPM, F minor, 24 bars.

    python3 audio/bgm.py            # render + verify + plots (scratch/bgm/*.png)
    python3 audio/bgm.py --no-plots

Signal flow
    instruments/sfx -> per-segment buses (kick, drums, bass, music, fx, lowfx) + reverb sends
    (room / hall / dark: convolution with synthetic stereo IRs)
    -> per-bus EQ (HP 150 Hz on non-bass buses), sidechain pumping, glue compression
    -> segments are hard-gated (glitch cut at 8.906, hard cut at 35.625) so tails never leak into
       the silences -> master: HP, glue comp, 2x-oversampled soft clipper,
       true-peak-aware look-ahead brickwall limiter, loudness loop to -10 LUFS
    -> post: tinnitus + heartbeat, fade to digital silence, 24-bit write, verification.
"""
import argparse
import json
import os
import re
import sys
import time

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d
import soundfile as sf
import pyloudnorm as pyln

T_START = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_WAV = os.path.join(HERE, 'bgm.wav')
SCRATCH = os.path.join(ROOT, 'scratch', 'bgm')


def log(msg):
    print(f'[{time.time() - T_START:6.1f}s] {msg}', flush=True)


# ============================================================================================
# Cues / grid (single source of truth: src/cues.json)
# ============================================================================================
with open(os.path.join(ROOT, 'src', 'cues.json'), encoding='utf-8') as _f:
    CUES = json.load(_f)

SR = 48000
DUR = float(CUES['duration'])
N = int(round(DUR * SR))
BPM = float(CUES['bpm'])
BEAT = 60.0 / BPM
BAR = 4.0 * BEAT
S16 = BEAT / 4.0
S32 = BEAT / 8.0
SECTIONS = [(s['id'], float(s['start']), float(s['end'])) for s in CUES['sections']]
SEC = {k: (a, b) for k, a, b in SECTIONS}


def cue_list(kind):
    return [float(c['t']) for c in CUES['sfx'] if c['type'] == kind]


def cue(kind, i=0):
    lst = cue_list(kind)
    if len(lst) <= i:
        raise KeyError(f'cue {kind}[{i}] missing from cues.json')
    return lst[i]


def cue_span(kind, i=0, default_len=None):
    """(start, end) of a ranged cue; the end is parsed from its note ('... a -> b ...')."""
    c = [c for c in CUES['sfx'] if c['type'] == kind][i]
    t0 = float(c['t'])
    m = re.search(r'(\d+(?:\.\d+)?)\s*->\s*(\d+(?:\.\d+)?)', c.get('note', ''))
    if m:
        return t0, float(m.group(2))
    return t0, (t0 + default_len if default_len else None)


def B(bar, beat=0.0):
    """Musical position -> seconds (bar 1-indexed, beat 0-indexed), same as src/lib/beats.js."""
    return (bar - 1) * BAR + beat * BEAT


def bar_at(t):
    return int(np.floor(t / BAR + 1e-6)) + 1


T_BOOT = cue('boot')
T_WSOFT = cue('whoosh_soft')
T_SUN = cue('sunrise')
T_RISEHIT = cue('rise_hit')
T_RISER, T_RISER_END = cue_span('riser_start')
T_GLITCH = cue('glitch_cut')
T_DROP = SEC['drop'][0]
T_DECAY = SEC['decay'][0]
T_FINALE = SEC['finale'][0]
T_ALARM, T_ALARM_END = cue_span('alarm_start')
T_REENTRY, T_REENTRY_END = cue_span('reentry')
T_COUNTER, T_COUNTER_END = cue_span('counter')
T_COUNTS = cue_list('count')
T_CUT = cue('silence')
T_HUGE = cue('impact_huge')
T_PON = cue('pon')
T_OUTRO = cue('outro_start')
T_CAPTURE = cue('capture')
T_END = cue('end_card')
T_FADE = cue('fade')
IMPACT_BIG = cue_list('impact_big')
IMPACTS = cue_list('impact')
WHOOSHES = cue_list('whoosh')

assert abs(IMPACT_BIG[0] - T_DROP) < 1e-9, 'drop section must start on the first impact_big'
assert abs(T_CUT - T_FINALE) < 1e-9

GLITCH_TAIL = 0.039            # stutter/tape-stop tail after the glitch cue, then true silence
SUCK_LEN = 0.225               # reversed "suck" swelling into the drop (starts ~9.15)
T_GLITCH_END = T_GLITCH + GLITCH_TAIL
T_SUCK = T_DROP - SUCK_LEN

# ============================================================================================
# DSP basics
# ============================================================================================
SQ2 = np.sqrt(2.0)


def ts(t):
    return int(round(t * SR))


def tvec(n):
    return np.arange(n) / SR


def db2a(d):
    return 10.0 ** (d / 20.0)


def a2db(a):
    return 20.0 * np.log10(np.maximum(a, 1e-12))


def rng(seed):
    return np.random.default_rng(seed)


NOTE_PC = {'C': 0, 'Db': 1, 'C#': 1, 'D': 2, 'Eb': 3, 'D#': 3, 'E': 4, 'F': 5, 'Gb': 6, 'F#': 6,
           'G': 7, 'Ab': 8, 'G#': 8, 'A': 9, 'Bb': 10, 'A#': 10, 'B': 11}


def hz(name):
    m = re.fullmatch(r'([A-G][b#]?)(-?\d)', name)
    midi = 12 * (int(m.group(2)) + 1) + NOTE_PC[m.group(1)]
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def smoothstep(u):
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


# --- oscillators (polyBLEP band-limited) ------------------------------------------------------
def _phase(freq, n, ph0=0.0):
    if np.ndim(freq) == 0:
        dt = np.full(n, float(freq) / SR)
    else:
        dt = np.asarray(freq, float)[:n] / SR
    ph = np.cumsum(dt) - dt + ph0
    ph -= np.floor(ph)
    return ph, dt


def _blep(t, dt):
    y = np.zeros_like(t)
    m = t < dt
    if m.any():
        x = t[m] / dt[m]
        y[m] = x + x - x * x - 1.0
    m = t > 1.0 - dt
    if m.any():
        x = (t[m] - 1.0) / dt[m]
        y[m] = x * x + x + x + 1.0
    return y


def saw(freq, n, ph0=0.0):
    t, dt = _phase(freq, n, ph0)
    return 2.0 * t - 1.0 - _blep(t, dt)


def pulse(freq, n, ph0=0.0, pw=0.5):
    t, dt = _phase(freq, n, ph0)
    t2 = t + (1.0 - pw)
    t2 -= np.floor(t2)
    return (2.0 * t - 1.0 - _blep(t, dt)) - (2.0 * t2 - 1.0 - _blep(t2, dt))


def sine(freq, n, ph0=0.0):
    t, _ = _phase(freq, n, ph0)
    return np.sin(2.0 * np.pi * t)


SS_OFF = np.array([-1.0, -0.66, -0.31, 0.0, 0.29, 0.63, 0.97])
SS_AMP = np.array([0.72, 0.80, 0.90, 1.00, 0.90, 0.80, 0.72])


def supersaw(freq, n, detune=28.0, width=0.85, seed=0):
    """7 detuned band-limited saws (detune = outer voice offset in cents), spread in stereo."""
    r = rng(seed)
    out = np.zeros((2, n))
    for o, a in zip(SS_OFF, SS_AMP):
        v = saw(freq * 2.0 ** (o * detune / 1200.0), n, r.random()) * a
        ang = (o * width + 1.0) * np.pi / 4.0
        out[0] += v * np.cos(ang) * SQ2
        out[1] += v * np.sin(ang) * SQ2
    return out / 3.0


def ss_chord(notes, n, detune=28.0, width=0.85, seed=0):
    x = np.zeros((2, n))
    for i, nm in enumerate(notes):
        f = hz(nm) if isinstance(nm, str) else nm
        x += supersaw(f, n, detune, width, seed * 31 + i)
    return x / np.sqrt(len(notes))


# --- filters ------------------------------------------------------------------------------------
def lpf(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'lowpass', fs=SR, output='sos'), x, axis=-1)


def hpf(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'highpass', fs=SR, output='sos'), x, axis=-1)


def bpf(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), x, axis=-1)


def peak_eq(x, f, g_db, q=1.0):
    A = 10 ** (g_db / 40.0)
    w = 2 * np.pi * f / SR
    al = np.sin(w) / (2 * q)
    b = np.array([1 + al * A, -2 * np.cos(w), 1 - al * A])
    a = np.array([1 + al / A, -2 * np.cos(w), 1 - al / A])
    return signal.lfilter(b / a[0], a / a[0], x, axis=-1)


def shelf(x, f, g_db, kind='high', s=0.8):
    A = 10 ** (g_db / 40.0)
    w = 2 * np.pi * f / SR
    cw, sw = np.cos(w), np.sin(w)
    al = sw / 2 * np.sqrt((A + 1 / A) * (1 / s - 1) + 2)
    sa = 2 * np.sqrt(A) * al
    if kind == 'high':
        b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
        a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
    else:
        b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
        a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
    b, a = np.array(b), np.array(a)
    return signal.lfilter(b / a[0], a / a[0], x, axis=-1)


def os_tanh(x, drive, bias=0.0):
    """tanh waveshaper run at 2x oversampling (anti-aliased)."""
    up = signal.resample_poly(x, 2, 1, axis=-1)
    up = np.tanh(drive * up + bias) - np.tanh(bias)
    return signal.resample_poly(up, 1, 2, axis=-1)


def _rbj(kind, fc, q):
    fc = np.clip(fc, 8.0, 0.46 * SR)
    w0 = 2 * np.pi * fc / SR
    cw, sw = np.cos(w0), np.sin(w0)
    al = sw / (2 * q)
    if kind == 'lp':
        b0 = (1 - cw) / 2
        b1 = 1 - cw
        b2 = b0
    elif kind == 'hp':
        b0 = (1 + cw) / 2
        b1 = -(1 + cw)
        b2 = b0
    else:  # band-pass, 0 dB peak
        b0 = al
        b1 = 0 * cw
        b2 = -al
    a0 = 1 + al
    return b0 / a0, b1 / a0, b2 / a0, -2 * cw / a0, (1 - al) / a0


def tvf(x, fc, q=0.707, kind='lp', block=32):
    """Time-varying RBJ biquad (coefficients updated every `block` samples, state carried)."""
    x = np.asarray(x, float)
    n = x.shape[-1]
    fc = np.full(n, float(fc)) if np.ndim(fc) == 0 else np.asarray(fc, float)
    nb = (n + block - 1) // block
    idx = np.minimum(np.arange(nb) * block + block // 2, n - 1)
    qb = q if np.ndim(q) == 0 else np.asarray(q)[idx]
    b0, b1, b2, a1, a2 = _rbj(kind, fc[idx], qb)
    y = np.empty_like(x)
    zi = np.zeros(x.shape[:-1] + (2,))
    lf = signal.lfilter
    for i in range(nb):
        s = i * block
        e = min(n, s + block)
        y[..., s:e], zi = lf((b0[i], b1[i], b2[i]), (1.0, a1[i], a2[i]), x[..., s:e], axis=-1, zi=zi)
    return y


# --- envelopes / utilities ---------------------------------------------------------------------
def env_ahd(n, att=0.001, hold=0.0, dec=0.2):
    t = tvec(n)
    a = np.sin(0.5 * np.pi * np.clip(t / max(att, 1e-6), 0, 1)) ** 2
    return a * np.exp(-np.maximum(t - att - hold, 0.0) / dec)


def env_asr(n, att, sus, rel):
    """attack (sin^2) -> sustain until `sus` s -> cosine release over `rel` s."""
    t = tvec(n)
    a = np.sin(0.5 * np.pi * np.clip(t / max(att, 1e-6), 0, 1)) ** 2
    r = 0.5 + 0.5 * np.cos(np.pi * np.clip((t - sus) / max(rel, 1e-6), 0, 1))
    return a * r


def fades(x, fin=0.001, fout=0.004):
    x = np.array(x, float, copy=True)
    n = x.shape[-1]
    a = min(ts(fin), n // 2)
    b = min(ts(fout), n // 2)
    if a > 0:
        x[..., :a] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(a) / a)
    if b > 0:
        x[..., n - b:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(1, b + 1) / b)
    return x


def pan(x, p=0.0):
    x = np.asarray(x, float)
    ang = (np.clip(p, -1, 1) + 1.0) * np.pi / 4.0
    if x.ndim == 2:
        if np.ndim(p) == 0 and p == 0:
            return x
        return np.vstack([x[0] * np.cos(ang) * SQ2, x[1] * np.sin(ang) * SQ2])
    return np.vstack([x * np.cos(ang) * SQ2, x * np.sin(ang) * SQ2])


def norm_peak(x, peak=1.0):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def pingpong(x, delay, fb=0.38, taps=4, lp=5500.0):
    """Stereo ping-pong echo (returns a longer array)."""
    d = ts(delay)
    n = x.shape[-1]
    out = np.zeros((2, n + taps * d))
    out[:, :n] += x
    mono = lpf(0.5 * (x[0] + x[1]), lp)
    for k in range(1, taps + 1):
        g = fb ** k
        gl, gr = (0.3, 1.0) if k % 2 else (1.0, 0.3)
        out[0, k * d:k * d + n] += mono * g * gl
        out[1, k * d:k * d + n] += mono * g * gr
    return out


def place(buf, sig, i):
    """Add stereo `sig` into stereo `buf` starting at sample i (clipped)."""
    s0 = 0
    if i < 0:
        s0 = -i
        i = 0
    n = min(sig.shape[-1] - s0, buf.shape[-1] - i)
    if n > 0:
        buf[:, i:i + n] += sig[:, s0:s0 + n]


class Clip:
    """Local stereo buffer for assembling a part before global processing."""

    def __init__(self, t0, t1):
        self.t0 = t0
        self.i0 = ts(t0)
        self.x = np.zeros((2, ts(t1) - self.i0))

    def add(self, sig, t, gain=1.0, p=0.0):
        sig = np.asarray(sig, float)
        s = pan(sig, p) if (sig.ndim == 1 or np.ndim(p) or p) else sig
        place(self.x, s * gain, ts(t) - self.i0)


def note_line(events, t0, n, glide=0.02):
    """Per-sample frequency from [(t_abs, hz), ...] with exponential portamento."""
    lf = np.full(n, np.log2(events[0][1]))
    for te, f in events:
        lf[max(0, ts(te - t0)):] = np.log2(f)
    if glide > 0:
        a = np.exp(-1.0 / (glide * SR))
        lf = signal.lfilter([1 - a], [1, -a], lf, zi=[lf[0] * a])[0]
    return 2.0 ** lf


# ============================================================================================
# Instruments
# ============================================================================================
KICK_P = dict(
    build=dict(f0=210, f1=52, tp=0.026, hold=0.035, dec=0.17, click=0.35, drive=1.8, dur=0.42),
    drop=dict(f0=280, f1=52, tp=0.021, hold=0.045, dec=0.21, click=0.60, drive=2.4, dur=0.50),
    half=dict(f0=250, f1=46, tp=0.030, hold=0.075, dec=0.40, click=0.50, drive=2.6, dur=0.95),
    outro=dict(f0=260, f1=52, tp=0.023, hold=0.040, dec=0.20, click=0.55, drive=2.2, dur=0.50),
)


def kick(style='drop', seed=1):
    p = KICK_P[style]
    r = rng(seed)
    n = ts(p['dur'])
    t = tvec(n)
    f = p['f1'] + (p['f0'] - p['f1']) * np.exp(-t / p['tp']) + 900 * np.exp(-t / 0.0015)
    body = sine(f, n) * env_ahd(n, 0.0004, p['hold'], p['dec'])
    clk = bpf(r.standard_normal(n), 1400, 9000) * np.exp(-t / 0.0022)
    clk += 0.6 * sine(3300, n) * np.exp(-t / 0.003)
    y = body + p['click'] * clk
    y = np.tanh(p['drive'] * y) / np.tanh(p['drive'])
    return fades(y, 0.0, 0.03)


def snare(seed=0, tune=1.0, dur=0.30, tail=0.11):
    r = rng(seed)
    n = ts(dur)
    t = tvec(n)
    f = 195 * tune * (1 + 0.55 * np.exp(-t / 0.008))
    body = sine(f, n) * np.exp(-t / 0.055) + 0.45 * sine(f * 1.63, n) * np.exp(-t / 0.028)
    nz = bpf(r.standard_normal(n), 1200, 7000) * np.exp(-t / tail)
    nz = peak_eq(nz, 2200, 3.0, 1.0)
    y = 1.0 * body + 1.0 * nz
    y = np.tanh(1.6 * y)
    return fades(y, 0.0003, 0.02)


def clap(seed=0, dur=0.42, tail=0.12):
    r = rng(seed)
    n = ts(dur)
    t = tvec(n)
    out = np.zeros((2, n))
    for ch in range(2):
        e = np.zeros(n)
        for tk, g in zip((0.0, 0.0092, 0.0191, 0.0285), (0.65, 0.8, 0.9, 1.0)):
            e += g * np.exp(-np.maximum(t - tk, 0) / 0.0034) * (t >= tk)
        e += 0.75 * np.exp(-np.maximum(t - 0.0285, 0) / tail) * (t >= 0.0285)
        x = bpf(r.standard_normal(n), 850, 4200) * e
        out[ch] = peak_eq(x, 1300, 3.0, 1.2)
    return fades(np.tanh(1.3 * out), 0.0003, 0.03)


HAT_F = np.array([205.3, 304.4, 369.6, 522.7, 540.0, 800.0])


def hat(seed=0, open_=False):
    r = rng(seed)
    n = ts(0.55 if open_ else 0.09)
    metal = sum(pulse(f * r.uniform(1.95, 2.05), n, r.random()) for f in HAT_F) / 6.0
    x = 0.5 * metal + 0.7 * r.standard_normal(n)
    x = lpf(hpf(x, 7200, 4), 14000)
    x *= env_ahd(n, 0.0004, 0.0, 0.15 if open_ else 0.021)
    return fades(x, 0.0002, 0.01)


def crash(seed=0, dur=2.8, tau=0.9, dark=False):
    r = rng(seed)
    n = ts(dur)
    t = tvec(n)
    out = np.zeros((2, n))
    for ch in range(2):
        metal = sum(pulse(f * r.uniform(3.1, 3.7), n, r.random()) for f in HAT_F) / 6.0
        x = 0.55 * metal + 0.8 * r.standard_normal(n)
        lo = hpf(x, 1100 if dark else 2400)
        lo = lpf(lo, 6500 if dark else 9000)
        hi = hpf(x, 9000) if not dark else 0.0
        e1 = env_ahd(n, 0.0008, 0.0, tau) * (1 + 1.3 * np.exp(-t / 0.02))
        e2 = env_ahd(n, 0.0005, 0.0, tau * 0.55) * (1 + 2.0 * np.exp(-t / 0.015))
        out[ch] = lo * e1 + 0.55 * hi * e2
    out = np.tanh(1.3 * out) / 1.3
    return fades(out, 0.0004, 0.08)


def ss_pluck(freq, dur=0.26, seed=0, detune=24, dec=0.10, cut_lo=450, cut_hi=5000, fdec=0.07,
             q=0.9, width=0.85):
    n = ts(dur)
    t = tvec(n)
    x = supersaw(freq, n, detune, width, seed)
    fc = cut_lo + (cut_hi - cut_lo) * np.exp(-t / fdec)
    y = tvf(x, fc, q, 'lp', 48)
    return fades(y * env_ahd(n, 0.0015, 0.0, dec), 0.0005, 0.01)


def soft_pluck(freq, dur=0.3, seed=0):
    r = rng(seed)
    n = ts(dur)
    x = saw(freq, n, r.random()) + 0.6 * pulse(freq * 1.004, n, r.random()) + 0.4 * sine(freq * 0.5, n)
    x = lpf(x, 5500)
    return fades(x * env_ahd(n, 0.0015, 0.0, 0.09), 0.0005, 0.01)


def stab(notes, dur=0.24, seed=0, cut=5200, dec=0.13, detune=26):
    n = ts(dur)
    t = tvec(n)
    x = ss_chord(notes, n, detune, 0.95, seed)
    fc = cut * 0.3 + cut * 0.7 * np.exp(-t / 0.07)
    y = tvf(x, fc, 0.85, 'lp', 48)
    return fades(y * env_ahd(n, 0.002, 0.012, dec), 0.0008, 0.015)


def big_chord(notes, dur, seed=0, att=0.008, rel=0.25, cut=7500, detune=30, dec=None):
    n = ts(dur + rel)
    x = ss_chord(notes, n, detune, 1.0, seed)
    x = lpf(x, cut)
    e = env_asr(n, att, dur, rel)
    if dec:
        e *= np.exp(-tvec(n) / dec)
    return fades(x * e, 0.0005, 0.01)


def pad(notes, dur, seed=0, att=0.6, rel=0.8, cut=900, detune=12, q=0.8, lfo=0.0):
    n = ts(dur + rel)
    x = ss_chord(notes, n, detune, 0.9, seed)
    if lfo:
        t = tvec(n)
        fc = cut * 2 ** (0.5 * np.sin(2 * np.pi * lfo * t))
        x = tvf(x, fc, q, 'lp', 128)
    else:
        x = lpf(x, cut)
    return fades(x * env_asr(n, att, dur, rel), 0.001, 0.01)


def pluck_bass(freq, dur=0.2, seed=0):
    r = rng(seed)
    n = ts(dur)
    t = tvec(n)
    x = saw(freq, n, r.random()) + 0.6 * saw(freq * 1.006, n, r.random()) + 0.4 * pulse(freq, n, r.random())
    y = tvf(x, 160 + 2600 * np.exp(-t / 0.045), 1.3, 'lp', 32)
    s = sine(freq * 0.5 if freq * 0.5 >= 40.0 else freq, n)
    e = env_ahd(n, 0.002, 0.04, 0.085)
    return fades((0.45 * y + 0.9 * s) * e, 0.001, 0.012)


def reese(freq, cut, seed=0, q=3.0, drive=2.4, width=0.6, hp=90.0):
    n = len(freq)
    r = rng(seed)
    x = np.zeros((2, n))
    for ch in range(2):
        d = (0.10, 0.125)[ch]
        x[ch] = (saw(freq * 2 ** (-d / 12), n, r.random()) + saw(freq * 2 ** (d / 12), n, r.random())
                 + 0.5 * saw(freq * 2.0 * 2 ** ((0.04 if ch else -0.04) / 12), n, r.random())
                 + 0.4 * pulse(freq, n, r.random()))
    x *= 0.45
    y = tvf(x, cut, 0.7, 'lp', 32)
    y = tvf(y, cut * 1.1, q, 'lp', 32)
    y = os_tanh(y, drive, 0.12)
    y = hpf(y, hp, 4)
    y = lpf(y, 9000)
    y = peak_eq(y, 1100, 3.0, 0.9)
    y = peak_eq(y, 650, 2.5, 1.0)
    m = 0.5 * (y[0] + y[1])
    s = hpf(0.5 * (y[0] - y[1]), 220) * width
    return np.vstack([m + s, m - s])


def sub_line(freq):
    n = len(freq)
    return np.tanh(1.25 * sine(freq, n)) / np.tanh(1.25)


def fm_bell(f, dur=1.6, ratio=3.5, index=4.0, seed=0):
    n = ts(dur)
    t = tvec(n)
    I = index * np.exp(-t / 0.25) + 0.3
    y = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * ratio * t))
    return fades(y * env_ahd(n, 0.001, 0.0, 0.45), 0.0005, 0.02)


# ============================================================================================
# Sound effects
# ============================================================================================
IMP_P = dict(
    soft=dict(dur=1.3, f0=120, f1=40, tp=0.06, hold=0.03, dec=0.40, drive=1.4, crack=0.15, ctau=0.010, boom=0.25, btau=0.20),
    small=dict(dur=1.6, f0=160, f1=44, tp=0.045, hold=0.035, dec=0.42, drive=1.9, crack=0.65, ctau=0.012, boom=0.40, btau=0.16),
    big=dict(dur=3.2, f0=150, f1=45, tp=0.07, hold=0.12, dec=0.85, drive=2.3, crack=1.0, ctau=0.020, boom=0.60, btau=0.45),
    huge=dict(dur=6.5, f0=170, f1=30, tp=0.03, hold=0.25, dec=1.5, drive=2.6, crack=1.2, ctau=0.030, boom=0.80, btau=1.20),
)


def impact(kind='small', seed=0):
    """Returns (low mono -> lowfx bus, high stereo -> fx bus)."""
    p = IMP_P[kind]
    r = rng(seed)
    n = ts(p['dur'])
    t = tvec(n)
    if kind == 'huge':   # punch, then sub drop 60 -> 30 Hz
        f = 30 + 30 * np.exp(-t / 0.75) + 110 * np.exp(-t / 0.025)
    else:
        f = p['f1'] + (p['f0'] - p['f1']) * np.exp(-t / p['tp'])
    low = sine(f, n) * env_ahd(n, 0.0005, p['hold'], p['dec'])
    low = np.tanh(p['drive'] * low) / np.tanh(p['drive'])
    body = sine(f * 2.02, n) * np.exp(-t / 0.07) * 0.35
    boom = norm_peak(lpf(r.standard_normal(n), 170, 4)) * np.exp(-t / p['btau']) * p['boom']
    low = fades(low + body + boom * 0.6, 0.0, 0.05)
    hi = np.zeros((2, n))
    for ch in range(2):
        c = r.standard_normal(n) * np.exp(-t / p['ctau'])
        c = np.tanh(2.5 * hpf(c, 700)) * p['crack']
        tear = bpf(r.standard_normal(n), 250, 2800) * np.exp(-t / (p['ctau'] * 9)) * 0.28 * p['crack']
        hi[ch] = c + tear
    if kind in ('big', 'huge'):
        cr = crash(seed + 7, dur=p['dur'] * (0.9 if kind == 'huge' else 0.8), tau=1.1 if kind == 'huge' else 0.9,
                   dark=(kind == 'huge'))
        if kind == 'huge':
            cr = lpf(np.tanh(4.0 * cr), 8000)
        m = min(n, cr.shape[1])
        hi[:, :m] += cr[:, :m] * (0.35 if kind == 'huge' else 0.45)
    if kind == 'huge':
        hi = tvf(hi, 14000 * (1200 / 14000) ** np.clip(t / 2.5, 0, 1), 0.7, 'lp', 128)   # tail darkens
        rum = lpf(r.standard_normal((2, n)), 95, 4)
        low += norm_peak(rum.mean(0)) * np.exp(-t / 1.8) * 0.35
    return low, fades(hi, 0.0, 0.05)


def shatter(seed=5, dur=2.4):
    r = rng(seed)
    n = ts(dur)
    out = np.zeros((2, n))
    cn = ts(0.08)
    ct = tvec(cn)
    c = r.standard_normal((2, cn)) * np.exp(-ct / 0.009)
    out[:, :cn] += np.tanh(3.0 * hpf(c, 1500)) * 0.9
    times = np.concatenate([r.exponential(0.28, 380), r.uniform(0.0, 0.07, 70), r.uniform(0.2, 1.6, 40)])
    for tg in times:
        if tg > dur - 0.15:
            continue
        amp = r.uniform(0.15, 1.0) * np.exp(-tg / 0.55)
        p = r.uniform(-1, 1)
        if r.random() < 0.55:          # bright glass grain
            L = int(r.integers(ts(0.0008), ts(0.006)))
            g = r.standard_normal(L) * np.exp(-np.arange(L) / (L * 0.3))
            g = np.diff(g, prepend=0.0)
            if r.random() < 0.5:
                g = np.diff(g, prepend=0.0) * 0.6
        else:                           # metallic / glass ping
            f = r.uniform(1800, 9500)
            L = ts(r.uniform(0.02, 0.14))
            tt = tvec(L)
            g = (np.sin(2 * np.pi * f * tt) + 0.6 * np.sin(2 * np.pi * f * 2.76 * tt + 1.0)
                 + 0.35 * np.sin(2 * np.pi * f * 5.40 * tt + 2.0)) * np.exp(-tt / (L / SR * 0.28))
            g *= np.minimum(1.0, tt / 0.0003)
            amp *= 0.55
        g = fades(g, 0.0002, 0.0005)
        place(out, pan(g * amp, p), ts(tg))
    return fades(out, 0.0, 0.05)


def whoosh(dur=0.9, peak=0.6, f_lo=300, f_hi=4500, q=1.1, seed=0, p0=-0.7, p1=0.7, air=0.3):
    r = rng(seed)
    n = ts(dur)
    u = tvec(n) / dur
    sh = np.clip(np.where(u < peak, u / peak, (1 - u) / (1 - peak)), 0, 1)
    amp = np.where(u < peak, sh ** 2.0, sh ** 1.4)
    fc = f_lo * (f_hi / f_lo) ** sh
    out = np.zeros((2, n))
    pp = p0 + (p1 - p0) * smoothstep(u)
    for ch in range(2):
        nz = signal.lfilter([1], [1, -0.55], r.standard_normal(n))
        y = tvf(nz, fc, q, 'bp', 64) * amp
        y += hpf(r.standard_normal(n), 5000) * amp ** 2 * air
        ang = (np.clip(pp, -1, 1) + 1) * np.pi / 4
        out[ch] = y * (np.cos(ang) if ch == 0 else np.sin(ang)) * SQ2
    return fades(norm_peak(out), 0.003, 0.01)


def whoosh_down(dur=1.35, seed=0):
    r = rng(seed)
    n = ts(dur)
    t = tvec(n)
    u = t / dur
    fc = 7500 * (130 / 7500) ** (u ** 0.75)
    amp = np.minimum(1, t / 0.07) ** 1.5 * (1 - u) ** 1.4
    out = np.zeros((2, n))
    for ch in range(2):
        y = tvf(r.standard_normal(n), fc, 1.6, 'bp', 64)
        out[ch] = y
    out = norm_peak(out) * amp
    tf = 45 * (1100 / 45) ** ((1 - u) ** 1.6)
    tone = lpf(saw(tf, n) + 0.5 * saw(tf * 1.01, n), 2500) * amp * 0.28
    out += tone
    return fades(out, 0.002, 0.02)


def riser(dur, seed=0, f0=300, f1=9000, q0=1.2, q1=3.0, curve=1.6):
    r = rng(seed)
    n = ts(dur)
    u = tvec(n) / dur
    fc = f0 * (f1 / f0) ** (u ** curve)
    q = q0 + (q1 - q0) * u
    out = np.zeros((2, n))
    for ch in range(2):
        out[ch] = tvf(r.standard_normal(n), fc, 1.0, 'bp', 64) * 0.7 + tvf(r.standard_normal(n), fc * 1.5, q * 2, 'bp', 64) * 0.3
    amp = db2a(-26 * (1 - u) ** 1.3)
    return fades(norm_peak(out) * amp, 0.01, 0.004)


def reverse_suck(dur, ir, seed=0):
    r = rng(seed)
    n = ts(0.06)
    t = tvec(n)
    hit = (bpf(r.standard_normal(n), 400, 9000) * np.exp(-t / 0.012) + 0.6 * sine(220 * (1 + np.exp(-t / 0.01)), n) * np.exp(-t / 0.03))
    wet = np.vstack([signal.fftconvolve(hit, ir[0]), signal.fftconvolve(hit, ir[1])])
    rev = wet[:, ::-1]
    m = ts(dur)
    rev = rev[:, -m:]
    u = tvec(m) / dur
    rev = norm_peak(rev) * u ** 1.5
    return fades(rev, 0.004, 0.003)


def reverse_crash(dur, seed=0, tau=0.7):
    c = crash(seed, dur=dur + 0.3, tau=tau)[:, ::-1]
    c = c[:, -ts(dur):]
    u = tvec(c.shape[1]) / dur
    return fades(norm_peak(c) * u ** 1.2, 0.01, 0.003)


def tick(seed=0, f_ping=3000.0):
    r = rng(seed)
    n = ts(0.06)
    t = tvec(n)
    click = hpf(r.standard_normal(n), 2500) * np.exp(-t / 0.0007)
    ping = (np.sin(2 * np.pi * f_ping * t) * np.exp(-t / 0.011) + 0.5 * np.sin(2 * np.pi * f_ping * 2.41 * t) * np.exp(-t / 0.005))
    tock = np.sin(2 * np.pi * 820 * t) * np.exp(-t / 0.004)
    return fades(0.8 * click + 0.45 * ping + 0.5 * tock, 0.0002, 0.005)


def counter_ticks(t0, t1, seed=41):
    """Odometer ticks: 1/16 notes accelerating (exponentially) to 1/32 notes."""
    r = rng(seed)
    T = t1 - t0
    r0, k = 1.0 / S16, 2.0
    total = r0 * T * (k - 1) / np.log(k)
    clip = Clip(t0, t1 + 0.1)
    j = 0
    while j < total - 1e-6:
        u = np.log(1 + j * np.log(k) / (r0 * T)) / np.log(k)
        tt = t0 + u * T
        g = 0.55 + 0.45 * u + (0.25 if j % 4 == 0 else 0.0)
        clip.add(tick(seed + j, 2900 if j % 2 else 3450), tt, g * r.uniform(0.85, 1.0), p=0.25 if j % 2 else -0.25)
        j += 1
    return clip


def clank(seed=0, base=150.0):
    r = rng(seed)
    n = ts(1.4)
    t = tvec(n)
    ratios = [1.0, 2.32, 3.88, 5.61, 7.9, 10.3, 13.7]
    decays = [0.45, 0.35, 0.26, 0.18, 0.12, 0.09, 0.06]
    amps = [1.0, 0.7, 0.6, 0.45, 0.35, 0.25, 0.2]
    y = np.zeros(n)
    for rt, d, a in zip(ratios, decays, amps):
        y += a * np.sin(2 * np.pi * base * rt * r.uniform(0.99, 1.01) * t) * np.exp(-t / d)
    y += hpf(r.standard_normal(n), 1000) * np.exp(-t / 0.004) * 1.5
    y2 = np.zeros(n)
    d0 = ts(0.045)
    for rt, d, a in zip(ratios[:5], decays, amps):
        y2[d0:] += 0.5 * a * np.sin(2 * np.pi * base * 1.34 * rt * tvec(n - d0)) * np.exp(-tvec(n - d0) / (d * 0.6))
    y = np.tanh(1.4 * (y + y2) / 3.0)
    return fades(y, 0.0002, 0.05)


def alarm(t0, t1, seed=0):
    """Two-tone klaxon, alternating ~740/590 Hz each beat, band-passed + driven, getting louder."""
    clip = Clip(t0, t1 + 0.1)
    nb = int(round((t1 - t0) / BEAT))
    for k in range(nb):
        f = 740.0 if k % 2 == 0 else 590.0
        n = ts(BEAT - 0.03)
        t = tvec(n)
        ff = f * (1 + 0.004 * np.sin(2 * np.pi * 7 * t))
        y = 0.6 * pulse(ff, n, 0.1) + 0.4 * saw(ff * 1.003, n, 0.3)
        y = fades(y, 0.004, 0.014)
        u = k / max(1, nb - 1)
        clip.add(y, t0 + k * BEAT, db2a(-12 + 12 * u ** 1.2), p=0.22 if k % 2 == 0 else -0.22)
    x = bpf(clip.x, 480, 3200)
    x = os_tanh(x, 2.2) / 2.2 * 1.6
    x = peak_eq(x, 1500, 3.0, 1.0)
    clip.x = x
    return clip


def reentry(t0, t_peak, t_end, seed=0):
    """Plasma roar: brown noise with rising cutoff + rumble + crackle, rising to t_peak, hold to t_end."""
    r = rng(seed)
    n = ts(t_end - t0)
    t = tvec(n)
    u = np.clip(t / (t_peak - t0), 0, 1)
    fc = 160 * (4800 / 160) ** (u ** 1.25)
    out = np.zeros((2, n))
    for ch in range(2):
        br = signal.lfilter([1.0], [1.0, -0.995], r.standard_normal(n))
        br = hpf(br, 25)
        br /= np.std(br)
        roar = tvf(br, fc, 0.9, 'lp', 64)
        hiss = tvf(r.standard_normal(n), fc * 0.9, 1.4, 'bp', 64) * 0.18 * u
        rum = lpf(r.standard_normal(n), 85, 4)
        rum = rum / np.std(rum) * (1 + 0.5 * lpf(r.standard_normal(n), 3.0, 1) * 30)
        out[ch] = roar * 0.5 + hiss + rum * 0.25
    # crackle
    cr = np.zeros((2, n))
    tc = 0.0
    while True:
        uu = min(1.0, tc / (t_peak - t0))
        rate = 3 + 110 * uu ** 2
        tc += r.exponential(1.0 / rate)
        if tc >= t_end - t0 - 0.01:
            break
        L = ts(r.uniform(0.001, 0.004))
        g = r.standard_normal(L) * np.exp(-np.arange(L) / (L * 0.25))
        place(cr, pan(g * r.uniform(0.3, 1.0), r.uniform(-0.9, 0.9)), ts(tc))
    cr = bpf(cr, 1200, 7000) * 1.4
    out += cr
    out *= db2a(-30 + 30 * u ** 1.1)
    out = np.tanh(1.5 * out)
    return fades(out, 0.02, 0.002)


def beep(f, dur=0.15):
    n = ts(dur)
    y = sine(f, n) + 0.28 * sine(2 * f, n) + 0.1 * sine(3 * f, n)
    return fades(y * 0.7, 0.0015, 0.02)


def capture_sfx(seed=0):
    """Metallic docking clunk (modal) + magnetic FM shimmer + rising ring pulse. Returns (low, hi)."""
    r = rng(seed)
    n = ts(2.6)
    t = tvec(n)
    cl = clank(seed + 1, base=96.0)
    low = np.zeros(n)
    thud = sine(45 + 60 * np.exp(-t / 0.03), n) * env_ahd(n, 0.0005, 0.02, 0.18)
    low += thud
    hi = np.zeros((2, n))
    hi[:, :cl.shape[0]] += cl * 0.9
    fc = hz('Ab5')
    for ch, det in ((0, -3.0), (1, 3.0)):
        f = fc * 2 ** (det / 1200)
        I = 3.2 * np.exp(-t / 0.5) + 0.5
        fm = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * 1.5 * t))
        trem = 1 - 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * 14 * t))
        hi[ch] += fm * trem * env_ahd(n, 0.06, 0.05, 0.75) * 0.45
    sw_n = ts(0.4)
    swt = tvec(sw_n)
    sweep = np.sin(2 * np.pi * np.cumsum(500 * (2500 / 500) ** (swt / 0.4)) / SR) * np.sin(np.pi * swt / 0.4) ** 2
    hi[:, :sw_n] += sweep * 0.3
    return fades(low, 0.0, 0.05), fades(hi, 0.0005, 0.05)


def pon():
    """Cute 'ポンッ': sine pluck with a fast upward pitch bend, dry."""
    n = ts(0.24)
    t = tvec(n)
    f = 1150 - (1150 - 360) * np.exp(-t / 0.011)
    y = sine(f, n) * env_ahd(n, 0.0008, 0.012, 0.065)
    y += 0.22 * sine(2 * f, n) * np.exp(-t / 0.03)
    y += 0.3 * lpf(rng(3).standard_normal(n), 1500) * np.exp(-t / 0.003)
    return fades(y, 0.0003, 0.02)


def heartbeat(seed=0):
    n = ts(0.3)
    t = tvec(n)
    f = 44 + 26 * np.exp(-t / 0.03)
    y = sine(f, n) * env_ahd(n, 0.004, 0.01, 0.075)
    y += 0.25 * lpf(rng(seed).standard_normal(n), 220, 2) * np.exp(-t / 0.03)
    y = np.tanh(2.2 * y) / np.tanh(2.2)
    return fades(y, 0.001, 0.03)


def boot_blips(t0, t1, seed=7):
    r = rng(seed)
    clip = Clip(t0, t1 + 0.2)
    n = ts(0.42)
    t = tvec(n)
    f = 90 * (1600 / 90) ** ((t / 0.42) ** 0.7)
    y = sine(f, n) * env_ahd(n, 0.004, 0.06, 0.12) + 0.25 * lpf(pulse(f * 2, n), 5000) * env_ahd(n, 0.004, 0.02, 0.06)
    clip.add(fades(y, 0.001, 0.02), t0, 0.55)
    tones = [hz(x) for x in ('C6', 'F6', 'Ab6', 'C7', 'Eb7', 'G7')]
    for tg in np.arange(t0 + 2 * S32, t1 - 0.05, S32):
        u = (tg - t0) / (t1 - t0)
        if r.random() > 0.2 + 0.45 * (1 - u) ** 0.6:
            continue
        for rep in range(3 if r.random() < 0.15 else 1):
            f0 = tones[int(r.integers(len(tones)))]
            d = r.uniform(0.012, 0.04)
            m = ts(d)
            tt = tvec(m)
            b = sine(f0 * 2 ** (r.choice([-1, 1]) * r.uniform(0, 0.3) * tt / d), m)
            b = fades(b * np.exp(-tt / (d * 0.45)), 0.0008, 0.002)
            clip.add(b, tg + rep * S32 / 2, r.uniform(0.25, 0.7) * (0.45 + 0.55 * (1 - u)), p=r.uniform(-0.8, 0.8))
    return clip


def shimmer(dur, seed=0, grains=420, tau=1.3):
    r = rng(seed)
    n = ts(dur)
    t = tvec(n)
    out = np.zeros((2, n))
    for _ in range(grains):
        tg = r.exponential(tau * 0.6)
        if tg > dur - 0.1:
            continue
        f = r.uniform(3500, 12000)
        L = ts(r.uniform(0.006, 0.035))
        tt = tvec(L)
        g = np.sin(2 * np.pi * f * tt) * np.sin(np.pi * tt / (L / SR)) ** 2
        place(out, pan(g * r.uniform(0.2, 1.0) * np.exp(-tg / tau), r.uniform(-1, 1)), ts(tg))
    out += hpf(r.standard_normal((2, n)), 7000) * np.exp(-t / tau) * 0.25
    return fades(out, 0.004, 0.05)


# ============================================================================================
# Mixer (segment-aware so that hard cuts also cut reverb tails)
# ============================================================================================
BUSES = ('kick', 'drums', 'bass', 'reese', 'music', 'fx', 'lowfx', 'room', 'hall', 'dark')
SEG_T = (0.0, T_GLITCH_END, T_CUT, DUR)   # seg0: intro, seg1: drop+decay, seg2: finale


class Mix:
    def __init__(self):
        self.buf = {}
        self.kicks = {0: [], 1: [], 2: []}

    @staticmethod
    def seg_of(t):
        if t < T_GLITCH_END - 1e-9:
            return 0
        if t < T_CUT - 1e-9:
            return 1
        return 2

    def get(self, seg, bus):
        k = (seg, bus)
        if k not in self.buf:
            self.buf[k] = np.zeros((2, N))
        return self.buf[k]

    def add(self, bus, sig, t0, gain=1.0, p=0.0, sends=None, seg=None):
        sig = np.asarray(sig, float)
        s = pan(sig, p) if (sig.ndim == 1 or np.ndim(p) or p) else sig
        seg = self.seg_of(t0) if seg is None else seg
        s = s * gain
        place(self.get(seg, bus), s, ts(t0))
        for sb, amt in (sends or {}).items():
            place(self.get(seg, sb), s * amt, ts(t0))

    def kick(self, t, sig, gain=1.0, sidechain=True, sends=None):
        self.add('kick', sig, t, gain, sends=sends)
        if sidechain:
            self.kicks[self.seg_of(t)].append(t)


# ============================================================================================
# Arrangement
# ============================================================================================
STAB = {'Fm': ['F4', 'Ab4', 'C5', 'F5'], 'Db': ['F4', 'Ab4', 'Db5', 'F5'],
        'Ab': ['Eb4', 'Ab4', 'C5', 'Eb5'], 'Eb': ['Eb4', 'G4', 'Bb4', 'Eb5']}
ARP_T = {'Fm': ['F4', 'Ab4', 'C5'], 'Db': ['Db4', 'F4', 'Ab4'], 'Ab': ['Eb4', 'Ab4', 'C5'],
         'Eb': ['Eb4', 'G4', 'Bb4'], 'DbM': ['Db5', 'F5', 'Ab5'], 'EbM': ['Eb5', 'G5', 'Bb5'],
         'AbM': ['Eb5', 'Ab5', 'C6']}
BASS_N = {'Fm': 'F2', 'Db': 'Db2', 'Ab': 'Ab2', 'Eb': 'Eb2'}
ARP_PAT = [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 4, 1, 3, 2, 5]


def arp_note(chord, step, octave_shift=0):
    tones = ARP_T[chord]
    six = [hz(x) for x in tones] + [hz(x) * 2 for x in tones]
    return six[ARP_PAT[step % 16]] * 2 ** octave_shift


def compose(M, IR):
    r = rng(2026)
    K = {s: kick(s, seed=i + 1) for i, s in enumerate(KICK_P)}
    HC = [hat(100 + i) for i in range(6)]
    HO = [hat(200 + i, open_=True) for i in range(3)]
    SN = [snare(300 + i) for i in range(4)]
    CL = [clap(400 + i) for i in range(4)]

    def snare_hit(t, g=1.0, tune=1.0, seed=0, with_clap=True, sends=None):
        s = snare(seed, tune) if tune != 1.0 else SN[seed % 4]
        M.add('drums', s, t, 0.55 * g, sends=sends or {'room': 0.18, 'hall': 0.10})
        if with_clap:
            M.add('drums', CL[seed % 4], t, 0.5 * g, sends=sends or {'room': 0.18, 'hall': 0.12})

    def roll(times, g0, g1, tune0, tune1, seed, gain=1.0):
        for j, tt in enumerate(times):
            u = j / max(1, len(times) - 1)
            snare_hit(tt, gain * (g0 + (g1 - g0) * u ** 1.3), tune0 + (tune1 - tune0) * u, seed + j, with_clap=False,
                      sends={'room': 0.2, 'hall': 0.08})

    def hats16(bar, g=1.0, swing=0.016, open_off=True, closed=True, skip=()):
        for s in range(16):
            if s in skip:
                continue
            t = B(bar) + s * S16 + (swing if s % 2 else 0.0)
            if closed:
                v = (0.55, 0.32, 0.8, 0.4)[s % 4] * r.uniform(0.85, 1.0)
                M.add('drums', HC[int(r.integers(6))], t, 0.085 * g * v, p=0.18 if s % 2 else -0.1)
            if open_off and s % 4 == 2:
                M.add('drums', HO[int(r.integers(3))], t, 0.075 * g, p=0.05)

    # ------------------------------------------------------------------ INTRO (bars 1-2)
    log('compose: intro')
    bb = boot_blips(T_BOOT, T_SUN - 0.1)
    M.add('fx', bb.x, bb.t0, 0.30, sends={'hall': 0.35, 'room': 0.1})

    n = ts(T_SUN - T_BOOT + 0.7)
    t = tvec(n)
    hum = sine(hz('F1'), n) + 0.18 * sine(hz('F2'), n) + 0.06 * sine(hz('C3'), n)
    henv = smoothstep(t / 2.8) * (0.5 + 0.5 * np.cos(np.pi * np.clip((t - (T_SUN - T_BOOT)) / 0.7, 0, 1)))
    henv *= 1 + 0.12 * np.sin(2 * np.pi * 0.53 * t)
    M.add('bass', fades(hum * henv, 0.01, 0.02), T_BOOT, 0.15)

    pdur = T_SUN - T_BOOT
    pn = ts(pdur + 1.4)
    pt = tvec(pn)
    padx = ss_chord(['F2', 'C3', 'F3', 'Ab3', 'C4', 'G4'], pn, 14, 0.9, 11)
    fc = 300 * (1700 / 300) ** np.clip(pt / pdur, 0, 1) ** 1.3
    fc = np.where(pt > pdur, 1700 * (500 / 1700) ** np.clip((pt - pdur) / 1.4, 0, 1), fc)
    padx = tvf(padx, fc, 1.1, 'lp', 128) * env_asr(pn, 2.2, pdur, 1.4)
    M.add('music', fades(padx, 0.01, 0.02), T_BOOT, 0.11, sends={'hall': 0.4})

    arp = Clip(T_BOOT, T_SUN + 0.5)
    seq = ['F4', 'C5', 'Ab4', 'G5', 'F5', 'C5', 'Ab4', 'C5', 'F4', 'C5', 'Ab4', 'G5', 'Ab5', 'G5', 'F5', 'C5']
    for j, tt in enumerate(np.arange(T_BOOT, T_SUN - 1e-6, S16)):
        arp.add(soft_pluck(hz(seq[j % 16]), 0.3, seed=500 + j), tt, 1.0, p=0.3 if j % 2 else -0.3)
    at = tvec(arp.x.shape[1])
    u = np.clip((at - 0.3) / (T_SUN - T_BOOT - 0.3), 0, 1)
    arp.x = tvf(arp.x, 170 * (6500 / 170) ** (u ** 1.4), 1.8, 'lp', 48) * (u ** 1.3)
    arp_d = pingpong(arp.x, 3 * S16, 0.35, 3)
    M.add('music', arp_d, T_BOOT, 0.12, sends={'hall': 0.25})

    w = whoosh(1.5, 0.5, 260, 3000, 1.0, seed=12, p0=-0.75, p1=0.75)
    M.add('fx', w, T_WSOFT - 0.75, 0.16, sends={'hall': 0.3})

    # reverse swell into sunrise: reversed crash + reversed reverb of the chord
    rc = reverse_crash(1.18, seed=21)
    M.add('fx', rc, T_SUN - 1.2, 0.22)
    hitn = ts(0.25)
    ch = ss_chord(['F5', 'Ab5', 'C6', 'G6'], hitn, 30, 1.0, 22) * env_ahd(hitn, 0.002, 0.05, 0.06)
    wet = np.vstack([signal.fftconvolve(ch.mean(0), IR['hall'][0]), signal.fftconvolve(ch.mean(0), IR['hall'][1])])[:, ::-1]
    wet = wet[:, -ts(1.58):]
    wet = hpf(norm_peak(wet) * (tvec(wet.shape[1]) / 1.58) ** 2, 300)
    M.add('music', fades(wet, 0.02, 0.006), T_SUN - 1.6, 0.14)

    # ------------------------------------------------------------------ SUNRISE 3.75
    sn = ts(3.6)
    st = tvec(sn)
    sc = ss_chord(['F5', 'Ab5', 'C6', 'G6', 'F4', 'C5'], sn, 32, 1.0, 33)
    sc = lpf(hpf(sc, 350), 11000) * env_ahd(sn, 0.05, 0.1, 1.2)
    M.add('music', fades(sc, 0.0, 0.05), T_SUN, 0.20, sends={'hall': 0.55, 'dark': 0.1})
    M.add('fx', shimmer(3.6, seed=34), T_SUN, 0.16, sends={'hall': 0.5})
    lo, hi = impact('soft', seed=35)
    M.add('lowfx', lo, T_SUN, 0.55)
    M.add('fx', hi, T_SUN, 0.3, sends={'hall': 0.3})
    M.add('fx', crash(36, 2.6, 0.8), T_SUN, 0.14, sends={'hall': 0.2})

    # ------------------------------------------------------------------ BUILD (bars 3-5)
    log('compose: build / pre-drop')
    b3 = bar_at(T_SUN)                       # 3
    b5 = bar_at(T_RISER)                     # 5
    for bar in range(b3, b5 + 1):
        for k in range(4):
            tt = B(bar, k)
            if tt >= T_GLITCH - 1e-6:
                continue
            M.kick(tt, K['build'] if bar < b5 else K['drop'], 0.85 + 0.05 * (bar - b3))
            if tt + BEAT / 2 < T_GLITCH - 0.05:
                M.add('drums', HO[k % 3], tt + BEAT / 2, 0.13 + 0.02 * (bar - b3), p=0.05)
        if bar >= b3 + 1:
            hats16(bar, 0.55 + 0.25 * (bar - b3 - 1), open_off=False,
                   skip=tuple(range(12, 16)) if bar == b5 else ())
    for k in (1, 3):
        snare_hit(B(b3 + 1, k), 0.85, seed=k)
    build_ch = {(b3, 0): 'Fm', (b3, 2): 'Db', (b3 + 1, 0): 'Ab', (b3 + 1, 2): 'Eb', (b5, 0): 'Db', (b5, 2): 'Eb'}
    arpc = Clip(T_SUN, T_GLITCH + 0.6)
    j = 0
    for (bar, bt), chn in build_ch.items():
        for s in range(8):
            tt = B(bar, bt) + s * S16
            if tt >= T_GLITCH - 1e-6:
                break
            u = (tt - T_SUN) / (T_GLITCH - T_SUN)
            ch_hi = 2600 * (12000 / 2600) ** (u ** 2.2)
            arpc.add(ss_pluck(arp_note(chn, j), 0.26, seed=600 + j, cut_hi=ch_hi, cut_lo=400 + 1500 * u ** 2),
                     tt, 0.8 + 0.2 * u, p=0.2 if j % 2 else -0.2)
            j += 1
            if bt == 0 and bar == b5 and s >= 7:
                break
    M.add('music', pingpong(arpc.x, 3 * S16, 0.3, 3), T_SUN, 0.10, sends={'hall': 0.25})
    for (bar, bt), chn in build_ch.items():
        for s in (0.5, 1.5):
            tt = B(bar, bt + s)
            if tt >= T_RISER + BEAT * 2 - 1e-6:
                continue
            M.add('bass', pluck_bass(hz(BASS_N[chn]), 0.21, seed=700 + int(tt * 100)), tt, 0.55)

    # rise_hit 5.625 (gold text): whoosh-in + bright hit + crash + chime
    w = whoosh(0.55, 0.93, 700, 8000, 1.3, seed=51, p0=0.6, p1=-0.2)
    M.add('fx', w, T_RISEHIT - 0.55 * 0.93, 0.26, sends={'hall': 0.2})
    lo, hi = impact('small', seed=52)
    M.add('lowfx', lo, T_RISEHIT, 0.45)
    M.add('fx', hi, T_RISEHIT, 0.35, sends={'hall': 0.3})
    M.add('music', stab(['F5', 'Ab5', 'C6', 'F6'], 0.6, seed=53, cut=9000, dec=0.25), T_RISEHIT, 0.12,
          sends={'hall': 0.5})
    M.add('fx', crash(54, 2.6, 0.9), T_RISEHIT, 0.24, sends={'hall': 0.2})
    bell = fm_bell(hz('C7'), 1.6, 3.5, 3.0) + 0.5 * fm_bell(hz('F7'), 1.6, 3.5, 2.0)
    M.add('fx', bell, T_RISEHIT, 0.05, sends={'hall': 0.6})

    # pre-drop: riser + pitch-rising saw + accelerating snare roll
    rd = T_RISER_END - T_RISER
    M.add('fx', riser(rd + 0.03, seed=61, f0=350, f1=10000), T_RISER, 0.16, sends={'hall': 0.15})
    pn = ts(rd + 0.03)
    u = tvec(pn) / rd
    f = hz('F3') * 2 ** (2.0 * np.clip(u, 0, 1) ** 1.5)
    ps = supersaw(f, pn, 30, 1.0, 62)
    ps = tvf(ps, 500 * (12000 / 500) ** np.clip(u, 0, 1) ** 1.2, 1.3, 'lp', 48) * (0.2 + 0.8 * np.clip(u, 0, 1)) ** 2
    M.add('fx', fades(ps, 0.01, 0.003), T_RISER, 0.10, sends={'hall': 0.2})
    rt = [B(b5, 0), B(b5, 0.5)] + [B(b5, 1) + i * S16 for i in range(4)] + [B(b5, 2) + i * S32 for i in range(8)]
    roll([x for x in rt if x < T_GLITCH - 1e-6], 0.3, 0.8, 1.0, 1.4, seed=800, gain=0.68)

    # ------------------------------------------------------------------ SUCK into drop (seg 1)
    M.add('fx', reverse_suck(SUCK_LEN, IR['hall'], seed=90), T_SUCK, 0.42, seg=1)
    M.add('fx', reverse_crash(SUCK_LEN, seed=91, tau=0.4), T_SUCK, 0.12, seg=1)

    # ------------------------------------------------------------------ DROP (bars 6-13)
    log('compose: drop')
    b_drop, b_decay = bar_at(T_DROP), bar_at(T_DECAY)
    drop_bars = list(range(b_drop, b_decay))                         # 6..13
    chords = (['Fm', 'Db', 'Ab', 'Eb'] * 4)[:len(drop_bars)]
    fill_bars = {b_drop + 3, b_decay - 1}                             # 9, 13
    counter_bar = bar_at(T_COUNTER)                                   # 12
    stab_cache = {c: stab(STAB[c], 0.24, seed=900 + i, cut=6500) for i, c in enumerate(STAB)}
    stab_dark = {c: lpf(stab_cache[c], 1400) for c in STAB}
    for i, bar in enumerate(drop_bars):
        chn = chords[i]
        for k in range(4):
            M.kick(B(bar, k), K['drop'], 1.0)
        for k in (1, 3):
            if bar in fill_bars and k == 3:
                continue
            snare_hit(B(bar, k), 1.0, seed=bar * 4 + k)
        if bar == counter_bar:
            hats16(bar, 0.6, open_off=True, closed=False)
        else:
            hats16(bar, 1.0 if bar >= b_drop + 4 else 0.85)
        for k in range(4):
            s = stab_dark[chn] if bar == counter_bar else stab_cache[chn]
            M.add('music', s, B(bar, k + 0.5), 0.32 if bar != counter_bar else 0.22,
                  sends={'hall': 0.18, 'room': 0.05})
        # wide sustained supersaw layer (body)
        M.add('music', big_chord([x.replace('4', '3').replace('5', '4') for x in STAB[chn]], BAR - 0.05, seed=950 + i,
                                 att=0.02, rel=0.1, cut=2400, detune=22), B(bar), 0.07, sends={'hall': 0.15})
        # drop B: high rolling arp
        if bar >= b_drop + 4:
            for s in range(16):
                M.add('music', ss_pluck(arp_note(chn, s, 1), 0.2, seed=1000 + bar * 16 + s, cut_hi=7000, dec=0.07),
                      B(bar) + s * S16, 0.05, p=0.35 if s % 2 else -0.35, sends={'hall': 0.25})
    # fills
    roll([B(b_drop + 3, 3) + i * S16 for i in range(4)], 0.55, 1.0, 1.0, 1.25, seed=1100, gain=1.1)
    roll([B(b_decay - 1, 2) + i * S16 for i in range(4)] + [B(b_decay - 1, 3) + i * S32 for i in range(8)],
         0.4, 1.05, 1.0, 1.5, seed=1200, gain=1.1)

    # reese + sub
    nd = ts(T_DECAY - T_DROP) + ts(0.05)
    tr = tvec(nd)
    reese_notes = {'Fm': 'F2', 'Db': 'Db2', 'Ab': 'Ab2', 'Eb': 'Eb2'}
    ev = [(B(bar), hz(reese_notes[chords[i]])) for i, bar in enumerate(drop_bars)]
    fr = note_line(ev, T_DROP, nd, 0.02)
    lfo_plan = {0: [2, 2, 2, 4], 1: [2, 2, 4, 4], 2: [2, 2, 2, 3], 3: [2, 4, 2, 8],
                4: [2, 2, 2, 4], 5: [2, 2, 4, 4], 6: [4, 4, 4, 4], 7: [2, 2, 4, 8]}
    phi = np.zeros(nd)
    lo_c = np.full(nd, 95.0)
    hi_c = np.full(nd, 3400.0)
    for i, bar in enumerate(drop_bars):
        for k in range(4):
            a = ts(B(bar, k) - T_DROP)
            b = ts(B(bar, k + 1) - T_DROP) if (i, k) != (len(drop_bars) - 1, 3) else nd
            phi[a:b] = (tr[a:b] - (B(bar, k) - T_DROP)) / BEAT * lfo_plan[i % 8][k]
        if bar == counter_bar:
            hi_c[ts(B(bar) - T_DROP):ts(B(bar + 1) - T_DROP)] = 1700.0
    wv = 0.5 - 0.5 * np.cos(2 * np.pi * phi)
    cut = lo_c * (hi_c / lo_c) ** (wv ** 1.2)
    rs = reese(fr, cut, seed=77, q=3.0, drive=2.6, width=0.7)
    rs = fades(rs, 0.002, 0.01)
    M.add('reese', rs, T_DROP, 0.65)
    sub = fades(sub_line(fr * 0.5), 0.002, 0.01)                      # clean sine, one octave below the reese
    M.add('bass', sub, T_DROP, 0.30)

    # drop sfx
    for j, tt in enumerate([x for x in IMPACT_BIG if T_DROP - 1e-6 <= x < T_DECAY]):
        lo, hi = impact('big', seed=1300 + j)
        M.add('lowfx', lo, tt, 0.8)
        M.add('fx', hi, tt, 0.5, sends={'hall': 0.3, 'dark': 0.22})
    M.add('fx', crash(1310, 3.0, 1.0), T_DROP, 0.3, sends={'hall': 0.15})
    for j, tt in enumerate([x for x in IMPACTS if T_DROP <= x < T_DECAY]):
        lo, hi = impact('small', seed=1400 + j)
        M.add('lowfx', lo, tt, 0.75)
        M.add('fx', hi, tt, 0.6, sends={'hall': 0.25, 'room': 0.1})
    for j, tt in enumerate(cue_list('shatter')):
        M.add('fx', shatter(seed=1500 + j), tt, 0.7, sends={'hall': 0.3, 'room': 0.1})
        lo, hi = impact('small', seed=1510 + j)
        M.add('lowfx', lo, tt, 0.5)
        M.add('fx', hi, tt, 0.25)
    for j, tt in enumerate(cue_list('whoosh_down')):
        M.add('fx', whoosh_down(1.35, seed=1600 + j), tt - 0.1, 0.34, sends={'hall': 0.25})
    for j, tt in enumerate(WHOOSHES):
        pk = 0.62
        M.add('fx', whoosh(0.9, pk, 350, 6000, 1.2, seed=1700 + j, p0=-0.85 if j % 2 == 0 else 0.85,
                           p1=0.85 if j % 2 == 0 else -0.85), tt - 0.9 * pk, 0.3, sends={'hall': 0.2})
        if B(bar_at(tt)) == tt:
            M.add('fx', crash(1710 + j, 2.4, 0.8), tt, 0.18, sends={'hall': 0.1})
    cc = counter_ticks(T_COUNTER, T_COUNTER_END, seed=41)
    M.add('fx', cc.x, cc.t0, 0.55, sends={'room': 0.12})
    M.add('fx', riser(2 * BEAT + 0.01, seed=1800, f0=700, f1=9000), T_COUNTER_END - 2 * BEAT, 0.22)
    M.add('fx', clank(seed=1810, base=150.0), T_COUNTER_END, 0.42, sends={'room': 0.25, 'hall': 0.2})

    # ------------------------------------------------------------------ DECAY (bars 14-19)
    log('compose: decay')
    b_cut = bar_at(T_CUT)                                             # 20
    for bar in range(b_decay, b_cut):
        M.kick(B(bar), K['half'], 0.92)
        if B(bar, 2) < T_COUNTS[0] - 1e-6:
            snare_hit(B(bar, 2), 1.0, seed=bar, sends={'room': 0.2, 'hall': 0.25})
        if bar >= bar_at(T_REENTRY):
            for s in range(0, 16, 2 if bar < b_cut - 2 else 1):
                M.add('drums', HC[s % 6], B(bar) + s * S16, 0.08 * (1.3 if s % 4 == 2 else 1.0), p=0.25 if s % 4 else -0.2)
    M.add('fx', crash(1900, 3.2, 1.2, dark=True), T_DECAY, 0.25, sends={'hall': 0.3})
    lo, hi = impact('soft', seed=1901)
    M.add('lowfx', lo, T_DECAY, 0.6)
    M.add('fx', whoosh_down(1.6, seed=1902), T_DECAY, 0.18, sends={'hall': 0.3})
    dplan = [(B(b_decay), 'F', ['F3', 'C4', 'Ab4', 'F4']), (B(b_decay + 2), 'Eb', ['Eb3', 'Bb3', 'G4', 'Eb4']),
             (B(b_decay + 3), 'Db', ['Db3', 'Ab3', 'F4', 'Db4']), (B(b_decay + 4), 'C', ['C3', 'G3', 'E4', 'C4'])]
    for i, (tt, root, notes) in enumerate(dplan):
        t_end = dplan[i + 1][0] if i + 1 < len(dplan) else T_CUT
        M.add('music', pad(notes, t_end - tt, seed=2000 + i, att=0.25, rel=0.35, cut=850 + 250 * i, detune=16, lfo=0.13),
              tt, 0.12, sends={'hall': 0.35})
    nd = ts(T_CUT - T_DECAY) + ts(0.01)
    tr = tvec(nd)
    fr = note_line([(tt, hz(root + '2')) for tt, root, _ in dplan], T_DECAY, nd, 0.12)
    rate = np.where(tr < B(b_cut - 2) - T_DECAY, 0.5, 1.0)
    phi = np.cumsum(rate / BEAT) / SR
    cut = 110 * (np.where(tr < B(b_cut - 2) - T_DECAY, 750, 1400) / 110) ** ((0.5 - 0.5 * np.cos(2 * np.pi * phi)) ** 1.3)
    rs = reese(fr, cut, seed=78, q=2.4, drive=2.0, width=0.5, hp=60.0)
    M.add('reese', fades(rs, 0.01, 0.002), T_DECAY, 0.32)
    M.add('bass', fades(sub_line(fr), 0.01, 0.002), T_DECAY, 0.16)

    hits_decay = [x for x in IMPACTS if T_DECAY <= x < T_CUT]
    duck_t = hits_decay + T_COUNTS

    def duck(t0, n, depth_db=-9.0, att=0.004, rel=0.32):
        """Gain envelope that dips the tension bed under the slam / countdown hits."""
        g = np.zeros(n)
        tt = t0 + tvec(n)
        for th in duck_t:
            d = tt - th
            e = np.where(d < -att, 0.0, np.where(d < 0, depth_db * (d + att) / att, depth_db * (1 - smoothstep(d / rel))))
            g = np.minimum(g, e)
        return db2a(g)

    al = alarm(T_ALARM, T_ALARM_END)
    M.add('fx', al.x, al.t0, 0.26, sends={'hall': 0.22})
    ro = reentry(T_REENTRY, T_REENTRY_END, T_CUT, seed=2100)
    M.add('fx', ro * duck(T_REENTRY, ro.shape[1]), T_REENTRY, 0.15, sends={'hall': 0.1})
    for j, tt in enumerate(hits_decay):
        lo, hi = impact('big', seed=2200 + j)
        M.add('lowfx', lo, tt, 0.75)
        M.add('fx', hi, tt, 0.5, sends={'hall': 0.3, 'dark': 0.15})
    beep_f = [hz('C6'), hz('D6'), hz('E6')]
    for j, tt in enumerate(T_COUNTS):
        f = beep_f[min(j, 2)] * (1 if j < 3 else 2 ** (j / 12))
        M.add('fx', beep(f) + 0.35 * beep(2 * f), tt, 0.5, sends={'hall': 0.25})
        lo, hi = impact('small', seed=2300 + j)
        M.add('lowfx', lo, tt, 0.6 + 0.1 * j)
        M.add('fx', hi, tt, 0.5 + 0.08 * j, sends={'room': 0.15, 'hall': 0.1})
    t_tens = hits_decay[-1]
    rz = riser(T_CUT - t_tens + 0.01, seed=2400, f0=250, f1=11000, curve=1.8)
    M.add('fx', rz * duck(t_tens, rz.shape[1]), t_tens, 0.15, sends={'hall': 0.1})
    pn = ts(T_CUT - t_tens + 0.01)
    u = tvec(pn) / (T_CUT - t_tens)
    ps = supersaw(hz('C4') * 2 ** (1.5 * np.clip(u, 0, 1) ** 1.7), pn, 26, 1.0, 2401)
    ps = tvf(ps, 400 * (9000 / 400) ** np.clip(u, 0, 1) ** 1.4, 1.2, 'lp', 64) * np.clip(u, 0, 1) ** 1.5
    M.add('fx', fades(ps, 0.01, 0.002) * duck(t_tens, pn), t_tens, 0.10)
    bt = bar_at(t_tens)
    rt = ([B(bt, k * 0.5) for k in range(1, 8)] + [B(bt + 1, k * 0.25) for k in range(1, 8)]
          + [B(bt + 1, 2 + k * 0.125) for k in range(1, 16)])
    rt = [x for x in rt if x < T_CUT - 0.01 and all(abs(x - c) > 1e-6 for c in T_COUNTS)]
    for jj, x in enumerate(rt):
        uu = jj / (len(rt) - 1)
        g = (0.3 + 0.7 * uu ** 1.3) * float(duck(x, 1)[0]) ** 0.5
        snare_hit(x, 0.56 * g, 0.95 + 0.6 * uu, seed=2500 + jj, with_clap=False, sends={'room': 0.2, 'hall': 0.08})

    # ------------------------------------------------------------------ FINALE (seg 2)
    log('compose: finale / outro')
    lo, hi = impact('huge', seed=2600)
    M.add('lowfx', lo, T_HUGE, 1.0)
    M.add('fx', hi, T_HUGE, 0.5, sends={'dark': 0.5, 'hall': 0.15})
    dn = ts(T_OUTRO - T_HUGE)
    dt_ = tvec(dn)
    dr = (saw(hz('F1'), dn, 0.1) + saw(hz('F1') * 1.004, dn, 0.6) + 0.7 * saw(hz('C2'), dn, 0.3) + 0.5 * saw(hz('F2'), dn, 0.8))
    dr = tvf(dr, 150 + 90 * (0.5 - 0.5 * np.cos(2 * np.pi * dt_ / 1.4)), 1.2, 'lp', 128)
    dr *= env_asr(dn, 0.9, T_OUTRO - T_HUGE - 0.3, 0.3)
    M.add('bass', fades(dr, 0.01, 0.005), T_HUGE, 0.10)
    M.add('fx', pon(), T_PON, 0.9)
    M.add('fx', reverse_crash(BEAT, seed=2700, tau=0.6), T_OUTRO - BEAT, 0.3)
    roll([T_OUTRO - BEAT + i * S16 for i in range(4)], 0.3, 0.8, 1.1, 1.3, seed=2710, gain=0.9)

    # OUTRO (bars 22-24): Db -> Eb -> Ab major
    b_out, b_end = bar_at(T_OUTRO), bar_at(T_END)
    out_ch = {b_out: ('DbM', ['Db4', 'F4', 'Ab4', 'Db5', 'F5'], 'Db2'),
              b_out + 1: ('EbM', ['Eb4', 'G4', 'Bb4', 'Eb5', 'G5'], 'Eb2')}
    M.add('fx', crash(2800, 3.0, 1.0), T_OUTRO, 0.26, sends={'hall': 0.2})
    lo, hi = impact('soft', seed=2801)
    M.add('lowfx', lo, T_OUTRO, 0.5)
    for bar in range(b_out, b_end):
        chn, notes, bn = out_ch[bar]
        for k in range(4):
            M.kick(B(bar, k), K['outro'], 0.95)
            M.add('drums', HO[k % 3], B(bar, k + 0.5), 0.13, p=0.05)
            M.add('bass', pluck_bass(hz(bn), 0.21, seed=2900 + bar * 4 + k), B(bar, k + 0.5), 0.55)
        for k in (1, 3):
            if bar == b_out and k == 3:
                continue
            snare_hit(B(bar, k), 1.0, seed=3000 + bar * 4 + k)
        hats16(bar, 0.8, open_off=False)
        M.add('music', big_chord(notes, BAR - 0.03, seed=3100 + bar, att=0.01, rel=0.15, cut=8000, detune=32), B(bar),
              0.20, sends={'hall': 0.3})
        for s in range(16):
            M.add('music', ss_pluck(arp_note(chn, s, 0), 0.22, seed=3200 + bar * 16 + s, cut_hi=8500, dec=0.08),
                  B(bar) + s * S16, 0.07, p=0.35 if s % 2 else -0.35, sends={'hall': 0.3})
    roll([B(b_out, 3) + i * S32 for i in range(8)], 0.35, 0.85, 1.05, 1.45, seed=3300, gain=0.95)
    for j, tt in enumerate([x for x in IMPACTS if x >= T_OUTRO]):
        lo, hi = impact('big', seed=3400 + j)
        M.add('lowfx', lo, tt, 0.7)
        M.add('fx', hi, tt, 0.5, sends={'hall': 0.3, 'dark': 0.1})
    lo, hi = capture_sfx(seed=3500)
    M.add('lowfx', lo, T_CAPTURE, 0.5)
    M.add('fx', hi, T_CAPTURE, 0.8, sends={'hall': 0.35, 'room': 0.1})

    # END CARD: final Ab-major hit ringing out
    fin_d = DUR - T_END
    M.kick(T_END, K['outro'], 1.0, sidechain=False)
    fc_notes = ['Ab2', 'Eb3', 'Ab3', 'C4', 'Eb4', 'Ab4', 'C5', 'Eb5', 'Ab5']
    fch = big_chord(fc_notes, fin_d - 0.2, seed=3600, att=0.004, rel=0.2, cut=9000, detune=30, dec=1.6)
    M.add('fx', fch, T_END, 0.30, sends={'hall': 0.45, 'dark': 0.12})
    fn = ts(fin_d)
    ft = tvec(fn)
    M.add('lowfx', fades(sub_line(np.full(fn, hz('Ab1'))) * env_ahd(fn, 0.003, 0.1, 1.1), 0.0, 0.05), T_END, 0.5)
    lo, hi = impact('small', seed=3601)
    M.add('lowfx', lo, T_END, 0.45)
    M.add('fx', hi, T_END, 0.3, sends={'hall': 0.3})
    M.add('fx', crash(3602, fin_d, 1.4), T_END, 0.3, sends={'hall': 0.2})
    M.add('fx', shimmer(fin_d, seed=3603, grains=300, tau=1.4), T_END, 0.12, sends={'hall': 0.4})
    M.add('fx', fm_bell(hz('Ab6'), 1.8, 3.5, 2.5) + 0.5 * fm_bell(hz('Eb7'), 1.8, 3.5, 2.0), T_END, 0.05,
          sends={'hall': 0.6})


# ============================================================================================
# Bus processing, reverbs, segments
# ============================================================================================
def make_ir(rt60, length, predelay, seed, lp_hi=9000.0, hp=150.0, damp=0.5, er=0.25):
    r = rng(seed)
    n = ts(length)
    t = tvec(n)
    pd = ts(predelay)
    ir = np.zeros((2, n + pd))
    for ch in range(2):
        w = r.standard_normal(n)
        lo = lpf(w, 500)
        hi = hpf(w, 4000)
        mi = w - lo - hi
        dec = lambda rt: 10 ** (-3 * t / rt)
        x = lo * dec(rt60 * 1.15) + mi * dec(rt60) + hi * dec(rt60 * damp)
        x *= np.minimum(1.0, t / 0.015)
        ref = np.sqrt(np.mean(x[:ts(0.1)] ** 2))
        for _ in range(10):                      # sparse early reflections
            d = r.uniform(0.003, 0.07)
            x[ts(d)] += er * 30.0 * ref * r.uniform(0.3, 1.0) * r.choice([-1, 1])
        x = hpf(lpf(x, lp_hi), hp)
        x = fades(x, 0.0, min(0.3, length * 0.2))
        ir[ch, pd:] = x / np.sqrt(np.sum(x ** 2))
    return ir


def pump_env(kick_times, depth, rel, att=0.004):
    g = np.ones(N)
    for tk in kick_times:
        i0 = max(0, ts(tk - att))
        i1 = min(N, ts(tk + rel))
        tt = np.arange(i0, i1) / SR - tk
        e = np.where(tt < 0, 1 - depth * smoothstep((tt + att) / att), 1 - depth * (1 - smoothstep(tt / rel)))
        g[i0:i1] = np.minimum(g[i0:i1], e)
    return g


def compress(x, thr_db, ratio, att, rel, knee=6.0, makeup=0.0, rate=16):
    det = np.max(np.abs(x), axis=0) if x.ndim == 2 else np.abs(x)
    n = det.shape[0]
    nb = (n + rate - 1) // rate
    pad_ = np.zeros(nb * rate)
    pad_[:n] = det
    lev = np.sqrt(np.mean(pad_.reshape(nb, rate) ** 2, axis=1))
    over = a2db(lev) - thr_db
    slope = 1.0 / ratio - 1.0
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, slope * over, slope * (over + knee / 2) ** 2 / (2 * knee)))
    aa = np.exp(-1.0 / (att * SR / rate))
    ar = np.exp(-1.0 / (rel * SR / rate))
    out = np.empty(nb)
    s = 0.0
    for i, v in enumerate(gr.tolist()):
        s = aa * s + (1 - aa) * v if v < s else ar * s + (1 - ar) * v
        out[i] = s
    g = np.interp(np.arange(n), (np.arange(nb) + 0.5) * rate, out)
    return x * db2a(g + makeup), g


def seg_range(seg):
    a = ts(SEG_T[seg])
    b = ts(SEG_T[seg + 1]) if seg < 2 else N
    return a, b


def reverb_seg(send, ir, seg):
    a, b = seg_range(seg)
    lo = 0
    x = send[:, lo:b].mean(axis=0)
    nz = np.flatnonzero(x)
    if nz.size == 0:
        return None
    s0, s1 = nz[0], nz[-1] + 1
    xx = x[s0:s1]
    wet = np.vstack([signal.fftconvolve(xx, ir[0]), signal.fftconvolve(xx, ir[1])])
    out = np.zeros((2, N))
    place(out, wet, s0)
    return out


STEM_REPORT = {}
# Bus balance (linear) -- tuned against octave-band analysis of the drop (scratch/bgm/analyze.py).
BUS_GAIN = dict(kick=0.36, drums=2.5, bass=1.0, music=3.8, fx=1.4, lowfx=0.5, reverb=1.6)


# Slams that get a short pre-impact gap in the bed (music/bass/drums/fx dip ~40 ms before the hit).
SLAMS = sorted(set(IMPACTS + IMPACT_BIG[1:] + cue_list('shatter') + T_COUNTS + cue_list('end_card')
                   + cue_list('rise_hit') + cue_list('capture')))


def gap_env(times, depth_db=-12.0, pre=0.042, ramp=0.006, back=0.002):
    g = np.ones(N)
    for th in times:
        a, b = ts(th - pre), ts(th)
        tt = np.arange(a, b) / SR - th
        e = np.ones(b - a)
        e = np.where(tt < -pre + ramp, 1 + (db2a(depth_db) - 1) * smoothstep((tt + pre) / ramp), e)
        e = np.where((tt >= -pre + ramp) & (tt < -back), db2a(depth_db), e)
        e = np.where(tt >= -back, db2a(depth_db) + (1 - db2a(depth_db)) * smoothstep((tt + back) / back), e)
        g[a:b] = np.minimum(g[a:b], e)
    return g


def process_segment(M, seg, IR):
    kt = M.kicks[seg]
    gp = gap_env([x for x in SLAMS if M.seg_of(x) == seg])
    pb = pump_env(kt, 0.88, 0.36)
    pm = pump_env(kt, 0.55, 0.40)
    pr = pump_env(kt, 0.35, 0.42)
    out = np.zeros((2, N))
    stems = {}
    if (seg, 'kick') in M.buf:
        stems['kick'] = hpf(M.buf[(seg, 'kick')], 28) * BUS_GAIN['kick']
    if (seg, 'drums') in M.buf:
        d = hpf(M.buf[(seg, 'drums')], 150) * BUS_GAIN['drums'] * gp
        d = shelf(d, 6000, -2.5, 'high')
        stems['drums'], _ = compress(d, -16, 3.0, 0.004, 0.09, makeup=1.5)
    if (seg, 'bass') in M.buf or (seg, 'reese') in M.buf:
        b = np.zeros((2, N))
        if (seg, 'bass') in M.buf:          # sub + pluck bass: deep pump so the kick owns the low end
            b += M.buf[(seg, 'bass')] * pb
        if (seg, 'reese') in M.buf:         # growl: lighter pump so the wobbles stay audible
            b += M.buf[(seg, 'reese')] * pump_env(kt, 0.6, 0.26)
        b *= BUS_GAIN['bass'] * gp
        m = 0.5 * (b[0] + b[1])
        s = hpf(0.5 * (b[0] - b[1]), 150)
        b = np.vstack([m + s, m - s])
        stems['bass'] = lpf(hpf(b, 25), 12000)
    if (seg, 'music') in M.buf:
        mu = hpf(M.buf[(seg, 'music')], 150) * pm * BUS_GAIN['music'] * gp
        stems['music'], _ = compress(mu, -14, 2.0, 0.015, 0.15, makeup=0.0)
    if (seg, 'fx') in M.buf:
        stems['fx'] = hpf(M.buf[(seg, 'fx')], 150) * BUS_GAIN['fx'] * gp
    if (seg, 'lowfx') in M.buf:
        stems['lowfx'] = hpf(M.buf[(seg, 'lowfx')], 22) * BUS_GAIN['lowfx']
    wet = np.zeros((2, N))
    for name, gain, lp_, pump in (('room', 0.7, 9000, False), ('hall', 0.8, 8000, True), ('dark', 0.9, 3500, False)):
        if (seg, name) in M.buf:
            w = reverb_seg(M.buf[(seg, name)], IR[name], seg)
            if w is not None:
                w = lpf(hpf(w, 200), lp_) * gain
                wet += w * (pr if pump else 1.0) * gp
    stems['reverb'] = wet * BUS_GAIN['reverb']
    for k, v in stems.items():
        out += v
        STEM_REPORT.setdefault(k, np.zeros((2, N)))
        STEM_REPORT[k] += v
    return out


def apply_glitch(x, t_cut, seed=99):
    """Stutter the last 16th before the cut (1/64-note slice, pitched down, bit-reduced),
    then a ~39 ms tape-stop tail and a digital zap; true silence afterwards."""
    r = rng(seed)
    L = ts(S16 / 4)                                   # 1/64 note ~ 29.3 ms
    a = ts(t_cut - S16)
    c = ts(t_cut)
    s0 = ts(t_cut - S16 - S32)                        # slice starts on a 32nd snare hit
    src = x[:, s0:s0 + L].copy()
    xs = np.arange(L)
    out = x.copy()
    pitches = [1.0, 0.97, 0.9, 0.82, 0.74]
    k, pos = 0, a
    while pos < c:
        p = pitches[min(k, len(pitches) - 1)]
        m = min(L, c - pos)
        idx = np.arange(m) * p
        rep = np.vstack([np.interp(idx, xs, src[ch]) for ch in range(2)])
        if k >= 2:
            hold = 1 + k
            rep = np.repeat(rep[:, ::hold], hold, axis=1)[:, :m]
            qz = 2.0 ** (9 - k)
            rep = np.round(rep * qz) / qz
        out[:, pos:pos + m] = fades(rep, 0.0006, 0.0012) * (0.96 ** k)
        pos += m
        k += 1
    T = ts(GLITCH_TAIL)
    u = np.arange(T) / T
    rate = 0.72 * (1 - u) ** 1.5 + 0.05
    ph = np.cumsum(rate) % (L - 1)
    tape = np.vstack([np.interp(ph, xs, src[ch]) for ch in range(2)])
    tape = lpf(tape, 3500) * (1 - u) ** 1.3
    out[:, c:c + T] = fades(tape, 0.0006, 0.003) * 0.85
    zn = ts(0.014)
    z = r.standard_normal((2, zn))
    z = np.repeat(z[:, ::6], 6, axis=1)[:, :zn]
    z = fades(hpf(z, 1500) * np.exp(-tvec(zn) / 0.004), 0.0003, 0.002) * 0.3 * np.max(np.abs(src))
    out[:, c:c + zn] += z
    out[:, c + T:] = 0.0
    return out


# ============================================================================================
# Master
# ============================================================================================
def softclip(x, thr=0.6, ceil=1.0):
    up = signal.resample_poly(x, 2, 1, axis=-1)
    a = np.abs(up)
    k = ceil - thr
    m = a > thr
    up[m] = np.sign(up[m]) * (thr + k * np.tanh((a[m] - thr) / k))
    return signal.resample_poly(up, 1, 2, axis=-1)


def true_peak(x):
    up = signal.resample_poly(x, 4, 1, axis=-1)
    return float(np.max(np.abs(up)))


def limiter(x, ceil_db=-1.3, look=0.003, rel=0.08, rate=8):
    c = db2a(ceil_db)
    n = x.shape[-1]
    up = np.abs(signal.resample_poly(x, 4, 1, axis=-1)).max(axis=0)[:4 * n].reshape(n, 4).max(axis=1)
    pk = np.maximum(up, np.abs(x).max(axis=0))
    greq = np.minimum(1.0, c / np.maximum(pk, 1e-12))
    L = ts(look)
    h = minimum_filter1d(greq, size=2 * L + 1, mode='nearest')
    gatt = uniform_filter1d(h, size=2 * L + 1, mode='nearest')
    gatt = np.minimum(gatt, greq)
    d = 1.0 - gatt
    nb = (n + rate - 1) // rate
    dp = np.zeros(nb * rate)
    dp[:n] = d
    db_ = dp.reshape(nb, rate).max(axis=1)
    a = np.exp(-1.0 / (rel * SR / rate))
    o = np.empty(nb)
    s = 0.0
    for i, v in enumerate(db_.tolist()):
        s = v if v > s else a * s + (1 - a) * v
        o[i] = s
    dr = np.interp(np.arange(n), (np.arange(nb) + 0.5) * rate, o)
    g = 1.0 - np.maximum(d, dr)
    return x * g, g


def master(mix, target_lufs=-10.0):
    meter = pyln.Meter(SR)
    x = hpf(mix, 24)
    L0 = meter.integrated_loudness(x.T)
    x *= db2a(-18.0 - L0)
    x, _ = compress(x, -21.0, 1.8, 0.025, 0.2, knee=8.0)
    gain = 7.0
    y = None
    for it in range(6):
        y, g = limiter(softclip(x * db2a(gain)), -1.25)
        L = meter.integrated_loudness(y.T)
        log(f'master iter {it}: pre-gain {gain:+.2f} dB -> {L:.2f} LUFS, min limiter gain {a2db(g.min()):.1f} dB')
        if abs(L - target_lufs) < 0.08:
            break
        gain += (target_lufs - L) * 1.05
    return y


# ============================================================================================
# Verification
# ============================================================================================
def onset(y, t, pre=0.05, post=0.08, frac=0.5):
    """Sample-accurate: first sample whose |x| reaches `frac` of the local peak."""
    m = np.max(np.abs(y), axis=0)
    i0, i1 = ts(t - pre), ts(t + post)
    seg = m[i0:i1]
    j = int(np.argmax(seg >= frac * seg.max()))
    return (i0 + j) / SR


def onset_rise(y, t, win=0.025, hp=None):
    """Steepest energy rise (dB over the preceding 1-12 ms) within +/- win of t. Returns (time, rise dB)."""
    x = np.max(np.abs(y if hp is None else hpf(y[:, ts(t - 0.2):ts(t + 0.2)], hp, 4)), axis=0)
    if hp is not None:
        x = np.concatenate([np.zeros(ts(t - 0.2)), x])
    lead, gap = ts(0.012), ts(0.001)
    a, b = ts(t - win) - lead, ts(t + win)
    e = uniform_filter1d(x[a:b] ** 2, ts(0.0005))
    edb = 10 * np.log10(e + 1e-12)
    pre = np.lib.stride_tricks.sliding_window_view(edb, lead - gap).max(axis=1)
    rise = edb[lead:] - pre[:len(edb) - lead]
    k = int(np.argmax(rise))
    return (a + lead + k) / SR, float(rise[k])


def verify(y, music, post):
    meter = pyln.Meter(SR)
    rep = {}
    rep['samples'] = int(y.shape[1])
    rep['duration_s'] = y.shape[1] / SR
    rep['integrated_lufs'] = round(meter.integrated_loudness(y.T), 2)
    rep['sample_peak_dbfs'] = round(float(a2db(np.max(np.abs(y)))), 2)
    rep['true_peak_dbtp'] = round(float(a2db(true_peak(y))), 2)
    secs = [(k, a, b) for k, a, b in SECTIONS]
    fine = [('intro_bars1-2', 0.0, T_SUN), ('build_bars3-4', T_SUN, T_RISER), ('predrop', T_RISER, T_GLITCH),
            ('drop_A_bars6-9', T_DROP, B(bar_at(T_DROP) + 4)), ('drop_B_bars10-13', B(bar_at(T_DROP) + 4), T_DECAY),
            ('decay_bars14-17', T_DECAY, B(bar_at(T_DECAY) + 4)), ('countdown_bars18-19', B(bar_at(T_DECAY) + 4), T_CUT),
            ('huge+pon', T_HUGE, T_OUTRO), ('outro_bars22-24', T_OUTRO, DUR)]
    rows = []
    for name, a, b in secs + fine:
        seg = y[:, ts(a):ts(b)]
        rms = float(a2db(np.sqrt(np.mean(seg ** 2))))
        try:
            lu = meter.integrated_loudness(seg.T) if seg.shape[1] >= ts(0.4) else float('nan')
        except Exception:
            lu = float('nan')
        rows.append((name, a, b, rms, lu))
    rep['sections'] = rows
    t_on = onset(y, T_DROP)
    rep['drop_onset_s'] = t_on
    rep['drop_onset_err_ms'] = (t_on - T_DROP) * 1000
    ons = []
    for c in CUES['sfx']:
        if c['type'] in ('impact', 'impact_big', 'impact_huge', 'shatter', 'count', 'pon', 'capture', 'end_card',
                         'rise_hit', 'sunrise'):
            to, rise = onset_rise(y, c['t'])
            _, rise_hf = onset_rise(y, c['t'], hp=2000.0)
            ons.append((c['type'], c['t'], (to - c['t']) * 1000, rise, rise_hf))
    rep['cue_onsets'] = ons
    sil = []
    for a, b in ((8.95, 9.15), (T_GLITCH_END, T_SUCK), (35.65, 36.5), (T_CUT, T_HUGE)):
        w = y[:, ts(a):ts(b)]
        wm = music[:, ts(a):ts(b)]
        sil.append((a, b, float(a2db(np.max(np.abs(w))) if w.size else -999),
                    float(a2db(np.sqrt(np.mean(w ** 2)))), float(a2db(np.max(np.abs(wm))))))
    rep['silence'] = sil
    rep['tail_last_20ms_peak'] = float(np.max(np.abs(y[:, -ts(0.02):])))
    w = y[:, ts(T_CUT + 0.05):ts(T_CUT + 0.29)]
    rep['tinnitus_peak_dbfs'] = float(a2db(np.max(np.abs(hpf(w, 3000, 4)))))
    rep['dc'] = [float(np.mean(y[0])), float(np.mean(y[1]))]
    corr = []
    for name, a, b in SECTIONS:
        L_, R_ = y[0, ts(a):ts(b)], y[1, ts(a):ts(b)]
        corr.append((name, float(np.corrcoef(L_, R_)[0, 1]),
                     float(a2db(np.sqrt(np.mean((0.5 * (L_ + R_)) ** 2)) / np.sqrt(0.5 * np.mean(L_ ** 2 + R_ ** 2))))))
    rep['stereo'] = corr
    return rep


def plots(y, rep):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    os.makedirs(SCRATCH, exist_ok=True)
    mono = y.mean(axis=0)
    t = np.arange(len(mono)) / SR
    cue_ts = sorted(set(float(c['t']) for c in CUES['sfx']))

    fig, axes = plt.subplots(4, 1, figsize=(20, 14))
    blk = ts(0.01)
    nb = len(mono) // blk
    mx = np.abs(y[:, :nb * blk]).max(axis=0).reshape(nb, blk).max(axis=1)
    rms = np.sqrt((y[:, :nb * blk] ** 2).mean(axis=0).reshape(nb, blk).mean(axis=1))
    tb = (np.arange(nb) + 0.5) * blk / SR
    ax = axes[0]
    ax.fill_between(tb, -mx, mx, color='#3a7bd5', lw=0)
    ax.fill_between(tb, -rms, rms, color='#0b2e59', lw=0)
    for c in cue_ts:
        ax.axvline(c, color='r', lw=0.6, alpha=0.6)
    for k, a, b in SECTIONS:
        ax.text(a + 0.1, 1.02, k, fontsize=9)
    ax.set_xlim(0, DUR)
    ax.set_ylim(-1.1, 1.1)
    ax.set_title(f"bgm.wav  {rep['integrated_lufs']} LUFS  TP {rep['true_peak_dbtp']} dBTP  (red = cues)")
    ax = axes[1]
    ax.plot(tb, a2db(rms), lw=0.7, color='k')
    for c in cue_ts:
        ax.axvline(c, color='r', lw=0.5, alpha=0.5)
    ax.set_xlim(0, DUR)
    ax.set_ylim(-80, 0)
    ax.set_ylabel('RMS dBFS (10 ms)')
    for ax, (a, b) in zip(axes[2:], ((8.6, 9.8), (35.3, 37.2))):
        i0, i1 = ts(a), ts(b)
        ax.plot(t[i0:i1], y[0, i0:i1], lw=0.4, color='#3a7bd5')
        ax.plot(t[i0:i1], y[1, i0:i1], lw=0.4, color='#e0662b', alpha=0.6)
        for c in cue_ts:
            if a <= c <= b:
                ax.axvline(c, color='r', lw=0.8)
        ax.set_xlim(a, b)
        ax.set_ylim(-1.05, 1.05)
    axes[2].axvspan(8.95, 9.15, color='g', alpha=0.15)
    axes[3].axvspan(35.65, 36.5, color='g', alpha=0.15)
    axes[2].set_title('zoom: glitch cut -> silence -> suck -> DROP')
    axes[3].set_title('zoom: hard cut -> tinnitus + heartbeat -> impact_huge')
    fig.tight_layout()
    fig.savefig(os.path.join(SCRATCH, 'waveform.png'), dpi=80)
    plt.close(fig)

    f, tt, S = signal.spectrogram(mono, SR, window='hann', nperseg=4096, noverlap=3072)
    Sd = 10 * np.log10(S + 1e-14)
    fig, ax = plt.subplots(1, 1, figsize=(20, 8))
    ax.pcolormesh(tt, f, Sd, shading='auto', vmin=Sd.max() - 100, vmax=Sd.max(), cmap='magma')
    ax.set_yscale('log')
    ax.set_ylim(20, 22000)
    for c in cue_ts:
        ax.axvline(c, color='c', lw=0.5, alpha=0.6)
    ax.set_xlabel('s')
    ax.set_ylabel('Hz')
    ax.set_title('bgm.wav spectrogram (cyan = cues)')
    fig.tight_layout()
    fig.savefig(os.path.join(SCRATCH, 'spectrogram.png'), dpi=80)
    plt.close(fig)


# ============================================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-plots', action='store_true')
    ap.add_argument('--debug', action='store_true', help='print per-stem octave-band levels')
    args = ap.parse_args()
    assert N == int(round(DUR * SR))
    log(f'{DUR:.3f} s @ {SR} Hz = {N} samples; {BPM:g} BPM; drop {T_DROP}, cut {T_CUT}')

    IR = {'room': make_ir(0.55, 0.9, 0.006, 1, lp_hi=10000, damp=0.6),
          'hall': make_ir(2.6, 3.2, 0.02, 2, lp_hi=8500, damp=0.45),
          'dark': make_ir(5.5, 6.5, 0.03, 3, lp_hi=3500, hp=60, damp=0.3)}
    M = Mix()
    compose(M, IR)
    log('processing segments')
    mixes = []
    for seg in range(3):
        mx = process_segment(M, seg, IR)
        if seg == 0:
            mx = apply_glitch(mx, T_GLITCH)
            mx[:, ts(T_GLITCH_END):] = 0.0
        elif seg == 1:
            mx[:, :ts(T_SUCK)] = 0.0
            c = ts(T_CUT)
            f = ts(0.0015)
            mx[:, c - f:c] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(1, f + 1) / f)
            mx[:, c:] = 0.0
        else:
            mx[:, :ts(T_CUT)] = 0.0
        mixes.append(mx)
    mix = mixes[0] + mixes[1] + mixes[2]
    del M
    log('mastering')
    y = master(mix)
    # hard mute windows (music): after glitch until suck, after cut until impact_huge
    y[:, ts(T_GLITCH_END):ts(T_SUCK)] = 0.0
    y[:, ts(T_CUT):ts(T_HUGE)] = 0.0
    music = y.copy()
    # post: tinnitus (-40 dBFS peak, fading) + one heartbeat, placed after the limiter
    post = np.zeros((2, N))
    tn = ts(T_HUGE - T_CUT)
    tt = tvec(tn)
    tin = sine(6000.0, tn) * np.minimum(1, tt / 0.03) * np.exp(-tt / 0.42)
    place(post, pan(fades(tin, 0.02, 0.05) * db2a(-40.0)), ts(T_CUT))
    hb = heartbeat(5)
    place(post, pan(hb * db2a(-9.0)), ts(T_CUT + 0.30))
    place(post, pan(heartbeat(6) * db2a(-13.0)), ts(T_CUT + 0.50))
    y = y + post
    # fade 44.4 -> 45.0 to digital silence
    fa, fb = ts(T_FADE), ts(DUR - 0.02)
    fenv = np.ones(N)
    fenv[fa:fb] = 0.5 + 0.5 * np.cos(np.pi * np.arange(fb - fa) / (fb - fa))
    fenv[fb:] = 0.0
    y *= fenv
    music *= fenv
    tp = true_peak(y)
    if a2db(tp) > -1.05:
        y *= db2a(-1.05) / tp
        music *= db2a(-1.05) / tp
    assert y.shape == (2, N)
    os.makedirs(HERE, exist_ok=True)
    sf.write(OUT_WAV, y.T, SR, subtype='PCM_24')
    log(f'wrote {OUT_WAV}')

    info = sf.info(OUT_WAV)
    yr, sr_ = sf.read(OUT_WAV, always_2d=True)
    yr = yr.T
    rep = verify(yr, music, post)
    print('\n================= VERIFICATION =================')
    print(f'file: {OUT_WAV}\n  {info.samplerate} Hz, {info.channels} ch, {info.subtype}, frames={info.frames} '
          f'({info.frames / info.samplerate:.6f} s)  expected {N}')
    print(f"integrated loudness: {rep['integrated_lufs']} LUFS   sample peak: {rep['sample_peak_dbfs']} dBFS   "
          f"true peak (4x): {rep['true_peak_dbtp']} dBTP")
    print('\nsection                    start    end     RMS dBFS   LUFS')
    for name, a, b, rms, lu in rep['sections']:
        print(f'  {name:24s} {a:7.3f} {b:7.3f}   {rms:7.2f}   {lu:7.2f}')
    print(f"\ndrop transient: {rep['drop_onset_s']:.5f} s  (target {T_DROP:.5f}, error {rep['drop_onset_err_ms']:+.2f} ms)")
    t_r, r_r = onset_rise(y, T_DROP)
    print(f'drop transient (steepest rise detector): {t_r:.5f} s ({(t_r - T_DROP) * 1000:+.2f} ms, +{r_r:.0f} dB)')
    print('cue onsets (steepest-rise detector: ms error / broadband rise dB / >2 kHz rise dB):')
    for i in range(0, len(rep['cue_onsets']), 6):
        print('  ' + '  '.join(f'{k}@{t:g}:{e:+.1f}ms/{r:.0f}/{rh:.0f}dB' for k, t, e, r, rh in rep['cue_onsets'][i:i + 6]))
    print('\nsilence windows          full-mix peak dBFS   full-mix RMS dBFS   music-only peak dBFS')
    for a, b, pk, rm, mp in rep['silence']:
        print(f'  {a:7.3f}-{b:7.3f}          {pk:8.1f}             {rm:8.1f}            {mp:8.1f}')
    print(f"last 20 ms peak (digital silence): {rep['tail_last_20ms_peak']:.2e}")
    print(f"tinnitus (35.675-35.915, >3 kHz) peak: {rep['tinnitus_peak_dbfs']:.1f} dBFS   DC offset L/R: "
          f"{rep['dc'][0]:+.1e} / {rep['dc'][1]:+.1e}")
    print('stereo L/R correlation, mono-sum level change: ' + ', '.join(
        f'{k} {c:.2f} ({m:+.1f} dB)' for k, c, m in rep['stereo']))
    stem_rows = []
    for k, v in STEM_REPORT.items():
        row = []
        for name, a, b in [(s[0], s[1], s[2]) for s in SECTIONS]:
            seg = v[:, ts(a):ts(b)]
            row.append(float(a2db(np.sqrt(np.mean(seg ** 2)))))
        stem_rows.append((k, row))
    print('\npre-master stem RMS dBFS per section: ' + ', '.join(s[0] for s in SECTIONS))
    for k, row in stem_rows:
        print(f'  {k:8s} ' + ' '.join(f'{v:7.1f}' for v in row))
    if args.debug:
        bands = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
        for nm, a, b in (('drop', T_DROP, T_DECAY), ('countdown', B(bar_at(T_DECAY) + 4), T_CUT),
                         ('outro', T_OUTRO, T_END)):
            print(f'\nstem octave bands (dBFS) in {nm}: ' + ' '.join(f'{x:>6g}' for x in bands))
            for k, v in STEM_REPORT.items():
                f, P = signal.welch(v[:, ts(a):ts(b)].mean(axis=0), SR, nperseg=8192)
                row = [10 * np.log10(np.sum(P[(f >= fc / SQ2) & (f < fc * SQ2)]) * (f[1] - f[0]) + 1e-20) for fc in bands]
                print(f'  {k:8s} ' + ' '.join(f'{x:6.1f}' for x in row))
    if not args.no_plots:
        plots(yr, rep)
        log(f'plots -> {SCRATCH}/waveform.png, spectrogram.png')
    log('done')


if __name__ == '__main__':
    main()
