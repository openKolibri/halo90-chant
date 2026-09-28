"""Arrange, render, mix and master MISSA NONAGINTA; export the timeline for the video.

usage: python mix.py [--force stem1,stem2|all]
"""
import json, os, sys, time
import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
from score import (BAR, BEAT, CHORDS, CASE_LAND, DURATION, SECTIONS, t, expand_lines, ostinato_events,
                   sparkle_events, taiko_hits, halo_scan, boot_events)
import synth as S
import voice as V

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUILD = os.path.join(ROOT, "build")
STEMS = os.path.join(BUILD, "stems")
os.makedirs(STEMS, exist_ok=True)
TOTAL = DURATION + 0.5
SR = S.SR

FORCE = set()
if "--force" in sys.argv:
    FORCE = set(sys.argv[sys.argv.index("--force") + 1].split(","))


def stem(name):
    def deco(fn):
        def run():
            p = os.path.join(STEMS, name + ".npy")
            if os.path.exists(p) and name not in FORCE and "all" not in FORCE:
                return np.load(p)
            t0 = time.time()
            x = fn().astype(np.float32)
            np.save(p, x)
            print(f"  stem {name:10s} {time.time() - t0:6.1f}s  peak {np.abs(x).max():.3f}")
            return x
        run.name = name
        return run
    return deco


LINES = expand_lines()

# ---- choir -----------------------------------------------------------------------------
# (monk, formant alpha, transpose, detune cents, time offset s, gain, pan)
UNISON = [("eddy", 1.00, 0, 0, 0.000, 0.40, 0.00), ("reed", 0.97, 0, 8, 0.014, 0.34, -0.35),
          ("rocko", 1.02, 0, -7, -0.010, 0.34, 0.35), ("grandpa", 0.99, 0, 4, 0.022, 0.28, -0.6),
          ("eddy", 0.95, 0, -11, 0.030, 0.26, 0.6), ("reed", 1.04, 0, 12, -0.018, 0.24, 0.15)]
OCTAVE = [("rocko", 0.92, -12, 3, 0.012, 0.30, -0.25), ("grandpa", 0.90, -12, -5, -0.006, 0.28, 0.3),
          ("eddy", 0.93, -12, 7, 0.020, 0.22, 0.0)]
FIFTH = [("reed", 0.95, -7, -3, 0.010, 0.24, -0.45), ("rocko", 0.97, -7, 6, -0.014, 0.22, 0.45),
         ("eddy", 0.96, -7, 0, 0.024, 0.18, 0.0)]
PARTS = {
    "cantor": [("eddy", 1.0, 0, 0, 0, 0.55, 0.0), ("reed", 0.96, 0, 7, 0.018, 0.22, -0.2)],
    "cantor2": [("eddy", 1.0, 0, 0, 0, 0.45, 0.0), ("reed", 0.96, 0, 7, 0.018, 0.25, -0.25),
                ("rocko", 1.03, 0, -6, -0.012, 0.22, 0.25), ("grandpa", 0.98, 0, 4, 0.025, 0.18, -0.4)],
    "choir": UNISON + OCTAVE,
    "chant": [(m, a, tr, d, o * 0.5, g, p) for (m, a, tr, d, o, g, p) in UNISON + OCTAVE],
    "organum": UNISON + OCTAVE + FIFTH,
}
AMEN = [  # per-voice transposition of the two notes (B3->A3 top line)
    ([0, 0], UNISON[:4]), ([-4, -3], UNISON[2:5]), ([-9, -7], OCTAVE[:2] + [UNISON[1]]),
    ([-16, -19], OCTAVE)]


def _norm(y):
    v = y[np.abs(y) > 0.02 * np.abs(y).max()]
    rms = np.sqrt((v ** 2).mean()) if len(v) else 1.0
    return y / (rms + 1e-9) * 0.1


def _place(out, t0, y, gain, pan, off=0.0):
    S.add(out, S.pan2(_norm(y) * gain, pan), t0 + off)


