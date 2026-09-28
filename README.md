# NONAGINTA — a canticle for ninety lights

A generated music video for [HALO-90](https://github.com/openKolibri/halo-90), the open-hardware earring
with ninety charlieplexed LEDs. Gregorian-style chant, strings, taiko and an 8-bit microcontroller voice
sing, in Latin, about how it works. Everything on screen is the real board: KiCad's 3D export of the PCB,
every copper trace from the layout, the STEP earwire and case, and the firmware's own LED patterns, run the
way the device runs them. It is one continuous camera move, three minutes long.

![NONAGINTA](docs/img/frames/07_halo_6k3.jpg)

**1920 × 1080 · 30 fps · 2:57 · −14 LUFS** · [lyrics](out/LYRICS.md) · [subtitles](out/HALO-90_NONAGINTA.srt) ·
[technical notes](docs/TECHNICAL.md)

> The rendered film is 936 MB, so it isn't stored in git. Build it with `node src/build_film.js`
> ([Build](#build)); a 1080p render takes about 19 minutes on an M3.

![the whole film, one frame every 6 s](docs/img/film_contact.jpg)

## The film

Six parts, one per firmware state. The Latin is sung; the English is its meaning; the code is what it means
on the board.

### I · INTROITVS — `boot`

*In tenebris lux una* — in darkness, one light · *circumit et circulum facit* — it goes around, and makes a
circle.

<table><tr>
<td><img src="docs/img/frames/00_prologue.jpg" alt="prologue"></td>
<td><img src="docs/img/frames/01_introit_one.jpg" alt="one light"></td>
<td><img src="docs/img/frames/02_introit_circle.jpg" alt="the circle"></td>
</tr></table>

The button is held and the boot sweep runs. Then a single LED seen past the parts at grazing angle, and one
revolution, a step per syllable.

### II · HALO — `patternNum = 1`

*Nonaginta lumina · quaternis gradibus · tredecim tredecim et iterum tredecim · una sola ardet, omnes
lucent* — ninety lights, four degrees apart; thirteen, thirteen and again thirteen; one alone burns, all of
them shine.

<table><tr>
<td><img src="docs/img/frames/03_halo_4deg.jpg" alt="4 degrees apart"></td>
<td><img src="docs/img/frames/04_halo_13.jpg" alt="+13"></td>
</tr><tr>
<td><img src="docs/img/frames/05_halo_single.jpg" alt="the only one on"></td>
<td><img src="docs/img/frames/06_halo_ramp.jpg" alt="scan ramp"></td>
</tr></table>

`setLed((prevLed + 13) % 90)`. Because 13 and 90 are coprime, the scan visits all ninety before repeating,
drawn as arcs over the components. In the refrain it steps once per beat, then accelerates to the device's
own 6.3 kHz, and the ring fades into the even glow persistence of vision makes of it.

<p align="center"><img src="docs/img/refrain_ramp.gif" alt="the refrain: one step per beat to 6.3 kHz" width="420"></p>

### III · DYNAMICA — `patternNum = 0`

*Audit te · canta et respondebit · decem fila, nonaginta flammae · milies in secundo · octo bitorum cor* —
it hears you; sing, and it will answer; ten threads, ninety flames; a thousand times each second; a heart
of eight bits.

<table><tr>
<td><img src="docs/img/frames/08_dynamica_audio.jpg" alt="audio mode"></td>
<td><img src="docs/img/frames/09_dynamica_cpx.jpg" alt="CPX lines"></td>
<td><img src="docs/img/frames/10_dynamica_u1.jpg" alt="STM8L151"></td>
</tr></table>

Audio mode, `setLed((4140 + rotationCenter + adc) % 90)`, simulated from the soundtrack itself through a
MEMS mic and a 12-bit ADC. A cluster circles the ring and spreads with loudness. The ten charlieplex lines
are traced live, and the STM8L151 has a heart on its silkscreen.

### IV · SCINTILLA — `patternNum = 2`

*Quindecim sortes, una lux · ex nummo parvo vivit · centum et novem horas* — fifteen lots, one light; it
lives on a small coin; for a hundred and nine hours.

<table><tr>
<td><img src="docs/img/frames/11_scintilla_cell.jpg" alt="CR2032"></td>
<td><img src="docs/img/frames/12_scintilla_hours.jpg" alt="109.5 hours"></td>
</tr></table>

### V · APERTVM — `CERN-OHL-S · GPL-3.0 · CC BY-SA 4.0`

*Liber et apertus · omnibus datus est · muta, frange, rescribe* — free and open; it is given to all; change
it, break it, rewrite it.

<table><tr>
<td><img src="docs/img/frames/13_apertvm_layers.jpg" alt="exploded layers"></td>
<td><img src="docs/img/frames/14_apertvm_panel.jpg" alt="the hex panel"></td>
</tr><tr>
<td><img src="docs/img/frames/15_apertvm_field.jpg" alt="the field grows"></td>
<td><img src="docs/img/frames/16_apertvm_blaze.jpg" alt="the blaze"></td>
</tr></table>

The board comes apart into its layers, then the hexagonal production panel grows ring by ring on the beat
into an infinite field of forks, each running a different pattern.

### VI · DORMITIO — `HALT`

*Tene et dormiet · Amen* — hold, and it will sleep. Amen.

<table><tr>
<td><img src="docs/img/frames/17_dormitio_cell.jpg" alt="the spare cell"></td>
<td><img src="docs/img/frames/18_dormitio_place.jpg" alt="laid in the case"></td>
</tr><tr>
<td><img src="docs/img/frames/19_dormitio_lid.jpg" alt="the lid"></td>
<td><img src="docs/img/frames/21_finis.jpg" alt="finis"></td>
</tr></table>

Held for 500 ms, it halts at 15 µA. The spare cell and the earring go into the magnetic case, and the lid
seats on "Amen". At the very end the boot sweep wakes inside the closed case and shows as light around the seam.

## Faithful to the hardware

### The real thing

<table><tr>
<td><img src="docs/img/photos/board-front.jpg" alt="HALO-90 front"></td>
<td><img src="docs/img/photos/board-back.jpg" alt="HALO-90 back"></td>
</tr><tr>
<td><img src="docs/img/photos/set.jpg" alt="earring and case"></td>
<td><img src="docs/img/photos/cases.jpg" alt="cases"></td>
</tr></table>

<sub>Photos: [openKolibri/halo-90](https://github.com/openKolibri/halo-90) docs, CC BY-SA 4.0.</sub>

### Copper under the mask

Every segment and via from the KiCad layout is baked into the soldermask as lifted, glossier copper, with
tented vias. The field in APERTVM is made of this top-down render of the hero board.

<p align="center"><img src="docs/img/board_topdown.jpg" alt="top-down render" width="480"></p>

### LED order

The firmware's own comment treats its LED index as "angle/4", and the real board clusters in audio mode. So
firmware index i is D(i+1), and +1 is the neighbour. Read literally, the schematic's LED A/K pins against
`ledHigh()` would put index + 1 nine LEDs (36°) away (left). Either the LED pins in the schematic or the drive
direction in `ledHigh()` is reversed; see [technical notes](docs/TECHNICAL.md#index-order).

![LED index order](docs/img/led_order.png)

### Duty cycle, not animation

Only one LED is ever on. Each frame shows each LED's share of the eye's last 50 ms, perceived as duty^0.3.
The refrain accelerates from one step per beat to the RTC's 6.3 kHz, where each LED lights 70 times a second:

![the refrain's ramp](docs/img/refrain_ramp.jpg)

Audio mode runs the soundtrack through the mic model at ADC rate. `rotationCenter` steps every 40 ms, as TIM2
does, and the cluster widens with loudness:

![audio mode](docs/img/audio_mode.jpg)

### The case and the earwire

The STEP case in white marble, with Ø5 × 3 mm magnets. The earwire is the original, unbent STEP model. In the
case it is swivelled 90° in the PCB hole, so the loop stays threaded and the loop and coil lie along the
wall.

<table><tr>
<td><img src="docs/img/qa/case_open.jpg" alt="the open case"></td>
<td><img src="docs/img/qa/earwire_face.jpg" alt="earwire in the case, walls hidden"></td>
</tr></table>

## How it's made

```mermaid
flowchart LR
  K["KiCad PCB + STEP"] --> G["GLB + board.json<br/>traces · vias · nets"]
  C["case STEP"] --> S["STL"]
  F["firmware halo.c"] -. patterns · rates · order .-> SC
  SC["score.py"] --> V["chant · orchestra · 8-bit"] --> M["mix · −14 LUFS"] --> T["timeline.json"]
  G --> W["three.js film<br/>headless Chrome"]
  S --> W
  T --> W
  W --> O["1080p film"]
```

- **Score.** Tempo, chords, Latin and the event streams all come from the firmware: the +13 scan, the
  sparkle's `rand() % 15`, the boot sweep.
- **Voice.** macOS `say`, re-pitched syllable by syllable into chant (WORLD vocoder), with strings, taiko
  and an 8-bit voice.
- **Timeline.** `src/timeline.py` turns the audio and cue sheet into `build/timeline.json`, which is the
  film's only clock.
- **Rendering.** The film is three.js in headless Chrome, captured frame by frame and deterministic. Another
  soundtrack plus its cue sheet re-times the whole film (see `out/SUNO.md`).

Details: [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Build

```sh
git clone --recurse-submodules git@github.com:openKolibri/halo90-chant.git && cd halo90-chant
# or, in an existing clone: git submodule update --init   (vendor/halo-90 = openKolibri/halo-90, pinned)
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && npm install
python3 src/parse_pcb.py vendor/halo-90/pcb/halo-90.kicad_pcb build/board.json
src/export_models.sh
.venv/bin/python src/mix.py
.venv/bin/python src/timeline.py --cue cues/nonaginta.cue --audio build/audio/nonaginta.wav --score
RES=1080 node src/build_film.js out/HALO-90_NONAGINTA_1080p.mp4
```

It needs:
- macOS, KiCad 8+, FreeCAD, Google Chrome and ffmpeg;
- Node ≥ 18 and Python ≥ 3.11.

The renderer guards memory: it won't start below 25% free and kills Chrome below 15%. See
[technical notes](docs/TECHNICAL.md#rebuild).

## Credits

- **HALO-90:** [openKolibri/halo-90](https://github.com/openKolibri/halo-90). Hardware CERN-OHL-S 2.0,
  firmware GPL-3.0, docs CC BY-SA 4.0. The photos above come from its docs.
- **Film and music:** generated from that repository with the code here.
