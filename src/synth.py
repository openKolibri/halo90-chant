"""Orchestra of numpy/scipy instruments for MISSA NONAGINTA. All output is stereo float32."""
import numpy as np
from scipy import signal

SR = 44100
RNG = np.random.default_rng(90)


def hz(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def buf(seconds):
    return np.zeros((int(seconds * SR) + 1, 2), dtype=np.float32)


def pan2(x, p):
    """Constant-power pan, p in [-1, 1]."""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1).astype(np.float32)


def add(dst, x, t0):
    i = int(round(t0 * SR))
    if i < 0:
        x, i = x[-i:], 0
    n = min(len(x), len(dst) - i)
    if n > 0:
        dst[i:i + n] += x[:n]


def sos_lp(fc, order=2):
    return signal.butter(order, min(fc, SR * 0.45), "low", fs=SR, output="sos")


def sos_hp(fc, order=2):
    return signal.butter(order, fc, "high", fs=SR, output="sos")


def sos_bp(lo, hi, order=2):
    return signal.butter(order, [lo, min(hi, SR * 0.45)], "band", fs=SR, output="sos")


def filt(sos, x):
    return signal.sosfilt(sos, x, axis=0).astype(np.float32)


# ---- oscillators ---------------------------------------------------------------------

def _blep(t, dt):
    y = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m]
    y[m] = x + x - x * x - 1
    m = t > 1 - dt
    x = (t[m] - 1) / dt[m]
    y[m] = x * x + x + x + 1
    return y


def saw(f, phase0=None):
    f = np.asarray(f, dtype=np.float64)
    dt = f / SR
    ph = ((RNG.random() if phase0 is None else phase0) + np.cumsum(dt)) % 1.0
    return (2 * ph - 1 - _blep(ph, dt)).astype(np.float32)


def pulse(f, duty=0.5, phase0=0.0):
    f = np.asarray(f, dtype=np.float64)
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    a = 2 * ph - 1 - _blep(ph, dt)
    ph2 = (ph + 1 - duty) % 1.0
    b = 2 * ph2 - 1 - _blep(ph2, dt)
    return ((a - b) * 0.5).astype(np.float32)


def adsr(n, a, d, s, r, hold):
    """hold = seconds before release begins; total length n samples."""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = t >= hold
    level_at_rel = np.interp(hold, t, e) if hold < t[-1] else e[-1]
    e = np.where(rel, level_at_rel * np.exp(-(t - hold) / max(r, 1e-4)), e)
    return e.astype(np.float32)


def vibrato(n, rate=5.5, cents=8, delay=0.3, seed=None):
    rng = np.random.default_rng(seed)
    t = np.arange(n) / SR
    depth = cents * np.clip((t - delay) / 0.5, 0, 1)
    return 2 ** (depth * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6)) / 1200)


# ---- instruments ---------------------------------------------------------------------

def strings(notes, total, bright=2600, attack=0.4, release=0.9, voices=5, spread=0.7, gain=0.12):
    """notes: list of (midi, t0, t1, vel). Lush detuned ensemble."""
    out = buf(total)
    for (m, t0, t1, vel) in notes:
        dur = t1 - t0
        n = int((dur + release * 3) * SR)
        e = adsr(n, attack, 1.0, 0.9, release, dur)
        f = hz(m)
        sig = np.zeros((n, 2), np.float32)
        for v in range(voices):
            det = (v - (voices - 1) / 2) / max(voices - 1, 1) * 14
            fv = f * 2 ** (det / 1200) * vibrato(n, 5.2 + 0.4 * RNG.random(), 7, 0.25, seed=int(RNG.integers(1e9)))
            x = saw(fv)
            sig += pan2(x, (v / max(voices - 1, 1) * 2 - 1) * spread)
        fc = bright * (0.6 + 0.6 * vel)
        sig = filt(sos_lp(fc, 2), sig)
        sig = filt(sos_hp(60, 1), sig)
        add(out, sig * e[:, None] * vel * gain / voices ** 0.5, t0)
    return out


