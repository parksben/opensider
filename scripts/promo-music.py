#!/usr/bin/env python3
"""Background track for the promo video, synthesized from scratch (no samples).

    python3 scripts/promo-music.py out.wav [seconds]

Needs numpy + scipy. 120 BPM in A minor (Am - F - C - G), arranged around the scene
cuts in scripts/promo.mjs: intro pad, drums from 0:18, a lighter break for the selection
scene, then a pad-only outro that rings out.
"""
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
rng = np.random.default_rng(7)

out_path = sys.argv[1] if len(sys.argv) > 1 else "promo-music.wav"
LENGTH = float(sys.argv[2]) if len(sys.argv) > 2 else 116.0
N = int(SR * (LENGTH + 2.5))
L = np.zeros(N)
R = np.zeros(N)

# Section map (seconds): which layers play when.
DRUMS = [(18, 64), (78, 106)]
BREAK = (64, 78)
OUTRO = 106


def within(t, spans):
    return any(a <= t < b for a, b in spans)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def lowpass(x, hz, order=2):
    b, a = butter(order, min(hz / (SR / 2), 0.99))
    return lfilter(b, a, x)


def highpass(x, hz, order=2):
    b, a = butter(order, hz / (SR / 2), btype="high")
    return lfilter(b, a, x)


def bandpass(x, lo, hi):
    b, a = butter(2, [lo / (SR / 2), hi / (SR / 2)], btype="band")
    return lfilter(b, a, x)


