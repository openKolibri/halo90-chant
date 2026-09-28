"""Build build/timeline.json — the only timing source the film reads.

Two ways in, one schema out:

  python src/timeline.py --cue cues/nonaginta.cue --audio build/audio/nonaginta.wav --score
      exact: syllables, events and bars come from src/score.py (the synthesized track)

  python src/timeline.py --cue cues/suno.cue --audio suno.wav [--vocals suno_vocals.wav]
      any audio (e.g. a Suno render): beats/bars/hits are detected from the audio, lines and
      section starts come from the cue sheet, syllables are placed on detected vocal onsets
      when the cue gives only line times.

  python src/timeline.py --write-cue cues/nonaginta.cue   (cue sheet generated from the score)

Cue sheet format (times as seconds or m:ss.xx; '#' comments):
  bpm 80                      optional tempo hint for beat tracking
  downbeat 0.00               optional: any known bar start
  section 0:30.00 halo  II · HALO | patternNum = 1
  mark 2:41.50 halt
  line 0:30.00 0:36.00 choir
    latin No-na-gin-ta lu-mi-na
    syl 30.00 30.75 31.50 32.63 33.00 33.75 34.50      (optional, one per syllable)
    en ninety lights
    tech // 90 × red LED · 0402 · 630 nm
"""
import argparse, json, os, random, re, sys
import numpy as np
import soundfile as sf
from scipy import signal

sys.path.insert(0, os.path.dirname(__file__))
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FPS = 30
KEYS = ["prologue", "introit", "halo", "dynamic", "sparkle", "open", "sleep", "finis"]


def parse_time(s):
    if ":" in s:
        m, sec = s.split(":")
        return int(m) * 60 + float(sec)
    return float(s)


def fmt_time(t):
    return f"{int(t // 60)}:{t % 60:05.2f}"


# ---------------------------------------------------------------- cue sheets

def write_cue(path):
    from score import SECTIONS, expand_lines, t as bar_t, BPM
    keys = dict(zip([s[0] for s in SECTIONS], KEYS))
    out = ["# NONAGINTA cue sheet (generated from src/score.py)", f"bpm {BPM}", "downbeat 0.00", ""]
    for name, a, b, sub in SECTIONS:
        out.append(f"section {fmt_time(bar_t(a))} {keys[name]}  {name} | {sub}")
    from score import MARKS
    out += [""] + [f"mark {fmt_time(v)} {k}" for k, v in MARKS.items()] + [""]
    for L in expand_lines():
        text = []
        prev = -1
        for s in L["syls"]:
            text.append((" " if s["word"] != prev and prev >= 0 else ("-" if prev >= 0 else "")) + s["text"])
            prev = s["word"]
        out.append(f"line {fmt_time(L['t0'])} {fmt_time(L['t1'])} {L['part']}")
        out.append("  latin " + "".join(text))
        out.append("  syl " + " ".join(f"{s['t0']:.3f}" for s in L["syls"]))
        out.append("  sylend " + " ".join(f"{s['t1']:.3f}" for s in L["syls"]))
        out.append("  en " + L["en"])
        out.append("  tech " + L["tech"])
        out.append("")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write("\n".join(out))
    print("wrote", path)


def read_cue(path):
    cue = dict(bpm=None, downbeat=None, sections=[], marks={}, lines=[])
    cur = None
    for raw in open(path):
        line = raw.split("#", 1)[0].rstrip() if not raw.lstrip().startswith("tech") else raw.rstrip("\n")
        if not line.strip():
            continue
        head, _, rest = line.strip().partition(" ")
        if head == "bpm":
            cue["bpm"] = float(rest)
        elif head == "downbeat":
            cue["downbeat"] = parse_time(rest)
        elif head == "section":
            t, key, label = rest.split(None, 2)
            name, _, sub = label.partition("|")
            cue["sections"].append(dict(t0=parse_time(t), key=key, name=name.strip(), sub=sub.strip()))
        elif head == "mark":
            t, name = rest.split()
            cue["marks"][name] = parse_time(t)
        elif head == "line":
            parts = rest.split()
            cur = dict(t0=parse_time(parts[0]), t1=parse_time(parts[1]), part=parts[2] if len(parts) > 2 else "choir",
                       latin="", syl=None, sylend=None, en="", tech="")
            cue["lines"].append(cur)
        elif head in ("latin", "en", "tech") and cur is not None:
            cur[head] = rest.strip()
        elif head in ("syl", "sylend") and cur is not None:
            cur[head] = [parse_time(x) for x in rest.split()]
    cue["sections"].sort(key=lambda s: s["t0"])
    return cue