def horns(notes, total, gain=0.16):
    out = buf(total)
    for (m, t0, t1, vel) in notes:
        dur = t1 - t0
        n = int((dur + 1.5) * SR)
        e = adsr(n, 0.25, 0.8, 0.85, 0.5, dur)
        f = hz(m)
        sig = np.zeros(n, np.float32)
        for d in (-6, 0, 5):
            fv = f * 2 ** (d / 1200) * vibrato(n, 4.8, 5, 0.4, seed=int(RNG.integers(1e9)))
            sig += saw(fv) * 0.6 + pulse(fv, 0.5) * 0.4
        dark = filt(sos_lp(500 + f, 2), sig)
        bright = filt(sos_lp(1800 + 2 * f, 2), sig)
        b = np.clip(e * vel, 0, 1) ** 1.5
        x = dark * (1 - b) + bright * b
        add(out, pan2(x * e * vel * gain, RNG.uniform(-0.3, 0.3)), t0)
    return out


def bass(notes, total, gain=0.28):
    out = buf(total)
    for (m, t0, t1, vel) in notes:
        dur = t1 - t0
        n = int((dur + 0.4) * SR)
        e = adsr(n, 0.005, 0.25, 0.6, 0.08, dur)
        f = hz(m)
        x = np.sin(2 * np.pi * np.cumsum(np.full(n, f)) / SR).astype(np.float32) * 0.8
        x += filt(sos_lp(350, 2), saw(np.full(n, f))) * 0.5
        add(out, pan2(x * e * vel * gain, 0), t0)
    return out


def drone(midi, t0, t1, total, gain=0.2, fade=3.0):
    out = buf(total)
    n = int((t1 - t0) * SR)
    t = np.arange(n) / SR
    e = np.clip(t / fade, 0, 1) * np.clip((t1 - t0 - t) / fade, 0, 1)
    f = hz(midi)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t + 0.3) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    add(out, pan2((x * e * gain).astype(np.float32), 0), t0)
    return out


def cello_staccato(events, total, gain=0.14):
    out = buf(total)
    for ev in events:
        n = int(0.32 * SR)
        f = hz(ev["midi"] - 12)
        x = saw(np.full(n, f)) * 0.7 + saw(np.full(n, f * 1.003)) * 0.5
        x = filt(sos_lp(1400 + f * 2, 2), x)
        bow = filt(sos_bp(1500, 5000), RNG.standard_normal(n).astype(np.float32)) * 0.08
        e = adsr(n, 0.004, 0.09, 0.25, 0.05, 0.14)
        v = ev.get("vel", 1.0)
        add(out, pan2((x + bow) * e * gain * v, -0.35 + 0.1 * RNG.random()), ev["t"])
    return out


def chip(events, total, gain=0.06, crush=4):
    """The STM8 sings: 25% pulse, sample-and-hold decimated and bit-crushed."""
    out = buf(total)
    for ev in events:
        n = int(0.2 * SR)
        f = hz(ev["midi"] + 12)
        x = pulse(np.full(n, f), 0.25)
        x = np.repeat(x[::crush], crush)[:n]
        x = np.round(x * 7) / 7
        e = adsr(n, 0.001, 0.07, 0.2, 0.03, 0.1)
        add(out, pan2(x * e * gain * ev.get("vel", 1.0), 0.35), ev["t"])
    return out


def taiko(hits, total, gain=0.9, pitch=1.0):
    out = buf(total)
    for (t0, vel) in hits:
        n = int(1.6 * SR)
        t = np.arange(n) / SR
        p = pitch * (1 + 0.05 * RNG.standard_normal())
        f = (58 + 70 * np.exp(-t / 0.025)) * p
        body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.45)
        body += 0.35 * np.sin(2 * np.pi * np.cumsum(f * 1.58) / SR) * np.exp(-t / 0.2)
        hit = filt(sos_lp(1800, 2), RNG.standard_normal(n).astype(np.float32)) * np.exp(-t / 0.018) * 0.9
        x = np.tanh((body + hit) * 1.4).astype(np.float32)
        add(out, pan2(x * vel * gain, RNG.uniform(-0.15, 0.15)), t0)
    return out


