"""Tile review stills into one image: python src/contact_sheet.py out.jpg a.jpg b.jpg ... [--cols 3]"""
import os, sys
from PIL import Image, ImageDraw

args = sys.argv[1:]
cols = 3
if "--cols" in args:
    i = args.index("--cols"); cols = int(args[i + 1]); del args[i:i + 2]
out, files = args[0], args[1:]
w, h = 640, 360
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((w - 4, h - 4))
    x, y = (i % cols) * w, (i // cols) * h
    sheet.paste(im, (x + 2, y + 2))
    d.text((x + 8, y + 6), os.path.basename(f), fill=(0, 255, 0))
sheet.save(out, quality=88)