def saw(freq, n, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((t * freq + phase) % 1.0) - 1


def adsr(n, a, d, s, r):
    env = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = min(na, n)
    env[:na] = np.linspace(0, 1, na, endpoint=False)
    nd = min(nd, n - na)
    env[na : na + nd] = np.linspace(1, s, nd, endpoint=False)
    if nr and n > nr:
        env[-nr:] *= np.linspace(1, 0, nr)
    return env


def add(buf_l, buf_r, start, sig_l, sig_r=None):
    i = int(start * SR)
    if i >= N:
        return
    sig_r = sig_l if sig_r is None else sig_r
    m = min(len(sig_l), N - i)
    buf_l[i : i + m] += sig_l[:m]
    buf_r[i : i + m] += sig_r[:m]


# Am, F, C, G — one chord per bar.
CHORDS = [
    [57, 60, 64, 69],  # Am
    [53, 57, 60, 65],  # F
    [55, 60, 64, 67],  # C
    [55, 59, 62, 67],  # G
]
ROOTS = [45, 41, 48, 43]

bars = int(np.ceil(LENGTH / BAR))

# --- pad ---------------------------------------------------------------------------
pad_l = np.zeros(N)
pad_r = np.zeros(N)
for bar in range(bars):
    t0 = bar * BAR
    chord = CHORDS[bar % 4]
    n = int((BAR + 0.6) * SR)
    sl = np.zeros(n)
    sr = np.zeros(n)
    for note in chord:
        f = midi(note)
        sl += saw(f * 0.997, n, rng.random()) + saw(f * 1.004, n, rng.random())
        sr += saw(f * 1.002, n, rng.random()) + saw(f * 0.995, n, rng.random())
    cutoff = 900 if t0 < 8 else 1500
    if t0 >= OUTRO:
        cutoff = 1100
    env = adsr(n, 0.35, 0.4, 0.85, 0.6)
    gain = 0.035
    if t0 < 8:
        gain *= 0.5 + 0.5 * (t0 / 8)
    add(pad_l, pad_r, t0, lowpass(sl, cutoff) * env * gain, lowpass(sr, cutoff) * env * gain)

# --- arpeggio (16ths, two octaves of chord tones) -----------------------------------
arp_l = np.zeros(N)
arp_r = np.zeros(N)
pattern = [0, 1, 2, 3, 2, 1, 3, 2]
step = BEAT / 4
for i in range(int(LENGTH / step)):
    t0 = i * step
    if t0 < 4 or t0 >= LENGTH - 1.5:
        continue
    bar = int(t0 // BAR)
    chord = CHORDS[bar % 4]
    idx = pattern[i % len(pattern)]
    octave = 12 if (i // 8) % 2 else 0
    note = chord[idx] + octave
    n = int(0.28 * SR)
    sig = saw(midi(note), n) * np.exp(-np.arange(n) / SR * 16)
    cutoff = 2600 if not within(t0, [BREAK]) else 1800
    sig = lowpass(sig, cutoff)
    gain = 0.05 if t0 >= 8 else 0.05 * (t0 - 4) / 4
    if t0 >= OUTRO:
        gain *= max(0.0, 1 - (t0 - OUTRO) / 9)
    pan = 0.5 + 0.35 * np.sin(i * 0.7)
    add(arp_l, arp_r, t0, sig * gain * (1 - pan) * 1.4, sig * gain * pan * 1.4)

# ping-pong delay on the arp (dotted eighth)
d = int(BEAT * 0.75 * SR)
for k, g in enumerate([0.45, 0.3, 0.18]):
    off = d * (k + 1)
    src_l, src_r = (arp_r, arp_l) if k % 2 == 0 else (arp_l, arp_r)
    arp_l[off:] += src_l[:-off] * g * 0.6
    arp_r[off:] += src_r[:-off] * g * 0.6

# --- drums --------------------------------------------------------------------------
kick_times = []
drum_l = np.zeros(N)
drum_r = np.zeros(N)
for b in range(int(LENGTH / BEAT)):
    t0 = b * BEAT
    if not within(t0, DRUMS):
        continue
    kick_times.append(t0)
    n = int(0.45 * SR)
    tt = np.arange(n) / SR
    freq = 45 + 85 * np.exp(-tt * 30)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    kick = np.sin(phase) * np.exp(-tt * 7.5) * 0.55
    kick[: int(0.004 * SR)] += rng.standard_normal(int(0.004 * SR)) * 0.08
    add(drum_l, drum_r, t0, kick)
    # off-beat hat
    n = int(0.09 * SR)
    hat = highpass(rng.standard_normal(n), 7000) * np.exp(-np.arange(n) / SR * 45) * 0.06
    add(drum_l, drum_r, t0 + BEAT / 2, hat * 0.8, hat * 1.1)
    # closed 16ths, quieter
    for q in (1, 3):
        n2 = int(0.04 * SR)
        h2 = highpass(rng.standard_normal(n2), 8000) * np.exp(-np.arange(n2) / SR * 90) * 0.025
        add(drum_l, drum_r, t0 + q * BEAT / 4, h2 * 1.1, h2 * 0.8)
    # clap on 2 and 4
    if b % 2 == 1:
        n = int(0.25 * SR)
        noise = bandpass(rng.standard_normal(n), 900, 3500)
        env = np.zeros(n)
        for k in range(3):
            s = int(k * 0.011 * SR)
            env[s:] += np.exp(-np.arange(n - s) / SR * (60 if k < 2 else 16))
        add(drum_l, drum_r, t0, noise * env * 0.09)

# --- bass (8ths on the root, sidechained) -------------------------------------------
bass = np.zeros(N)
for i in range(int(LENGTH / (BEAT / 2))):
    t0 = i * BEAT / 2
    if t0 < 18 or t0 >= OUTRO or within(t0, [BREAK]):
        continue
    bar = int(t0 // BAR)
    root = ROOTS[bar % 4]
    n = int(BEAT / 2 * SR)
    tt = np.arange(n) / SR
    f = midi(root)
    sig = np.sin(2 * np.pi * f * tt) * 0.8 + lowpass(saw(f, n), 500) * 0.25
    sig *= adsr(n, 0.005, 0.08, 0.7, 0.04) * 0.2
    i0 = int(t0 * SR)
    bass[i0 : i0 + n] += sig[: max(0, min(n, N - i0))]

# --- risers & impacts ---------------------------------------------------------------
fx_l = np.zeros(N)
fx_r = np.zeros(N)
for cut in (18, 78):
    n = int(3.5 * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    chunk = 2048
    for k in range(0, n, chunk):
        frac = k / n
        seg = noise[k : k + chunk]
        out[k : k + chunk] = bandpass(seg, 300 + 6000 * frac**2, 800 + 9000 * frac**2)
    out *= np.linspace(0, 1, n) ** 2 * 0.07
    add(fx_l, fx_r, cut - 3.5, out * 0.9, out * 1.1)
for cut in (8, 18, 42, 64, 78, 96, 106):
    n = int(1.6 * SR)
    tt = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (38 + 30 * np.exp(-tt * 6)) * tt) * np.exp(-tt * 3.2) * 0.22
    shimmer = highpass(rng.standard_normal(n), 5000) * np.exp(-tt * 5) * 0.02
    add(fx_l, fx_r, cut, boom + shimmer)

# --- sidechain ----------------------------------------------------------------------
duck = np.ones(N)
for t0 in kick_times:
    i0 = int(t0 * SR)
    n = int(0.32 * SR)
    curve = 1 - 0.6 * np.exp(-np.arange(n) / SR * 11)
    m = min(n, N - i0)
    duck[i0 : i0 + m] = np.minimum(duck[i0 : i0 + m], curve[:m])

mix_l = (pad_l + bass) * duck + arp_l * (0.6 + 0.4 * duck) + drum_l + fx_l
mix_r = (pad_r + bass) * duck + arp_r * (0.6 + 0.4 * duck) + drum_r + fx_r

# --- reverb send ----------------------------------------------------------------------
ir_n = int(2.2 * SR)
tt = np.arange(ir_n) / SR
ir_l = rng.standard_normal(ir_n) * np.exp(-tt * 3.0)
ir_r = rng.standard_normal(ir_n) * np.exp(-tt * 3.0)
ir_l, ir_r = lowpass(ir_l, 5000), lowpass(ir_r, 5000)
send_l = pad_l * 0.6 + arp_l + fx_l * 0.5 + drum_l * 0.08
send_r = pad_r * 0.6 + arp_r + fx_r * 0.5 + drum_r * 0.08
rev_l = fftconvolve(send_l, ir_l)[:N] * 0.012
rev_r = fftconvolve(send_r, ir_r)[:N] * 0.012
mix_l += rev_l
mix_r += rev_r

# --- master ---------------------------------------------------------------------------
mix_l = highpass(mix_l, 28)
mix_r = highpass(mix_r, 28)
total = int(LENGTH * SR)
mix_l, mix_r = mix_l[:total], mix_r[:total]
fade_in = int(0.6 * SR)
fade_out = int(4.0 * SR)
for ch in (mix_l, mix_r):
    ch[:fade_in] *= np.linspace(0, 1, fade_in)
    ch[-fade_out:] *= np.linspace(1, 0, fade_out) ** 1.5
peak = max(np.abs(mix_l).max(), np.abs(mix_r).max())
mix_l = np.tanh(mix_l / peak * 1.3) / np.tanh(1.3) * 0.89
mix_r = np.tanh(mix_r / peak * 1.3) / np.tanh(1.3) * 0.89

pcm = np.empty(total * 2, dtype=np.int16)
pcm[0::2] = np.clip(mix_l * 32767, -32768, 32767).astype(np.int16)
pcm[1::2] = np.clip(mix_r * 32767, -32768, 32767).astype(np.int16)
with wave.open(out_path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"wrote {out_path} ({LENGTH:.1f}s)")