def toms(hits, total, gain=0.5):
    out = buf(total)
    for (t0, vel, f0) in hits:
        n = int(0.8 * SR)
        t = np.arange(n) / SR
        f = f0 * (1 + 0.5 * np.exp(-t / 0.03))
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
        x += filt(sos_lp(3000), RNG.standard_normal(n).astype(np.float32)) * np.exp(-t / 0.012) * 0.5
        add(out, pan2(x.astype(np.float32) * vel * gain, (f0 - 120) / 120), t0)
    return out


def snare(hits, total, gain=0.35):
    out = buf(total)
    for (t0, vel) in hits:
        n = int(0.5 * SR)
        t = np.arange(n) / SR
        body = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05)
        wires = filt(sos_bp(1800, 9000), RNG.standard_normal(n).astype(np.float32)) * np.exp(-t / 0.13)
        x = (0.6 * body + wires).astype(np.float32)
        add(out, pan2(x * vel * gain, 0.05), t0)
    return out


def roll(t0, t1, total, v0=0.1, v1=0.8, rate=16, kind="snare", midi=38):
    n = int((t1 - t0) * rate)
    hits = [(t0 + i / rate + 0.004 * RNG.standard_normal(), v0 + (v1 - v0) * (i / max(n, 1)) ** 1.6) for i in range(n)]
    if kind == "snare":
        return snare(hits, total, gain=0.22)
    return timpani([(midi, h[0], h[1]) for h in hits], total, gain=0.25)


def timpani(notes, total, gain=0.5):
    out = buf(total)
    ratios = [1.0, 1.504, 1.742, 2.0, 2.245, 2.494]
    amps = [1.0, 0.8, 0.5, 0.45, 0.3, 0.2]
    for (m, t0, vel) in notes:
        n = int(2.5 * SR)
        t = np.arange(n) / SR
        f = hz(m)
        x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (1.2 / r)) for r, a in zip(ratios, amps))
        x += filt(sos_lp(900), RNG.standard_normal(n).astype(np.float32)) * np.exp(-t / 0.01) * 0.6
        add(out, pan2(x.astype(np.float32) * vel * gain * 0.3, -0.1), t0)
    return out


def cymbal_swell(t0, t1, total, gain=0.25, crash=True):
    out = buf(total)
    n = int((t1 - t0) * SR)
    t = np.arange(n) / SR
    noise = RNG.standard_normal((n, 2)).astype(np.float32)
    x = filt(sos_hp(2500, 2), noise) * ((t / (t1 - t0)) ** 3)[:, None]
    add(out, x * gain, t0)
    if crash:
        m = int(4.0 * SR)
        tt = np.arange(m) / SR
        c = filt(sos_hp(1800, 2), RNG.standard_normal((m, 2)).astype(np.float32)) * np.exp(-tt / 1.3)[:, None]
        add(out, c * gain * 1.2, t1)
    return out


def gong(t0, total, gain=0.35, f0=62.0):
    out = buf(total)
    n = int(9 * SR)
    t = np.arange(n) / SR
    partials = [1, 1.52, 2.11, 2.68, 3.24, 3.9, 4.62, 5.4]
    x = np.zeros(n)
    for k, r in enumerate(partials):
        x += np.sin(2 * np.pi * f0 * r * t * (1 + 0.002 * np.sin(2 * np.pi * 0.3 * t))) * np.exp(-t / (5.0 / (1 + 0.4 * k))) / (1 + k * 0.5)
    swell = filt(sos_bp(300, 3000), RNG.standard_normal(n).astype(np.float32)) * (np.clip(t / 0.4, 0, 1) * np.exp(-t / 2.5)) * 0.6
    y = (x * 0.4 + swell).astype(np.float32)
    add(out, np.stack([y, np.roll(y, 300)], 1) * gain, t0)
    return out


