"""Find jumps: frame-to-frame change spikes that are not explained by the music.

Decodes the video small and grey, measures mean absolute change between consecutive frames, and flags
frames whose change is far above the local median. Each flag is printed with the nearest cue event, so an
intended flash (a taiko hit, the boot sweep) can be told apart from an accidental camera or scene pop.

  python src/qa_continuity.py out/HALO-90_NONAGINTA.mp4 [build/timeline.json] [--offset=seconds]
"""
import json, subprocess, sys
import numpy as np

args = [a for a in sys.argv[1:] if not a.startswith("--offset=")]
offset = next((float(a.split("=")[1]) for a in sys.argv[1:] if a.startswith("--offset=")), 0.0)
path = args[0]
tl = json.load(open(args[1] if len(args) > 1 else "build/timeline.json"))
w, h = 192, 108
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
                     capture_output=True, check=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
fps = tl["fps"]
med = np.array([np.median(d[max(0, i - 15):i + 16]) for i in range(len(d))])
score = d / (med + 0.6)
events = [(e["t"], "hit") for e in tl["events"]["hits"]] + [(t, "click") for t in tl["events"]["clicks"]] + \
         [(s["t0"], "section " + s["key"]) for s in tl["sections"]] + [(v, "mark " + k) for k, v in tl["marks"].items()] + \
         [(b, "beat") for b in tl["beats"]]
events.sort()
flags = [i for i in range(len(d)) if score[i] > 4 and d[i] > 2.0]
print(f"{len(fr)} frames, median change {np.median(d):.2f}, max {d.max():.2f}; {len(flags)} spikes")
for i in flags:
    t = (i + 1) / fps + offset
    near = min(events, key=lambda e: abs(e[0] - t))
    tag = f"{near[1]} @ {near[0]:.2f}" if abs(near[0] - t) < 0.15 else "UNEXPLAINED"
    print(f"  t={t:7.2f}s  change {d[i]:5.1f} ({score[i]:4.1f}x local)  -> {tag}")
