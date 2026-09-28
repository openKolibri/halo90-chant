# NONAGINTA — Suno prompt

Paste these three fields into Suno's **Custom** mode. Suno rejects artist names in the style field, so the
Halo-era sound is described rather than named.

## Style (≤ 1000 characters, v4.5 / v5)

```
Epic sacred video-game score: Gregorian chant sung by a unison male monastic choir in ecclesiastical Latin,
parallel organum at the fifth, deep bass monks an octave below. D Dorian / D minor, 80 BPM, 4/4, cathedral
reverb with a long tail. Opens with a single tactile click, a sub drone and one solo cantor in free rhythm.
Sustained low strings and taiko hits enter under the full choir. Mid-song drive: staccato cello ostinato in
sixteenths doubled by a bit-crushed 8-bit square-wave arpeggio, half-time snare on beat three, taiko groove,
overdriven electric guitar power chords. Breakdown: sparse celesta and bell plinks, soft piano arpeggios,
humming choir, solo cantor. Final section: everything returns, strings and horns, chromatic lift into a
triumphant D major on "omnes lucent", gong. Ends almost silent: solo cantor, then a soft four-part choral
"Amen" plagal cadence (G major to D major), a click, and silence. Solemn, reverent, cinematic, no pop.
```

Short version (≤ 200 characters, older models):

```
Gregorian chant epic game score, male monk choir in Latin, organum, strings, taiko, cello ostinato, 8-bit arpeggio, guitar, D minor 80 BPM, cathedral reverb, Amen ending
```

## Exclude styles

```
female vocals, pop vocals, autotune, rap, EDM drop, trap hi-hats, English lyrics, modern R&B
```

## Lyrics

The meta tags steer Suno toward the same eight sections as the film. Keep the section names: the video's
cue sheet refers to them.

```
[Intro: silence, one soft click, a rising electronic tick sweep, low drone]

[I · INTROITVS: solo male cantor, free rhythm, very slow]
In tenebris lux una
Circumit, et circulum facit

[II · HALO: full male choir in unison, strings enter, taiko on the downbeats]
Nonaginta lumina
Quaternis gradibus
Tredecim, tredecim, et iterum tredecim

[Chorus: choir in parallel fifths, swelling]
Una sola ardet, omnes lucent

[III · DYNAMICA: driving, cello ostinato, 8-bit arpeggio, rhythmic chanted choir]
Audit te, audit te
Canta, et respondebit
Decem fila, nonaginta flammae
Milies in secundo
Octo bitorum cor

[Chorus: short, shouted by the choir]
Una sola ardet

[IV · SCINTILLA: breakdown, celesta plinks, soft piano, solo cantor over humming choir]
Quindecim sortes, una lux
Ex nummo parvo vivit
Centum et novem horas

[Build: timpani roll, rising strings]

[V · APERTVM: full choir and orchestra, guitars, taiko]
Liber et apertus
Omnibus datus est
Muta, frange, rescribe

[Final Chorus: triumphant, lift to D major on "omnes lucent", gong]
Una sola ardet, omnes lucent

[VI · DORMITIO: sudden hush, solo cantor]
Tene, et dormiet

[Outro: soft four-part choir, plagal cadence]
Amen

[End: a single click, silence]
```

Pronunciation: Suno sings this closest to ecclesiastical (Italianate) Latin. If a take anglicises words,
these respellings help in the lyric field: *tredecim → tré-de-chim*, *circumit → chír-cu-mit*,
*lucent → lú-chent*, *facit → fá-chit*, *dormiet → dór-mi-et*.

## Making the video follow a Suno take

The film takes all its timing from `build/timeline.json`. Any audio file plus a cue sheet produces one.

1. Export the Suno song as WAV to `audio/suno.wav`. If your plan has **Get Stems**, also save the vocal
   stem as `audio/suno_vocals.wav`.
2. Copy `cues/suno_template.cue` to `cues/suno.cue` and fill in times (m:ss.xx): one `section` start per
   section, one `line` start/end per sung line, and the marks (`press`, `release`, `hold`, `halt`, `lid`,
   `wake`). Suno's synced-lyrics view shows the line times.
3. Rebuild and render:

```bash
.venv/bin/python src/timeline.py --cue cues/suno.cue --audio audio/suno.wav --vocals audio/suno_vocals.wav
```

```bash
JOBS=4 node src/build_film.js out/HALO-90_NONAGINTA_suno.mp4
```

Beats, bars, drum hits, and the note onsets that drive the LED patterns and the earwire's swing are detected
from the audio. The camera path is placed by section and line, so it re-times itself to the new song.

Syllable highlights are placed automatically on the detected sixteenth-note grid. Measured against this
film's own soundtrack:

| input | median error | within 0.2 s |
|---|---|---|
| full mix | 0.42 s | 37% |
| vocal stem (`--vocals`) | 0.15 s | 52% |

For frame-exact highlights, add a `syl` line under any cue `line`, with one start time per syllable, as in
`cues/nonaginta.cue`.