def piano(notes, total, gain=0.2):
    out = buf(total)
    B = 0.00035
    for (m, t0, t1, vel) in notes:
        f = hz(m)
        dur = max(t1 - t0, 0.2)
        tau1 = np.interp(m, [36, 60, 96], [5.0, 2.8, 0.9])
        n = int((min(dur, tau1 * 1.2) + 1.2) * SR)
        t = np.arange(n) / SR
        x = np.zeros(n)
        kmax = int(min(24, 16000 / f))
        for k in range(1, kmax + 1):
            fk = k * f * np.sqrt(1 + B * k * k)
            a = (1 / k ** 1.2) * (0.3 + 0.7 * vel) ** (k * 0.12)
            dk = tau1 / (1 + 0.35 * k)
            x += a * (np.sin(2 * np.pi * fk * t) + 0.8 * np.sin(2 * np.pi * fk * 1.0007 * t + 0.4)) * np.exp(-t / dk)
        damp = np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.15))
        x = x * damp
        ham = filt(sos_bp(800, 4000), RNG.standard_normal(n).astype(np.float32)) * np.exp(-t / 0.004) * 0.3
        y = ((x * 0.25 + ham) * vel * gain).astype(np.float32)
        add(out, pan2(y, np.clip((m - 60) / 30, -0.6, 0.6)), t0)
    return out


def bell(events, total, gain=0.13):
    out = buf(total)
    for ev in events:
        n = int(3.0 * SR)
        t = np.arange(n) / SR
        f = hz(ev["midi"])
        idx = 2.5 * np.exp(-t / 0.4) + 0.3
        mod = np.sin(2 * np.pi * f * 3.5 * t)
        x = np.sin(2 * np.pi * f * t + idx * mod) * np.exp(-t / 1.4)
        x += 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.5)
        x += 0.2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.18)
        x *= np.clip(t / 0.002, 0, 1)
        p = ((ev.get("led", 45) / 89.0) * 2 - 1) * 0.8
        add(out, pan2(x.astype(np.float32) * gain * ev.get("vel", 1.0), p), ev["t"])
    return out


def guitar(chords, total, gain=0.1):
    """Double-tracked distorted power chords. chords: (root_midi, t0, dur, vel, muted)."""
    out = buf(total)
    for side in (-0.85, 0.85):
        for (r, t0, dur, vel, muted) in chords:
            n = int((dur + 0.3) * SR)
            x = np.zeros(n, np.float32)
            for iv in (0, 7, 12):
                f = hz(r + iv) * 2 ** (RNG.normal(0, 4) / 1200)
                x += saw(np.full(n, f))
            x = np.tanh(x * (10 if not muted else 7)).astype(np.float32)
            x = filt(sos_hp(90, 2), x)
            x = filt(sos_lp(2600 if not muted else 1200, 4), x)
            e = adsr(n, 0.003, 0.18 if muted else 1.2, 0.2 if muted else 0.7, 0.06, dur)
            add(out, pan2(x * e * vel * gain, side), t0 + RNG.uniform(0, 0.012))
    return out


def click(times, total, gain=0.5):
    out = buf(total)
    for t0 in times:
        n = int(0.03 * SR)
        t = np.arange(n) / SR
        x = filt(sos_bp(2000, 9000), RNG.standard_normal(n).astype(np.float32)) * np.exp(-t / 0.002)
        x += np.sin(2 * np.pi * 3200 * t) * np.exp(-t / 0.004) * 0.3
        add(out, pan2(x.astype(np.float32) * gain, 0.1), t0)
    return out


def boot_zip(t0, dur, total, gain=0.08):
    """The boot animation: 90 tiny LED 'ticks' rising once around the ring."""
    out = buf(total)
    for i in range(90):
        n = int(0.012 * SR)
        t = np.arange(n) / SR
        f = 300 * 2 ** (i / 90 * 2.5)
        x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.003)
        add(out, pan2(x.astype(np.float32) * gain * (0.4 + 0.6 * i / 90), np.sin(i / 90 * 2 * np.pi) * 0.7), t0 + dur * i / 90)
    return out