@stem("choir")
def choir():
    out = S.buf(TOTAL)
    for li, L in enumerate(LINES):
        if L["part"] == "amen":
            for k, (trs, vs) in enumerate(AMEN):
                syls = []
                for s, tr in zip(L["syls"], trs):
                    syls.append(dict(s, notes=[dict(n, midi=n["midi"] + tr) for n in s["notes"]]))
                for j, (monk, a, _, det, off, g, p) in enumerate(vs):
                    t0, y = V.sing_line(syls, monk=monk, alpha=a, detune_cents=det, seed=li * 100 + k * 10 + j,
                                        vib_depth=0.12)
                    _place(out, t0, y, g * (0.9 if k else 1.0), p, off)
            continue
        for j, (monk, a, tr, det, off, g, p) in enumerate(PARTS[L["part"]]):
            t0, y = V.sing_line(L["syls"], monk=monk, transpose=tr, alpha=a, detune_cents=det,
                                seed=li * 100 + j, vib_depth=0.2 if L["part"].startswith("cantor") else 0.15)
            _place(out, t0, y, g, p, off)
    # the solo lines get a touch more level than the tutti per voice count
    return out


@stem("pads")
def pads():
    out = S.buf(TOTAL)
    k = 0

    def pad(vowel, midi, t0, t1, gain, monks=("eddy", "rocko")):
        nonlocal k
        for i, m in enumerate(monks):
            s0, y = V.sustain(vowel, midi, t0, t1, monk=m, alpha=0.95 + 0.05 * i,
                              detune_cents=(-6, 6, 0)[i % 3], seed=900 + k)
            k += 1
            y = y * np.clip(np.arange(len(y)) / (SR * 2.0), 0, 1) * np.clip((len(y) - np.arange(len(y))) / (SR * 2.0), 0, 1)
            _place(out, s0, y, gain, (-0.5, 0.5, 0)[i % 3])

    pad("o", 50, 3.5, 29.0, 0.12)
    pad("o", 45, 5.0, 29.0, 0.09)
    for bar in range(34, 42):
        root, ivs, _ = CHORDS[bar]
        tones = sorted(((root + iv - 50) % 12) + 50 for iv in ivs)
        for tn in tones:
            pad("u", tn, t(bar), t(bar + 1) + 0.4, 0.07)
    for tn in (50, 54, 57, 62):          # D major "all shine" hold + finis
        pad("a", tn, t(50), t(52) + 0.5, 0.07)
        pad("o", tn, t(55), DURATION - 1.0, 0.075)
    return out


# ---- orchestra ---------------------------------------------------------------------------

