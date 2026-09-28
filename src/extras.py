"""Write the subtitle track and the lyric sheet from the score."""
import os, sys

sys.path.insert(0, os.path.dirname(__file__))
from score import SECTIONS, expand_lines, t

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "out")
os.makedirs(OUT, exist_ok=True)


def ts(x):
    ms = int(round(x * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


lines = expand_lines()
with open(os.path.join(OUT, "HALO-90_NONAGINTA.srt"), "w") as f:
    for i, L in enumerate(lines, 1):
        end = min(L["t1"] + 0.8, lines[i]["t0"] - 0.35) if i < len(lines) else L["t1"] + 1.5
        f.write(f"{i}\n{ts(max(0, L['t0'] - 0.3))} --> {ts(end)}\n{L['latin'].upper()}\n{L['en']}\n\n")

md = ["# NONAGINTA — a canticle for ninety lights", "",
      "*A chant for the HALO-90 open-hardware earring, in six parts. "
      "The Latin is sung; the \"translation\" is the technical manual.*", ""]
by_section = {}
for L in lines:
    sec = next(s for s in SECTIONS if t(s[1]) <= L["t0"] < t(s[2]))
    by_section.setdefault(sec, []).append(L)
for sec in SECTIONS:
    name, a, b, sub = sec
    if sec not in by_section:
        continue
    md += [f"## {name}", f"`{sub}` · {int(t(a)) // 60}:{int(t(a)) % 60:02d}", ""]
    md += ["| sung | meaning | what it means on the board |", "|---|---|---|"]
    for L in by_section[sec]:
        md.append(f"| **{L['latin']}** | {L['en']} | `{L['tech']}` |")
    md.append("")
with open(os.path.join(OUT, "LYRICS.md"), "w") as f:
    f.write("\n".join(md))
print("wrote", len(lines), "lines")
