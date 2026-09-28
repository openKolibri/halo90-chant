"""MISSA NONAGINTA — score and timeline for the HALO-90 music video.

Everything downstream (voice synth, instruments, video) reads its timing from here.
80 BPM, 4/4, one bar = 3.0 s.
"""
import random

BPM = 80
BEAT = 60.0 / BPM
BAR = 4 * BEAT
TOTAL_BARS = 59
DURATION = TOTAL_BARS * BAR


def t(bar, beat=0.0):
    return (bar * 4 + beat) * BEAT


SECTIONS = [
    # name, first bar, end bar (exclusive), subtitle
    ("PROLOGVS", 0, 2, "hold"),
    ("I · INTROITVS", 2, 10, "boot"),
    ("II · HALO", 10, 22, "patternNum = 1"),
    ("III · DYNAMICA", 22, 34, "patternNum = 0"),
    ("IV · SCINTILLA", 34, 42, "patternNum = 2"),
    ("V · APERTVM", 42, 52, "CERN-OHL-S · GPL-3.0 · CC BY-SA 4.0"),
    ("VI · DORMITIO", 52, 56, "HALT"),
    ("FINIS", 56, 59, ""),
]

# Chord per bar: (root midi, quality). Used by strings, bass, ostinato, bells, pads.
CHORDS = {}
def _chords(start, names):
    q = {"m": [0, 3, 7], "M": [0, 4, 7], "s4": [0, 5, 7], "5": [0, 7]}
    roots = {"D": 38, "E": 40, "F": 41, "G": 43, "A": 45, "Bb": 46, "C": 48}
    for i, n in enumerate(names):
        root, qual = n.split(":")
        CHORDS[start + i] = (roots[root], q[qual], n)

_chords(0, ["D:5"] * 10)                                              # prologue + introit drone
_chords(10, ["D:m", "Bb:M", "F:M", "C:M", "D:m", "E:m", "F:M", "A:m",  # HALO
             "D:m", "Bb:M", "F:M", "A:s4"])
_chords(22, ["D:m", "D:m", "Bb:M", "C:M", "D:m", "D:m", "Bb:M", "C:M",  # DYNAMICA
             "G:m", "Bb:M", "A:M", "A:M"])
_chords(34, ["F:M", "C:M", "D:m", "Bb:M", "F:M", "C:M", "D:m", "A:s4"])  # SCINTILLA
_chords(42, ["D:m", "Bb:M", "F:M", "C:M", "G:m", "A:M", "Bb:M", "C:M",  # APERTVM
             "D:M", "D:M"])
_chords(52, ["D:5", "D:5", "G:M", "D:M", "D:M", "D:M", "D:M"])           # DORMITIO + FINIS

# Italian-orthography spellings so an Italian TTS voice yields ecclesiastical Latin.
TTS = {"lux": "lucs", "ex": "ecs", "mae": "me", "ho": "o", "In": "in", "U": "u",
       "No": "no", "Tre": "tre", "Can": "can", "De": "de", "Mi": "mi", "Oc": "oc",
       "Quin": "quin", "Cen": "cen", "Li": "li", "Mu": "mu", "Te": "te", "A": "a",
       "Ex": "ecs", "om": "om", "Au": "au", "au": "au"}

R = None  # rest