def voice_lead(bars, ranges, octave_double=False):
    """Nearest-tone voice leading through the chords of `bars`; ties repeated pitches."""
    prev = [(lo + hi) // 2 for lo, hi in ranges]
    lines = [[] for _ in ranges]
    for bar in bars:
        root, ivs, _ = CHORDS[bar]
        pcs = [(root + i) % 12 for i in ivs]
        for v, (lo, hi) in enumerate(ranges):
            cands = [m for m in range(lo, hi + 1) if m % 12 in pcs]
            # soprano prefers the third/fifth, spread voices across chord tones
            m = min(cands, key=lambda c: abs(c - prev[v]) + (
                2.5 if v and lines[v - 1] and c % 12 == lines[v - 1][-1][0] % 12 else 0))
            prev[v] = m
            if lines[v] and lines[v][-1][0] == m and abs(lines[v][-1][2] - t(bar)) < 1e-6:
                lines[v][-1][2] = t(bar + 1)
            else:
                lines[v].append([m, t(bar), t(bar + 1)])
    return lines


@stem("strings")
def strings():
    notes = []
    notes += [(38, 4.0, 30.0, 0.55), (45, 5.0, 30.0, 0.45)]
    notes += [(50, 12.0, 30.0, 0.4), (57, 13.0, 30.0, 0.35)]
    halo = voice_lead(range(10, 22), [(62, 72), (55, 66), (50, 60)])
    for v, line in enumerate(halo):
        for m, a, b in line:
            bar = int(a / BAR + 1e-6)
            notes.append((m, a, b, 0.55 + 0.35 * (bar - 10) / 11))
    notes += [(CHORDS[b][0], t(b), t(b + 1), 0.7) for b in range(10, 22)]
    dyn = voice_lead(range(22, 34), [(69, 79), (62, 72)])
    for line in dyn:
        notes += [(m, a, b, 0.45) for m, a, b in line]
    notes += [(CHORDS[b][0], t(b), t(b + 1), 0.6) for b in range(22, 34)]
    sc = voice_lead(range(34, 42), [(62, 72), (57, 67)])
    for line in sc:
        notes += [(m, a, b, 0.3 if a < t(40) else 0.75) for m, a, b in line]
    notes += [(CHORDS[b][0] + 12, t(b), t(b + 1), 0.35) for b in range(34, 42)]
    ap = voice_lead(range(42, 52), [(62, 74), (55, 67), (50, 62)])
    for line in ap:
        for m, a, b in line:
            notes.append((m, a, b, 0.95))
            notes.append((m + 12, a, b, 0.55))
    notes += [(CHORDS[b][0], t(b), t(b + 1), 0.9) for b in range(42, 52)]
    notes += [(50, t(52), t(54), 0.3), (57, t(52), t(54), 0.25)]
    notes += [(55, t(54), t(55), 0.35), (59, t(54), t(55), 0.3), (43, t(54), t(55), 0.4)]
    for m in (50, 54, 57, 62, 38):
        notes.append((m, t(55), DURATION - 2.0, 0.35))
    body = S.strings(notes, TOTAL)
    hi = S.strings([(81, 18.0, 30.0, 0.2), (86, t(50), t(52), 0.3), (78, t(55), DURATION - 2.5, 0.15)],
                   TOTAL, bright=5000, attack=2.0, voices=3)
    return body + hi


@stem("horns")
def horns():
    notes = []
    for bars, vel in ((range(14, 22), 0.6), (range(30, 34), 0.7), (range(42, 52), 0.9)):
        for line in voice_lead(bars, [(57, 65), (50, 58)]):
            notes += [(m, a, b, vel) for m, a, b in line]
    return S.horns(notes, TOTAL)


@stem("bass")
def bass():
    notes = []
    for bar in list(range(22, 34)) + list(range(42, 50)):
        root = CHORDS[bar][0]
        for e in range(8):
            m = root + (12 if e == 7 else 0)
            notes.append((m, t(bar, e * 0.5), t(bar, e * 0.5 + 0.42), 0.9 if e % 2 == 0 else 0.7))
    notes += [(38, t(50), t(52), 0.8)]
    out = S.bass(notes, TOTAL)
    out += S.drone(38, 2.0, 30.5, TOTAL, gain=0.08, fade=4.0)
    out += S.drone(38, t(52) - 0.5, DURATION - 0.5, TOTAL, gain=0.1, fade=3.0)
    return out


@stem("ostinato")
def ostinato():
    ev = ostinato_events()
    for e in ev:
        e["vel"] = 1.0 if e["bar"] >= 42 else 0.85
    return S.cello_staccato(ev, TOTAL)


@stem("chip")
def chip():
    ev = [dict(e) for e in ostinato_events()]
    for e in ev:
        e["vel"] = 1.6 if 30 <= e["bar"] < 32 else 0.9
    return S.chip(ev, TOTAL)


def scan_bells():
    ev, scan = [], halo_scan()
    for bar in range(14, 22):
        root, ivs, _ = CHORDS[bar]
        tones = [root + 36 + i for i in ivs]
        for e in range(8):
            led = next(scan)
            ev.append(dict(t=t(bar, e * 0.5), led=led, midi=tones[led % len(tones)] + 12 * ((led // 3) % 2), vel=0.35))
    return ev


def sparkle_dense():
    return sparkle_events()


@stem("bells")
def bells():
    x = S.bell(scan_bells() + [dict(e, vel=0.9) for e in sparkle_dense()], TOTAL)
    return S.delay(x, BEAT * 0.75, fb=0.4, mix=0.3)


@stem("piano")
def piano():
    notes = []
    for bar in range(34, 42):
        root, ivs, _ = CHORDS[bar]
        pat = [root + 24, root + 24 + ivs[2], root + 36 + ivs[1], root + 36 + ivs[2],
               root + 48, root + 36 + ivs[2], root + 36 + ivs[1], root + 24 + ivs[2]]
        for e, m in enumerate(pat):
            notes.append((m, t(bar, e * 0.5), t(bar, e * 0.5 + 0.9), 0.42 + 0.1 * (e == 0)))
        notes.append((root + 12, t(bar), t(bar + 1), 0.5))
    notes += [(74, t(52), t(53), 0.35), (69, t(53), t(54), 0.3), (62, t(56, 2), t(58), 0.3)]
    return S.piano(notes, TOTAL)


@stem("perc")
def perc():
    hits = taiko_hits()
    deep = [(h, v) for h, v in hits if h < 30]
    rest = [(h, v) for h, v in hits if h >= 30]
    out = S.taiko(deep, TOTAL, gain=1.0, pitch=0.75) + S.taiko(rest, TOTAL, gain=0.75)
    tim = [(CHORDS[b][0], t(b), 0.8) for b in list(range(18, 22)) + list(range(42, 52))]
    tim += [(38, t(50), 1.0)]
    out += S.timpani(tim, TOTAL)
    out += S.roll(27.0, 30.0, TOTAL, 0.05, 0.9, 14, kind="timp", midi=38)
    out += S.roll(t(40), t(42), TOTAL, 0.05, 1.0, 14, kind="timp", midi=45)
    fills = []
    for b in (25, 29, 33, 45, 49):
        for k in range(8):
            fills.append((t(b, 2 + k * 0.25), 0.5 + 0.06 * k, 200 - k * 14))
    out += S.toms(fills, TOTAL)
    sn = [(t(b, 2), 0.8) for b in list(range(22, 34)) + list(range(42, 50))]
    out += S.snare(sn, TOTAL)
    out += S.roll(t(21), t(22), TOTAL, 0.05, 0.8, 16)
    out += S.roll(t(40, 2), t(42), TOTAL, 0.03, 0.9, 16)
    out += S.roll(t(49), t(50), TOTAL, 0.1, 1.0, 16)
    for a, b, crash in ((27.0, 30.0, True), (t(21), t(22), True), (t(33, 2), t(34), False),
                        (t(40), t(42), True), (t(49), t(50), True)):
        out += S.cymbal_swell(a, b, TOTAL, gain=0.18, crash=crash)
    out += S.gong(30.0, TOTAL, gain=0.25) + S.gong(t(50), TOTAL, gain=0.4, f0=58)
    return out


@stem("guitar")
def guitar():
    ch = []
    for bar in list(range(26, 34)) + list(range(42, 50)):
        r = CHORDS[bar][0]
        r = r if r >= 38 else r + 12
        for e in range(8):
            if e == 0:
                ch.append((r, t(bar, 0), BEAT * 1.4, 1.0, False))
            elif e == 3:
                ch.append((r, t(bar, 1.5), BEAT * 0.9, 0.9, False))
            elif e not in (1, 4):
                ch.append((r, t(bar, e * 0.5), BEAT * 0.4, 0.55, True))
    ch.append((38, t(50), BAR * 2, 1.0, False))
    return S.guitar(ch, TOTAL)


@stem("fx")
def fx():
    from score import MARKS
    M = MARKS
    out = S.click([M["press"], M["release"], M["hold"], M["halt"] + 0.02, M["wake"]], TOTAL)
    out += S.boot_zip(0.6, 1.0, TOTAL)
    out += S.boot_zip(M["wake"] + 0.1, 1.0, TOTAL, gain=0.06)
    # the magnetic lid closing on the case (cue mark 'lid')
    out += S.click([M["lid"]], TOTAL, gain=0.35) + S.taiko([(M["lid"], 0.22)], TOTAL, gain=0.5, pitch=2.6)
    # the spare cell and then the earring settling into the right-hand pocket
    out += S.click([M["cell"] + CASE_LAND["cell"]], TOTAL, gain=0.16) + S.click([M["place"] + CASE_LAND["place"]], TOTAL, gain=0.12)
    out += S.air(2.0, 30.0, TOTAL) + S.air(t(52), DURATION, TOTAL, gain=0.025)
    return out


ALL = [choir, pads, strings, horns, bass, ostinato, chip, bells, piano, perc, guitar, fx]


def section_rms(x, name):
    row = []
    for sname, a, b, _ in SECTIONS:
        seg = x[int(t(a) * SR):int(t(b) * SR)]
        r = np.sqrt((seg ** 2).mean()) if len(seg) else 0
        row.append(f"{20 * np.log10(r + 1e-9):6.1f}")
    print(f"  {name:10s}" + " ".join(row))


def main():
    t0 = time.time()
    st = {f.name: f() for f in ALL}
    print("render", round(time.time() - t0, 1), "s")
    cath = S.make_ir(5.0, 2.6, 7.0, 0.045, seed=3)
    hall = S.make_ir(2.8, 1.4, 4.0, 0.02, seed=5)
    room = S.make_ir(0.9, 0.5, 1.5, 0.008, seed=7)

    choir_eq = S.filt(S.sos_lp(5200, 2), S.filt(S.sos_hp(90, 2), st["choir"]))
    bus = {
        "choir": S.reverb(choir_eq, cath, wet=0.55, dry=0.85) * 1.45,
        "pads": S.reverb(S.filt(S.sos_lp(3500, 2), st["pads"]), cath, wet=0.8, dry=0.5) * 0.9,
        "strings": S.reverb(st["strings"], hall, wet=0.4) * 0.75,
        "horns": S.reverb(st["horns"], hall, wet=0.4) * 0.7,
        "bass": st["bass"] * 0.75,
        "ostinato": S.reverb(st["ostinato"], room, wet=0.3) * 1.1,
        "chip": S.reverb(S.delay(st["chip"], BEAT * 0.75, 0.3, 0.25), room, wet=0.2) * 1.1,
        "bells": S.reverb(st["bells"], cath, wet=0.5) * 0.9,
        "piano": S.reverb(st["piano"], hall, wet=0.4) * 0.9,
        "perc": S.reverb(st["perc"], hall, wet=0.25) * 0.36,
        "guitar": S.reverb(st["guitar"], room, wet=0.15) * 0.6,
        "fx": S.reverb(st["fx"], hall, wet=0.2),
    }
    print("  section   " + " ".join(f"{s[0][:6]:>6s}" for s in SECTIONS))
    for k, v in bus.items():
        section_rms(v, k)
    mixd = sum(bus.values())
    mixd = S.filt(S.sos_hp(28, 2), mixd)
    mixd = S.glue(mixd, -18, 1.7)
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(mixd.astype(np.float64))
    mixd = mixd * 10 ** ((-14.0 - lufs) / 20)   # streaming-level target, limiter only catches peaks
    mixd = S.limiter(mixd, 0.86)
    print(f"  loudness {lufs:.1f} -> {meter.integrated_loudness(mixd.astype(np.float64)):.1f} LUFS")
    # fade tail
    n = len(mixd)
    fade = int(0.4 * SR)
    mixd[-fade:] *= np.linspace(1, 0, fade)[:, None]
    os.makedirs(os.path.join(BUILD, "audio"), exist_ok=True)
    path = os.path.join(BUILD, "audio", "nonaginta.wav")
    sf.write(path, mixd, SR, subtype="PCM_24")
    section_rms(mixd, "MASTER")
    print("wrote", path, f"{len(mixd) / SR:.1f}s", "total", round(time.time() - t0, 1), "s")
    export_timeline(mixd)


def export_timeline(mixd, fps=30):
    frames = int(DURATION * fps)
    hop = SR // fps
    mono = mixd.mean(1)
    rms, wave, bands = [], [], []
    from scipy import signal
    lo = signal.sosfilt(S.sos_lp(200), mono)
    hi = signal.sosfilt(S.sos_hp(3000), mono)
    for f in range(frames):
        seg = mono[f * hop:(f + 1) * hop]
        if len(seg) < hop:
            seg = np.pad(seg, (0, hop - len(seg)))
        rms.append(float(np.sqrt((seg ** 2).mean())))
        # 90 signed samples per frame: the 'ADC readings' the firmware projects round the ring
        wave.append([round(float(v), 3) for v in seg[:hop - hop % 90].reshape(90, -1).mean(1)])
        bands.append([float(np.sqrt((lo[f * hop:(f + 1) * hop] ** 2).mean())),
                      float(np.sqrt((hi[f * hop:(f + 1) * hop] ** 2).mean()))])
    mx = max(rms)
    tl = dict(
        fps=fps, duration=DURATION, bar=BAR, beat=BEAT,
        sections=[dict(name=n, t0=t(a), t1=t(b), sub=s) for n, a, b, s in SECTIONS],
        lines=[dict(latin=L["latin"], en=L["en"], tech=L["tech"], part=L["part"], t0=L["t0"], t1=L["t1"],
                    syls=[dict(text=s["text"], word=s["word"], t0=s["t0"], t1=s["t1"],
                               midi=s["notes"][0]["midi"]) for s in L["syls"]]) for L in LINES],
        ostinato=ostinato_events(), sparkle=sparkle_dense(), scan_bells=scan_bells(),
        boot=boot_events(), taiko=[dict(t=h, v=v) for h, v in taiko_hits()],
        chords={str(k): v[2] for k, v in CHORDS.items()},
        clicks=[0.5, 1.68, 161.0, 161.55, 175.3],
        rms=[round(r / mx, 4) for r in rms], bands=[[round(a / mx, 4), round(b / mx, 4)] for a, b in bands],
        wave=wave)
    with open(os.path.join(BUILD, "timeline.json"), "w") as fh:
        json.dump(tl, fh)
    print("timeline frames", frames)


if __name__ == "__main__":
    main()
