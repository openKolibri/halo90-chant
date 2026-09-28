"""Figures for the docs, from the rendered film and the board data.

    .venv/bin/python src/doc_figures.py out/HALO-90_NONAGINTA_1080p.mp4

Writes docs/img/: key frames, a contact sheet of the whole film, strips of the refrain's scan ramp and of
the audio mode, a GIF of the ramp, the LED-order figure, and the real-device photos (resized, from the
HALO-90 repo in vendor/halo-90/docs, CC BY-SA 4.0).
"""
import io, json, math, os, subprocess, sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "docs", "img")

# (file, time s): one or more per section, in film order
FRAMES = [
    ("00_prologue", 3.0), ("01_introit_one", 12.0), ("02_introit_circle", 22.0),
    ("03_halo_4deg", 40.0), ("04_halo_13", 47.0), ("05_halo_single", 57.2), ("06_halo_ramp", 63.6),
    ("07_halo_6k3", 65.6), ("08_dynamica_audio", 73.0), ("09_dynamica_cpx", 80.0), ("10_dynamica_u1", 93.0),
    ("11_scintilla_cell", 110.0), ("12_scintilla_hours", 118.0), ("13_apertvm_layers", 129.0),
    ("14_apertvm_panel", 132.4), ("15_apertvm_field", 140.0), ("16_apertvm_blaze", 148.5),
    ("17_dormitio_cell", 157.2), ("18_dormitio_place", 159.2), ("19_dormitio_lid", 161.5),
    ("20_dormitio_closed", 166.0), ("21_finis", 172.0),
]
RAMP = [57.2, 61.8, 62.8, 63.4, 63.9, 64.4, 65.0, 65.9]
AUDIO = [66.8, 68.4, 70.0, 71.6, 74.0, 77.0, 84.0, 98.0]
PHOTOS = [("board-front", "pcbAssembly/front-detail.jpg"), ("board-back", "pcbAssembly/back-detail.jpg"),
          ("cases", "case/cases.jpg"), ("set", "intro/haloSetDisplay.jpg")]


def grab(film, t, width=1280):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", film,
                          "-frames:v", "1", "-vf", f"scale={width}:-2", "-f", "image2pipe", "-c:v", "png", "-"],
                         check=True, capture_output=True).stdout
    return Image.open(io.BytesIO(raw)).convert("RGB")


def save(im, name, q=84):
    path = os.path.join(IMG, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, quality=q, optimize=True, progressive=True) if name.endswith(".jpg") else im.save(path, optimize=True)
    print("wrote", os.path.relpath(path, ROOT), f"{os.path.getsize(path) // 1024} KB")