# Each line: bar, part, text (words split by spaces, syllables by '-', '_' = rest),
# notes (one list of (midi, beats) per syllable/rest), tech subtitle.
LINES = [
    dict(bar=2, part="cantor", text="In te-ne-bris lux u-na",
         notes=[[(50, 1)], [(52, 1)], [(53, 1)], [(55, 1), (53, .5)], [(57, 2)],
                [(55, .5), (53, .5), (55, 1)], [(52, 1), (50, 3)]],
         en="in darkness, one light", tech="// hold the button — one LED wakes"),
    dict(bar=6, part="cantor2", text="cir-cu-mit et cir-cu-lum fa-cit",
         notes=[[(57, 1)], [(57, 1)], [(60, 1), (59, .5), (57, .5)], [(55, 1)],
                [(57, .5), (55, .5)], [(53, 1)], [(55, 1), (53, .5), (52, .5)], [(53, 1)],
                [(52, 1), (50, 3)]],
         en="it goes around, and makes a circle", tech="// boot animation: one full revolution, ~1 s"),

    dict(bar=10, part="choir", text="No-na-gin-ta lu-mi-na",
         notes=[[(57, 1)], [(57, 1)], [(60, 1.5)], [(59, .5)], [(57, 1)], [(55, 1)], [(57, 2)]],
         en="ninety lights", tech="// 90 × red LED · 0402 · 630 nm"),
    dict(bar=12, part="choir", text="qua-ter-nis gra-di-bus",
         notes=[[(57, 1)], [(55, 1)], [(53, 2)], [(55, 1)], [(53, .5), (52, .5)], [(50, 2)]],
         en="four degrees apart", tech="// placed at 4° intervals, cathodes facing the center"),
    dict(bar=14, part="choir", text="Tre-de-cim tre-de-cim et i-te-rum tre-de-cim",
         notes=[[(50, 1)], [(53, 1)], [(57, 2)], [(52, 1)], [(55, 1)], [(59, 2)],
                [(57, 1)], [(60, 1)], [(59, 1)], [(57, 1)], [(57, 1)], [(60, 1)], [(62, 2)]],
         en="thirteen, thirteen, and again thirteen", tech="setLed((prevLed + 13) % 90);"),
    dict(bar=18, part="organum", text="U-na so-la ar-det om-nes lu-cent",
         notes=[[(57, 1.5)], [(62, .5)], [(60, 1)], [(57, 1)], [(58, 2)], [(57, 1), (55, 1)],
                [(53, 1)], [(55, 1)], [(57, 2)], [(55, 2), (57, 2)]],
         en="one alone burns — all of them shine",
         tech="// charlieplexed: only one LED is ever on. your eye does the rest."),

    dict(bar=22, part="chant", text="Au-dit te _ au-dit te _",
         notes=[[(50, .5)], [(50, .5)], [(53, 1)], [(R, 2)], [(52, .5)], [(52, .5)], [(57, 2)], [(R, 1)]],
         en="it hears you", tech="// MEMS microphone → 12-bit ADC"),
    dict(bar=24, part="chant", text="Can-ta _ et re-spon-de-bit _",
         notes=[[(58, 1)], [(57, 1)], [(R, 1)], [(55, 1)], [(55, .5)], [(57, .5)], [(60, 1)], [(57, 1)], [(R, 1)]],
         en="sing, and it will answer", tech="// audio mode — the default at boot"),
    dict(bar=26, part="chant", text="De-cem fi-la _ no-na-gin-ta flam-mae",
         notes=[[(57, .5)], [(57, .5)], [(60, .5)], [(57, 1.5)], [(R, 1)],
                [(53, .5)], [(55, .5)], [(57, .5)], [(60, .5)], [(62, 1)], [(57, 1)]],
         en="ten threads, ninety flames", tech="// 10 GPIO lines · 90 LEDs · 0 resistors"),
    dict(bar=28, part="chant", text="Mi-li-es in _ se-cun-do _",
         notes=[[(58, .5)], [(57, .5)], [(55, 1)], [(53, 1)], [(R, 1)], [(55, .5)], [(57, .5)], [(55, 2)], [(R, 1)]],
         en="a thousand times each second", tech="// charlieplex scan > 1 kHz"),
    dict(bar=30, part="chant", text="Oc-to bi-to-rum cor",
         notes=[[(55, 1)], [(58, 1)], [(57, .5)], [(55, .5)], [(53, 1)], [(53, 2), (50, 2)]],
         en="a heart of eight bits", tech="// STM8L151 · 8-bit · 16 MHz"),
    dict(bar=32, part="organum", text="U-na so-la ar-det",
         notes=[[(57, .5)], [(57, .5)], [(61, 1)], [(57, 1), (R, 1)], [(61, 1)], [(57, 3)]],
         en="one alone burns", tech="// only one is ever on"),

    dict(bar=34, part="cantor", text="Quin-de-cim sor-tes u-na lux",
         notes=[[(57, 1)], [(60, .5)], [(57, 1.5)], [(55, 1)], [(55, 1)], [(53, .5)], [(52, .5)], [(53, 2)]],
         en="fifteen lots, one light", tech="rand() % 15 ? ledLow(prevLed) : setLed(rand() % 90);"),
    dict(bar=36, part="cantor", text="ex num-mo par-vo vi-vit",
         notes=[[(57, .5)], [(57, .5)], [(62, 1.5)], [(60, .5)], [(57, 1)], [(58, 1)], [(57, 1), (55, 2)]],
         en="it lives on a small coin", tech="// powered by one CR2032 coin cell"),
    dict(bar=38, part="cantor2", text="cen-tum et no-vem ho-ras",
         notes=[[(60, 1)], [(60, .5)], [(57, .5)], [(55, 1)], [(57, 1)], [(55, 1)], [(53, 1), (52, 2)]],
         en="for a hundred and nine hours", tech="// sparkle mode: 2.01 mA · ~109 hours"),

    dict(bar=42, part="organum", text="Li-ber et a-per-tus",
         notes=[[(62, 1.5)], [(60, .5)], [(57, 1)], [(57, 1)], [(58, 1)], [(57, 1), (55, 2)]],
         en="free and open", tech="// hardware CERN-OHL-S 2.0 · firmware GPL-3.0 · docs CC BY-SA 4.0"),
    dict(bar=44, part="organum", text="om-ni-bus da-tus est",
         notes=[[(57, 1)], [(60, 1)], [(57, 2)], [(55, 1)], [(57, 1)], [(55, 2)]],
         en="it is given to all", tech="// every file, in easy-to-remix formats"),
    dict(bar=46, part="organum", text="Mu-ta fran-ge re-scri-be",
         notes=[[(58, 1)], [(55, 1)], [(57, 1)], [(53, 1)], [(57, .5)], [(61, 1.5)], [(57, 2)]],
         en="change it, break it, rewrite it", tech="// modify · hack · remix · program your own light"),
    dict(bar=48, part="organum", text="U-na so-la ar-det om-nes lu-cent",
         notes=[[(58, 1.5)], [(62, .5)], [(60, 1)], [(58, 1)], [(60, 2)], [(64, 1), (62, 1)],
                [(62, 1)], [(64, 1)], [(66, 2)], [(62, 4)]],
         en="one alone burns — all of them shine", tech="// ninety lights. one at a time."),

    dict(bar=52, part="cantor", text="Te-ne et dor-mi-et",
         notes=[[(57, 1)], [(55, 1)], [(53, 2)], [(55, 1)], [(53, 1)], [(50, 2)]],
         en="hold, and it will sleep", tech="// hold 500 ms → HALT · 15 µA"),
    dict(bar=54, part="amen", text="A-men",
         notes=[[(59, 4)], [(57, 6)]],
         en="amen", tech="$ make flash"),
]