def air(t0, t1, total, gain=0.03):
    out = buf(total)
    n = int((t1 - t0) * SR)
    t = np.arange(n) / SR
    x = RNG.standard_normal((n, 2)).astype(np.float32)
    x = filt(sos_bp(250, 1400, 2), x)
    lfo = 0.6 + 0.4 * np.sin(2 * np.pi * 0.07 * t)
    e = np.clip(t / 3, 0, 1) * np.clip((t1 - t0 - t) / 3, 0, 1)
    add(out, x * (lfo * e * gain)[:, None], t0)
    return out


# ---- space -------------------------------------------------------------------------

def make_ir(rt_low=4.5, rt_high=2.2, length=6.0, predelay=0.03, seed=1):
    rng = np.random.default_rng(seed)
    n = int(length * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2), np.float32)
    bands = [(20, 400, rt_low), (400, 2500, (rt_low + rt_high) / 2), (2500, 16000, rt_high)]
    for lo, hi, rt in bands:
        nz = rng.standard_normal((n, 2)).astype(np.float32)
        nz = filt(sos_bp(lo, hi, 2), nz)
        ir += nz * np.exp(-6.91 * t / rt)[:, None].astype(np.float32)
    ir *= np.clip(t / 0.06, 0, 1)[:, None]   # soft build of the diffuse tail
    for k in range(10):                        # sparse early reflections
        d = int((0.008 + rng.random() * 0.07) * SR)
        ir[d, rng.integers(2)] += rng.uniform(0.2, 0.5) * (1 - k / 12)
    ir = np.concatenate([np.zeros((int(predelay * SR), 2), np.float32), ir])
    return ir / np.sqrt((ir ** 2).sum() / 2)


def reverb(x, ir, wet=0.3, dry=1.0):
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c], mode="full")[:len(x)] for c in range(2)], 1)
    return (x * dry + y.astype(np.float32) * wet).astype(np.float32)


def delay(x, secs, fb=0.35, mix=0.25, pingpong=True):
    d = int(secs * SR)
    y = np.zeros_like(x)
    tap = x.copy()
    g = 1.0
    for k in range(1, 7):
        g *= fb
        s = np.zeros_like(x)
        s[d * k:] = tap[:len(x) - d * k]
        if pingpong and k % 2:
            s = s[:, ::-1]
        y += s * g
    return x + y * mix


def glue(x, thresh_db=-16, ratio=2.0, att=0.01, rel=0.25):
    """Feed-forward RMS compressor on the stereo sum."""
    lvl = np.sqrt(signal.sosfilt(sos_lp(1 / (2 * np.pi * 0.03)), (x ** 2).mean(1)).clip(1e-12))
    db = 20 * np.log10(lvl + 1e-9)
    over = np.maximum(db - thresh_db, 0)
    gr = -over * (1 - 1 / ratio)
    # asymmetric smoothing
    g = np.empty_like(gr)
    a_at, a_rel = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR))
    prev = 0.0
    # vectorised enough: process in blocks of 64 samples
    blk = 64
    for i in range(0, len(gr), blk):
        target = gr[i:i + blk].min()
        coef = a_at if target < prev else a_rel
        prev = target + (prev - target) * coef ** blk
        g[i:i + blk] = prev
    return x * (10 ** (g / 20))[:, None].astype(np.float32)


def limiter(x, ceiling=0.93, look=0.004, rel=0.08):
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    peak = np.abs(x).max(1)
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    w = int(look * SR) * 2 + 1
    g = minimum_filter1d(need, w)
    g = uniform_filter1d(g, int(look * SR) + 1)
    # slower release
    out = np.empty_like(g)
    a = np.exp(-1 / (rel * SR))
    blk = 32
    prev = 1.0
    for i in range(0, len(g), blk):
        target = g[i:i + blk].min()
        prev = target if target < prev else target + (prev - target) * a ** blk
        out[i:i + blk] = prev
    y = x * out[:, None]
    return np.clip(y, -ceiling, ceiling).astype(np.float32)