def font(size):
    for f in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def strip(film, times, name, width=480, crop=None):
    tiles = []
    for t in times:
        im = grab(film, t, 1280)
        if crop:
            im = im.crop(crop)
        im = im.resize((width, round(im.height * width / im.width)))
        ImageDraw.Draw(im).text((10, 8), f"{t:.1f} s", fill=(230, 200, 140), font=font(20))
        tiles.append(im)
    cols = 4
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (cols * width + (cols - 1) * 6, rows * tiles[0].height + (rows - 1) * 6), (12, 11, 14))
    for i, im in enumerate(tiles):
        sheet.paste(im, ((i % cols) * (width + 6), (i // cols) * (im.height + 6)))
    save(sheet, name)


def contact(film, name, step=6.0, cols=6, width=320):
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", film],
                               check=True, capture_output=True, text=True).stdout)
    times = [step / 2 + i * step for i in range(int(dur // step))]
    strip_tiles = []
    for t in times:
        im = grab(film, t, width)
        ImageDraw.Draw(im).text((6, 4), f"{int(t // 60)}:{int(t % 60):02d}", fill=(230, 200, 140), font=font(15))
        strip_tiles.append(im)
    h = strip_tiles[0].height
    rows = math.ceil(len(strip_tiles) / cols)
    sheet = Image.new("RGB", (cols * width + (cols - 1) * 4, rows * h + (rows - 1) * 4), (12, 11, 14))
    for i, im in enumerate(strip_tiles):
        sheet.paste(im, ((i % cols) * (width + 4), (i // cols) * (h + 4)))
    save(sheet, name)


def ramp_gif(film, name, t0=62.4, t1=66.4, fps=12, width=420):
    path = os.path.join(IMG, name)
    vf = f"fps={fps},crop=iw*0.5:ih*0.78:iw*0.25:0,scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(t0), "-t", str(t1 - t0), "-i", film,
                    "-vf", vf, "-loop", "0", path], check=True)
    print("wrote", os.path.relpath(path, ROOT), f"{os.path.getsize(path) // 1024} KB")


def led_order(name):
    """Where firmware index 0, 1, 2 ... lands on the ring: as the schematic reads, and as the board behaves."""
    board = json.load(open(os.path.join(ROOT, "build", "board.json")))
    slot = lambda l: round((((94 - l["ang"]) % 360) + 360) % 360 / 4) % 90
    by_nets = {(int(l["A"].split("-")[1]), int(l["K"].split("-")[1])): l for l in board["leds"]}

    def fw(i):                                   # ledHigh(): CPX[col] high, CPX[row] low
        col = i // 9
        row = 9 - (i % 9)
        if 9 - col <= 9 - row:
            row -= 1
        return col, row

    literal = [slot(by_nets[fw(i)]) for i in range(90)]
    built = [slot(by_nets[fw(i)[::-1]]) for i in range(90)]
    W, H, R, N = 1400, 760, 240, 10
    im = Image.new("RGB", (W, H), (12, 11, 14))
    g = ImageDraw.Draw(im)
    panels = [("as the schematic's LED pins read", "index + 1 lands 9 LEDs (36°) away", literal, 350),
              ("as the board behaves", "index i is D(i+1): index + 1 is the neighbour", built, 1050)]
    for title, sub, order, cx in panels:
        cy = 420
        pos = lambda s, r=R: (cx + r * math.cos(math.radians(-94 + 4 * s)), cy - r * math.sin(math.radians(-94 + 4 * s)))
        for s in range(90):
            x, y = pos(s)
            g.ellipse([x - 4, y - 4, x + 4, y + 4], fill=(80, 68, 66))
        for i in range(N - 1):
            g.line([pos(order[i]), pos(order[i + 1])], fill=(235, 90, 50), width=3)
        for i in range(N):
            x, y = pos(order[i])
            g.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(255, 120, 60) if i else (255, 220, 150))
            lx, ly = pos(order[i], R + 30 + (14 if i % 2 else 0) * (order is built))
            g.text((lx, ly), str(i), fill=(240, 210, 150), font=font(20), anchor="mm")
        g.text((cx, 58), title, fill=(235, 230, 220), font=font(28), anchor="mm")
        g.text((cx, 96), sub, fill=(190, 180, 170), font=font(22), anchor="mm")
    g.text((W // 2, H - 26), "firmware indices 0-9 joined in order  ·  dots: the 90 LEDs, 4° apart, slot 0 at the bottom",
           fill=(150, 145, 140), font=font(19), anchor="mm")
    save(im, name)


def photos():
    src = os.path.join(ROOT, "vendor", "halo-90", "docs")
    for name, rel in PHOTOS:
        p = os.path.join(src, rel)
        if not os.path.exists(p):
            print("missing", p)
            continue
        im = Image.open(p).convert("RGB")
        im.thumbnail((1400, 1400))
        save(im, f"photos/{name}.jpg", q=82)


def main(film):
    for name, t in FRAMES:
        save(grab(film, t), f"frames/{name}.jpg")
    contact(film, "film_contact.jpg")
    strip(film, RAMP, "refrain_ramp.jpg", crop=(320, 0, 960, 560))
    strip(film, AUDIO, "audio_mode.jpg", crop=(320, 0, 960, 560))
    ramp_gif(film, "refrain_ramp.gif")
    led_order("led_order.png")
    photos()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "HALO-90_NONAGINTA_1080p.mp4"))