# Named moments (seconds). The case scene: the spare cell is set in, the hero is laid on it, held for
# 500 ms to HALT, and the lid closes on the downbeat of "Amen".
MARKS = {
    "press": 0.50, "release": 1.68,
    "carry": 156.80,      # the hero leaves the ear
    "cell": 157.40,       # the spare cell is let go above the right pocket
    "place": 159.00,      # the hero is let go above its cell
    "hold": 159.95, "halt": 160.45,
    "lid": 162.00,        # the lid seats (magnets)
    "wake": 175.30,
}
# how long after being let go each piece lands in the case (the film animates the same falls)
CASE_LAND = {"cell": 0.12, "place": 0.10}


def expand_lines():
    """Resolve each line into syllables with absolute times."""
    out = []
    for li, L in enumerate(LINES):
        tokens = []
        for w, word in enumerate(L["text"].split(" ")):
            parts = word.split("-")
            for k, s in enumerate(parts):
                tokens.append(dict(text=s, word=w, first=k == 0, last=k == len(parts) - 1))
        assert len(tokens) == len(L["notes"]), (L["text"], len(tokens), len(L["notes"]))
        beat = L["bar"] * 4.0
        syls = []
        for tok, notes in zip(tokens, L["notes"]):
            dur = sum(d for _, d in notes)
            if tok["text"] != "_":
                ns, b = [], beat
                for m, d in notes:
                    ns.append(dict(midi=m, t0=b * BEAT, t1=(b + d) * BEAT))
                    b += d
                ns = [n for n in ns if n["midi"] is not None]
                syls.append(dict(tok, tts=TTS.get(tok["text"], tok["text"].lower()),
                                 t0=beat * BEAT, t1=ns[-1]["t1"], notes=ns))
            beat += dur
        latin = " ".join(L["text"].replace("-", "").replace(" _", "").replace("_", "").split())
        out.append(dict(idx=li, part=L["part"], latin=latin, en=L["en"], tech=L["tech"],
                        t0=syls[0]["t0"], t1=syls[-1]["t1"], syls=syls))
    return out


