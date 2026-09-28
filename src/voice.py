"""Speech-to-chant: macOS Italian TTS syllables -> WORLD vocoder -> sung, pitched, legato lines.

Each syllable is spoken in isolation, analysed with WORLD (f0 / spectral envelope /
aperiodicity), split into onset consonant, vowel nucleus and coda, then re-timed so the
vowel lands on the beat and is stretched to the note length. A whole line is assembled
at the parameter level and synthesised once with a new F0 contour, so syllables join
legato the way a schola sings.
"""
import hashlib, os, subprocess
import numpy as np
import pyworld as pw
import soundfile as sf

SR = 44100
FP = 5.0  # WORLD frame period, ms
FRAME = FP / 1000.0
CACHE = os.path.join(os.path.dirname(__file__), "..", "build", "syl")
os.makedirs(CACHE, exist_ok=True)

MONKS = {
    "eddy": "Eddy (Italian (Italy))",
    "grandpa": "Grandpa (Italian (Italy))",
    "reed": "Reed (Italian (Italy))",
    "rocko": "Rocko (Italian (Italy))",
}

_mem = {}


def _analyse(text, monk):
    key = (text, monk)
    if key in _mem:
        return _mem[key]
    h = hashlib.md5(f"{text}|{monk}".encode()).hexdigest()[:12]
    npz = os.path.join(CACHE, f"{monk}_{h}.npz")
    if os.path.exists(npz):
        d = dict(np.load(npz))
    else:
        wav = os.path.join(CACHE, f"{monk}_{h}.wav")
        subprocess.run(["say", "-v", MONKS[monk], "-r", "120", "-o", wav, "--file-format=WAVE",
                        "--data-format=LEI16@44100", text], check=True)
        x, _ = sf.read(wav)
        x = np.ascontiguousarray(x, dtype=np.float64)
        f0, tt = pw.harvest(x, SR, frame_period=FP, f0_floor=60, f0_ceil=400)
        sp = pw.cheaptrick(x, f0, tt, SR)
        ap = pw.d4c(x, f0, tt, SR)
        d = dict(f0=f0, sp=sp, ap=ap)
        np.savez_compressed(npz, **d)
    f0, sp, ap = d["f0"], d["sp"], d["ap"]
    e = 10 * np.log10(sp.sum(axis=1) + 1e-20)
    live = np.where(e > e.max() - 40)[0]
    s, eidx = live[0], live[-1] + 1
    f0, sp, ap, e = f0[s:eidx], sp[s:eidx], ap[s:eidx], e[s:eidx]
    strong = (f0 > 0) & (e > e.max() - 14)
    if strong.any():
        # largest contiguous strong-voiced run = the vowel nucleus
        idx = np.where(strong)[0]
        runs = np.split(idx, np.where(np.diff(idx) > 2)[0] + 1)
        run = max(runs, key=len)
        n0, n1 = run[0], run[-1] + 1
    else:
        n0, n1 = 0, len(f0)
    res = dict(f0=f0, sp=sp, ap=ap, n0=n0, n1=n1)
    _mem[key] = res
    return res


def _resample_frames(arr, n):
    """Linear time-resample a (frames, bins) or (frames,) array to n frames."""
    m = len(arr)
    if n <= 0:
        return arr[:0]
    if m == 1:
        return np.repeat(arr, n, axis=0)
    pos = np.linspace(0, m - 1, n)
    i0 = np.floor(pos).astype(int)
    i1 = np.minimum(i0 + 1, m - 1)
    fr = (pos - i0)
    if arr.ndim == 2:
        fr = fr[:, None]
    return arr[i0] * (1 - fr) + arr[i1] * fr