def syllables(latin):
    out = []
    for w, word in enumerate(latin.split()):
        for s in word.split("-"):
            if s and s != "_":
                out.append(dict(text=s, word=w))
    return out


# ---------------------------------------------------------------- audio analysis

def analyse(path):
    x, sr = sf.read(path, always_2d=True)
    mono = x.mean(1)
    # onset envelopes on a 512-sample hop at 22.05 kHz
    y = signal.resample_poly(mono, 1, 2) if sr == 44100 else mono
    fs = sr // 2 if sr == 44100 else sr
    hop, n = 512, 2048
    f, tt, Z = signal.stft(y, fs, nperseg=n, noverlap=n - hop, boundary=None, padded=False)
    mag = np.log1p(100 * np.abs(Z))
    flux = np.maximum(np.diff(mag, axis=1, prepend=mag[:, :1]), 0)
    band = lambda lo, hi: flux[(f >= lo) & (f < hi)].sum(0)
    env = {"all": flux.sum(0), "low": band(30, 200), "mid": band(200, 2500), "high": band(2500, 11000)}
    for k in env:
        e = env[k] - signal.medfilt(env[k], 31)
        env[k] = np.maximum(e, 0) / (np.percentile(np.maximum(e, 0), 99.5) + 1e-9)
    times = tt
    return dict(mono=mono, sr=sr, env=env, times=times, hop_s=hop / fs)