# ---- Firmware-derived event streams -------------------------------------------------

def halo_scan(start_led=0):
    """The Halo pattern: setLed((prevLed + 13) % 90)."""
    led = start_led
    while True:
        yield led
        led = (led + 13) % 90


def ostinato_events():
    """16th-note ostinato for DYNAMICA/APERTVM: each note is the next Halo-scan LED."""
    ev, scan = [], halo_scan()
    for bar in list(range(22, 34)) + list(range(42, 50)):
        root, ivs, _ = CHORDS[bar]
        tones = [root + 12 + i for i in ivs] + [root + 24]
        while len(tones) < 4:
            tones.append(root + 24 + ivs[1])
        for s in range(16):
            led = next(scan)
            midi = tones[led % 4] + (12 if (led // 4) % 2 else 0)
            ev.append(dict(t=t(bar, s * 0.25), led=led, midi=midi, bar=bar))
    return ev


def sparkle_events():
    """SCINTILLA: on a 32nd-note clock, rand() % 15 == 0 lights rand() % 90."""
    rng = random.Random(90)
    ev = []
    pent = [0, 2, 4, 7, 9]
    for bar in range(34, 42):
        root, ivs, _ = CHORDS[bar]
        for s in range(32):
            if rng.randrange(15) == 0:
                led = rng.randrange(90)
                deg = pent[led % 5] + 12 * (led % 3)
                ev.append(dict(t=t(bar, s * 0.125), led=led, midi=root + 36 + ivs[0] + deg, bar=bar))
    return ev


def boot_events():
    """Button hold: boot animation lights LEDs around once in ~1 s (setLed(debounce/200))."""
    return [dict(t=0.6 + i / 90.0, led=i) for i in range(90)]


def taiko_hits():
    hits = [(t(2), 1.0), (t(6), 0.8)]
    for bar in range(10, 22):
        hits.append((t(bar), 0.9 if bar % 2 == 0 else 0.7))
        if bar >= 14:
            hits.append((t(bar, 2.5), 0.45))
    for bar in (20, 21):
        for b in range(8):
            hits.append((t(bar, b * 0.5), 0.35 + 0.08 * b))
    for bar in list(range(22, 34)) + list(range(42, 50)):
        hits += [(t(bar, 0), 1.0), (t(bar, 1.5), 0.6), (t(bar, 2.0), 0.8), (t(bar, 3.5), 0.5)]
    hits += [(t(50), 1.0), (t(51), 0.8)]
    return sorted(hits)


if __name__ == "__main__":
    for L in expand_lines():
        print(f"{L['t0']:7.2f}-{L['t1']:7.2f} {L['part']:8s} {L['latin']}")
    print("duration", DURATION, "ostinato", len(ostinato_events()), "sparkle", len(sparkle_events()))