def _stretch_nucleus(sp, ap, vf, n):
    """Keep ~40 ms transitions at each end, stretch the steady middle."""
    m = len(sp)
    edge = min(8, m // 3)
    if n <= 2 * edge or m < 3:
        return _resample_frames(sp, n), _resample_frames(ap, n), _resample_frames(vf, n)
    mid = n - 2 * edge
    parts = [(sp[:edge], ap[:edge], vf[:edge]),
             (_resample_frames(sp[edge:m - edge], mid), _resample_frames(ap[edge:m - edge], mid),
              _resample_frames(vf[edge:m - edge], mid)),
             (sp[m - edge:], ap[m - edge:], vf[m - edge:])]
    return (np.concatenate([p[0] for p in parts]), np.concatenate([p[1] for p in parts]),
            np.concatenate([p[2] for p in parts]))


def _formant_warp(sp, alpha):
    if abs(alpha - 1) < 1e-3:
        return sp
    bins = sp.shape[1]
    src = np.arange(bins) / alpha
    src = np.clip(src, 0, bins - 1)
    i0 = np.floor(src).astype(int)
    i1 = np.minimum(i0 + 1, bins - 1)
    fr = src - i0
    return sp[:, i0] * (1 - fr) + sp[:, i1] * fr


def sing_line(syls, monk="eddy", transpose=0.0, alpha=1.0, detune_cents=0.0,
              vib_rate=5.2, vib_depth=0.18, seed=0, breath=0.5):
    """Render one line. Returns (start_time_seconds, mono float32 audio)."""
    rng = np.random.default_rng(seed)
    A = [_analyse(s["tts"], monk) for s in syls]
    onset = [min(a["n0"], 28) for a in A]            # frames
    coda = [min(len(a["f0"]) - a["n1"], 22) for a in A]
    t_start = syls[0]["t0"] - onset[0] * FRAME - 0.08
    t_end = syls[-1]["t1"] + 0.35
    N = int(np.ceil((t_end - t_start) / FRAME))
    bins = A[0]["sp"].shape[1]
    sp_out = np.full((N, bins), 1e-16)
    ap_out = np.ones((N, bins))
    voiced = np.zeros(N)        # 1 = sing at contour pitch
    pitch = np.full(N, np.nan)  # semitone target per frame

    def fr(tsec):
        return int(round((tsec - t_start) / FRAME))

    for i, (s, a) in enumerate(zip(syls, A)):
        src_v = (a["f0"] > 0).astype(float)
        on_n = onset[i]
        v0 = fr(s["t0"])
        nxt = syls[i + 1] if i + 1 < len(syls) else None
        legato = nxt is not None and nxt["t0"] - s["t1"] < 0.05
        if legato:
            v1 = fr(nxt["t0"]) - onset[i + 1] - coda[i]
        else:
            v1 = fr(s["t1"]) - coda[i]
        v1 = max(v1, v0 + 10)
        # onset consonant (natural speed, before the beat)
        o_sp = a["sp"][a["n0"] - on_n:a["n0"]]
        o_ap = a["ap"][a["n0"] - on_n:a["n0"]]
        o_v = src_v[a["n0"] - on_n:a["n0"]]
        nsp, nap, nv = _stretch_nucleus(a["sp"][a["n0"]:a["n1"]], a["ap"][a["n0"]:a["n1"]],
                                        np.ones(a["n1"] - a["n0"]), v1 - v0)
        nap = np.minimum(nap, 0.15 + 0.85 * nap * np.linspace(0, 1, bins)[None, :])
        c_sp = a["sp"][a["n1"]:a["n1"] + coda[i]]
        c_ap = a["ap"][a["n1"]:a["n1"] + coda[i]]
        c_v = src_v[a["n1"]:a["n1"] + coda[i]]
        seg_sp = np.concatenate([o_sp, nsp, c_sp])
        seg_ap = np.concatenate([o_ap, nap, c_ap])
        seg_v = np.concatenate([o_v, nv, c_v])
        f_a = v0 - on_n
        f_b = min(f_a + len(seg_sp), N)
        if f_a < 0:
            seg_sp, seg_ap, seg_v, f_a = seg_sp[-f_a:], seg_ap[-f_a:], seg_v[-f_a:], 0
        n = f_b - f_a
        sp_out[f_a:f_b] = seg_sp[:n]
        ap_out[f_a:f_b] = seg_ap[:n]
        voiced[f_a:f_b] = seg_v[:n]
        # pitch targets for this syllable's notes; consonants borrow the first note
        pitch[f_a:v0] = s["notes"][0]["midi"]
        for nt in s["notes"]:
            pitch[max(fr(nt["t0"]), 0):min(fr(nt["t1"]), N)] = nt["midi"]
        pitch[fr(s["notes"][-1]["t1"]):f_b] = s["notes"][-1]["midi"]

    # fill gaps, glide between notes (portamento), add vibrato + drift
    idx = np.arange(N)
    ok = ~np.isnan(pitch)
    pitch = np.interp(idx, idx[ok], pitch[ok])
    k = np.hanning(15)
    k /= k.sum()
    pitch = np.convolve(np.pad(pitch, 7, mode="edge"), k, mode="valid")
    change = np.abs(np.diff(pitch, prepend=pitch[0])) > 0.02
    since = np.zeros(N)
    c = 0.0
    for j in range(N):
        c = 0.0 if change[j] else c + FRAME
        since[j] = c
    depth = vib_depth * np.clip((since - 0.25) / 0.45, 0, 1)
    tt = idx * FRAME
    rate = vib_rate * (1 + 0.04 * np.sin(2 * np.pi * 0.21 * tt + rng.uniform(0, 6)))
    vib = depth * np.sin(2 * np.pi * np.cumsum(rate) * FRAME + rng.uniform(0, 6))
    drift = np.convolve(rng.standard_normal(N + 80), np.hanning(80) / np.hanning(80).sum(), "valid")[:N]
    drift = drift / (np.abs(drift).max() + 1e-9) * 0.06
    semis = pitch + transpose + detune_cents / 100.0 + vib + drift
    f0 = 440.0 * 2 ** ((semis - 69) / 12)
    f0 = np.where(voiced > 0.5, f0, 0.0)

    # smooth the spectral envelope over time so syllable joins blend
    lsp = np.log(sp_out)
    kk = np.array([0.25, 0.5, 0.25])
    lsp = np.apply_along_axis(lambda col: np.convolve(np.pad(col, 1, mode="edge"), kk, "valid"), 0, lsp)
    sp = _formant_warp(np.exp(lsp), alpha)
    y = pw.synthesize(np.ascontiguousarray(f0), np.ascontiguousarray(sp),
                      np.ascontiguousarray(np.clip(ap_out, 0, 1)), SR, FP)
    # breath noise on unvoiced consonants is already in WORLD; add air on the vowels
    y = y.astype(np.float32)
    return t_start, y


def sustain(vowel_tts, midi, t0, t1, monk="eddy", alpha=1.0, detune_cents=0.0, seed=0, vib_depth=0.12):
    """A held vowel (pad choir), e.g. 'o' or 'a', from t0 to t1 at midi."""
    syl = dict(tts=vowel_tts, t0=t0, t1=t1, notes=[dict(midi=midi, t0=t0, t1=t1)])
    return sing_line([syl], monk=monk, alpha=alpha, detune_cents=detune_cents, seed=seed,
                     vib_depth=vib_depth)