def track_beats(A, bpm_hint=None, tightness=100.0):
    """Ellis-style dynamic-programming beat tracker on the onset envelope."""
    oe, dt = A["env"]["all"], A["hop_s"]
    ac = np.correlate(oe, oe, "full")[len(oe) - 1:]
    lags = np.arange(len(ac)) * dt
    bpms = 60 / np.maximum(lags, 1e-9)
    ok = (bpms > 50) & (bpms < 200)
    center = bpm_hint or 100.0
    prior = np.exp(-0.5 * (np.log2(bpms / center) / 0.6) ** 2)
    score = np.where(ok, ac * prior, 0)
    period = lags[np.argmax(score)]
    if bpm_hint:  # snap to the hint when the detected period is a simple multiple of it
        hint = 60 / bpm_hint
        for m in (0.5, 1, 2):
            if abs(period / (hint * m) - 1) < 0.06:
                period = hint
    p = int(round(period / dt))
    N = len(oe)
    cum = oe.copy()
    back = np.full(N, -1)
    for i in range(N):
        lo, hi = max(0, i - 2 * p), max(0, i - p // 2)
        if hi <= lo:
            continue
        prev = np.arange(lo, hi)
        pen = -tightness * np.log((i - prev) / p) ** 2
        j = np.argmax(cum[prev] + pen)
        cum[i] = oe[i] + cum[prev[j]] + pen[j]
        back[i] = prev[j]
    i = int(np.argmax(cum[-2 * p:]) + N - 2 * p)
    beats = []
    while i >= 0:
        beats.append(i)
        i = back[i]
    beats = np.array(beats[::-1]) * dt
    return beats, 60 / period


def downbeats_from(beats, A, known=None, meter=4):
    if known is not None:
        k = int(np.argmin(np.abs(beats - known)))
        phase = k % meter
    else:
        low, dt = A["env"]["low"], A["hop_s"]
        strength = [sum(low[min(int(b / dt), len(low) - 1)] for b in beats[ph::meter]) for ph in range(meter)]
        phase = int(np.argmax(strength))
    return beats[phase::meter]


def peaks(env, dt, thresh, min_gap):
    idx, _ = signal.find_peaks(env, height=thresh, distance=max(1, int(min_gap / dt)))
    return [(float(i * dt), float(min(1.0, env[i]))) for i in idx]


def place_syllables(line, A, beats, band="mid"):
    """No syllable times in the cue: align them to the sixteenth-note grid inside the line.

    Dynamic programming picks one grid slot per syllable (in order), rewarding vocal-band onsets and
    penalising drift from an even spread, so a busy mix can't drag the words onto drum hits.
    """
    syl = syllables(line["latin"])
    n = len(syl)
    t0, t1 = line["t0"], line["t1"]
    grid = []
    for i in range(len(beats) - 1):
        for k in range(4):
            g = beats[i] + (beats[i + 1] - beats[i]) * k / 4
            if t0 - 0.06 <= g < t1 - 0.1:
                grid.append(g)
    if len(grid) < n:
        starts = list(np.linspace(t0, t1, n + 1)[:-1])
    else:
        env, dt = A["env"][band], A["hop_s"]
        strength = np.array([env[max(0, int((g - 0.04) / dt)):int((g + 0.04) / dt) + 1].max(initial=0) for g in grid])
        span = max(t1 - t0, 1e-3)
        K = len(grid)
        INF = -1e18
        best = np.full((n, K), INF)
        back = np.zeros((n, K), int)
        best[0, 0] = strength[0]
        for i in range(1, n):
            expect = t0 + span * i / n
            for k in range(i, K - (n - 1 - i)):
                prev = best[i - 1, :k]
                j = int(np.argmax(prev))
                if prev[j] <= INF / 2:
                    continue
                best[i, k] = prev[j] + strength[k] - 3.0 * ((grid[k] - expect) / span) ** 2
                back[i, k] = j
        k = int(np.argmax(best[n - 1]))
        idx = [k]
        for i in range(n - 1, 0, -1):
            k = back[i, k]
            idx.append(k)
        starts = [grid[k] for k in reversed(idx)]
        starts[0] = t0
    ends = starts[1:] + [t1]
    return [dict(s, t0=float(a), t1=float(b)) for s, a, b in zip(syl, starts, ends)]


# ---------------------------------------------------------------- build

# The audio mode (patternNum 0) as the device runs it: every ADC conversion (~30 k/s) lights LED
# (rotationCenter + adc) % 90. Mic: MEMS roll-off (100 Hz high-pass) and bias cap, ADC_GAIN counts at
# full scale, ADC_NOISE counts of noise. Per frame, the share of the eye's ~50 ms that each offset from
# the centre is lit, as perceived brightness duty^0.3, 90 bytes base64 (offset 0 = the centre).
ADC_GAIN, ADC_NOISE, EYE = 45.0, 0.6, 0.05


def adc_duty(mono, sr, frames):
    import base64
    x = signal.sosfilt(signal.butter(2, 100, "high", fs=sr, output="sos"), mono)
    k = np.round(ADC_GAIN * x + np.random.default_rng(90).normal(0, ADC_NOISE, len(x))).astype(np.int64) % 90
    win, out = int(EYE * sr), []
    for fi in range(frames):
        b = int(fi / FPS * sr)
        d = np.bincount(k[max(0, b - win):max(1, b)], minlength=90)[:90].astype(float)
        d /= max(1.0, d.sum())
        out.append(base64.b64encode(np.round(255 * d ** 0.3).astype(np.uint8).tobytes()).decode())
    return out


def build(args):
    cue = read_cue(args.cue)
    A = analyse(args.audio)
    V = analyse(args.vocals) if args.vocals else A     # a vocal stem (Suno: "Get Stems") aligns words far better
    duration = len(A["mono"]) / A["sr"]
    dur_cue = cue["marks"].get("end")
    if dur_cue:
        duration = min(duration, dur_cue)

    if args.score:
        from score import BAR, BEAT, DURATION, ostinato_events, sparkle_events, taiko_hits, halo_scan, boot_events, CHORDS, t as bar_t
        duration = DURATION
        beats = np.arange(0, DURATION + 1e-6, BEAT)
        downbeats = np.arange(0, DURATION + 1e-6, BAR)
        bpm = 60 / BEAT
        bells, scan = [], halo_scan()
        for bar in range(14, 22):
            for e in range(8):
                bells.append(dict(t=bar_t(bar, e * 0.5), led=next(scan)))
        events = dict(ostinato=[dict(t=e["t"], led=e["led"]) for e in ostinato_events()],
                      sparkle=[dict(t=e["t"], led=e["led"]) for e in sparkle_events()],
                      bells=bells, hits=[dict(t=h, v=v) for h, v in taiko_hits()])
    else:
        beats, bpm = track_beats(A, cue["bpm"])
        downbeats = downbeats_from(beats, A, cue["downbeat"])
        dt = A["hop_s"]
        hits = peaks(A["env"]["low"], dt, 0.35, 0.18)
        highs = peaks(A["env"]["high"], dt, 0.3, 0.09)
        mids = peaks(A["env"]["mid"], dt, 0.25, 0.08)
        sec_at = lambda tt: next((s["key"] for s in reversed(cue["sections"]) if s["t0"] <= tt), "prologue")
        rng = random.Random(90)
        led, ost, spk, bel = 0, [], [], []
        for tt, v in sorted(mids + highs):
            k = sec_at(tt)
            if k in ("dynamic", "open"):
                ost.append(dict(t=tt, led=led)); led = (led + 13) % 90
            elif k == "halo":
                bel.append(dict(t=tt, led=led)); led = (led + 13) % 90
            elif k == "sparkle" and rng.randrange(3) == 0:
                spk.append(dict(t=tt, led=rng.randrange(90)))
        events = dict(ostinato=ost, sparkle=spk, bells=bel, hits=[dict(t=a, v=v) for a, v in hits])

    lines = []
    for L in cue["lines"]:
        if L["syl"]:
            syl = syllables(L["latin"])
            ends = L["sylend"] or (L["syl"][1:] + [L["t1"]])
            syl = [dict(s, t0=a, t1=b) for s, a, b in zip(syl, L["syl"], ends)]
        else:
            syl = place_syllables(L, V, beats, band='mid')
        latin = " ".join(w.replace("-", "") for w in L["latin"].replace(" _", "").split())
        lines.append(dict(latin=latin, en=L["en"], tech=L["tech"], part=L["part"], t0=L["t0"], t1=L["t1"], syls=syl))

    secs = cue["sections"]
    sections = [dict(key=s["key"], name=s["name"], sub=s["sub"], t0=s["t0"],
                     t1=secs[i + 1]["t0"] if i + 1 < len(secs) else duration) for i, s in enumerate(secs)]
    marks = dict(cue["marks"])
    press = marks.get("press", 0.5)
    events["boot"] = [dict(t=press + 0.1 + i / 90.0, led=i) for i in range(90)]
    if "wake" in marks:
        events["boot2"] = [dict(t=marks["wake"] + 0.1 + i / 90.0, led=i) for i in range(90)]
    events["clicks"] = sorted(v for k, v in marks.items() if k in ("press", "release", "hold", "halt", "lid", "wake"))


    # per-frame audio features for audio-reactive visuals
    mono, sr = A["mono"], A["sr"]
    hop = sr // FPS
    frames = int(duration * FPS)
    lo = signal.sosfilt(signal.butter(2, 200, "low", fs=sr, output="sos"), mono)
    hi = signal.sosfilt(signal.butter(2, 3000, "high", fs=sr, output="sos"), mono)
    rms, bands, wave = [], [], []
    for fi in range(frames):
        seg = mono[fi * hop:(fi + 1) * hop]
        if len(seg) < hop:
            seg = np.pad(seg, (0, hop - len(seg)))
        rms.append(float(np.sqrt((seg ** 2).mean())))
        bands.append([float(np.sqrt((lo[fi * hop:(fi + 1) * hop] ** 2).mean() + 1e-12)),
                      float(np.sqrt((hi[fi * hop:(fi + 1) * hop] ** 2).mean() + 1e-12))])
        wave.append([round(float(v), 3) for v in seg[:hop - hop % 90].reshape(90, -1).mean(1)])
    adc = adc_duty(mono, sr, frames)
    mx = max(rms) or 1
    tl = dict(fps=FPS, duration=duration, audio=os.path.relpath(args.audio, ROOT), bpm=float(bpm),
              beats=[round(float(b), 4) for b in beats if b <= duration],
              downbeats=[round(float(b), 4) for b in downbeats if b <= duration],
              sections=sections, marks=marks, lines=lines, events=events,
              rms=[round(r / mx, 4) for r in rms], bands=[[round(a / mx, 4), round(b / mx, 4)] for a, b in bands], wave=wave,
              adcGain=ADC_GAIN, adcNoise=ADC_NOISE, adc=adc)
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    out = args.out or os.path.join(ROOT, "build", "timeline.json")
    json.dump(tl, open(out, "w"))
    print(f"wrote {out}: {duration:.1f}s  bpm {bpm:.1f}  bars {len(tl['downbeats'])}  lines {len(lines)}  "
          f"hits {len(events['hits'])}  ostinato {len(events['ostinato'])}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cue")
    ap.add_argument("--audio")
    ap.add_argument("--score", action="store_true", help="exact timing/events from src/score.py")
    ap.add_argument("--vocals", help="optional isolated vocal stem for syllable alignment")
    ap.add_argument("--write-cue")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.write_cue:
        write_cue(a.write_cue)
    if a.cue and a.audio:
        build(a)
