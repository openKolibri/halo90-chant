# NONAGINTA — a canticle for ninety lights

*A chant for the HALO-90 open-hardware earring, in six parts. The Latin is sung; the "translation" is the technical manual.*

## I · INTROITVS
`boot` · 0:06

| sung | meaning | what it means on the board |
|---|---|---|
| **In tenebris lux una** | in darkness, one light | `// hold the button — one LED wakes` |
| **circumit et circulum facit** | it goes around, and makes a circle | `// boot animation: one full revolution, ~1 s` |

## II · HALO
`patternNum = 1` · 0:30

| sung | meaning | what it means on the board |
|---|---|---|
| **Nonaginta lumina** | ninety lights | `// 90 × red LED · 0402 · 630 nm` |
| **quaternis gradibus** | four degrees apart | `// placed at 4° intervals, cathodes facing the center` |
| **Tredecim tredecim et iterum tredecim** | thirteen, thirteen, and again thirteen | `setLed((prevLed + 13) % 90);` |
| **Una sola ardet omnes lucent** | one alone burns — all of them shine | `// charlieplexed: only one LED is ever on. your eye does the rest.` |

## III · DYNAMICA
`patternNum = 0` · 1:06

| sung | meaning | what it means on the board |
|---|---|---|
| **Audit te audit te** | it hears you | `// MEMS microphone → 12-bit ADC` |
| **Canta et respondebit** | sing, and it will answer | `// audio mode — the default at boot` |
| **Decem fila nonaginta flammae** | ten threads, ninety flames | `// 10 GPIO lines · 90 LEDs · 0 resistors` |
| **Milies in secundo** | a thousand times each second | `// charlieplex scan > 1 kHz` |
| **Octo bitorum cor** | a heart of eight bits | `// STM8L151 · 8-bit · 16 MHz` |
| **Una sola ardet** | one alone burns | `// only one is ever on` |

## IV · SCINTILLA
`patternNum = 2` · 1:42

| sung | meaning | what it means on the board |
|---|---|---|
| **Quindecim sortes una lux** | fifteen lots, one light | `rand() % 15 ? ledLow(prevLed) : setLed(rand() % 90);` |
| **ex nummo parvo vivit** | it lives on a small coin | `// powered by one CR2032 coin cell` |
| **centum et novem horas** | for a hundred and nine hours | `// sparkle mode: 2.01 mA · ~109 hours` |

## V · APERTVM
`CERN-OHL-S · GPL-3.0 · CC BY-SA 4.0` · 2:06

| sung | meaning | what it means on the board |
|---|---|---|
| **Liber et apertus** | free and open | `// hardware CERN-OHL-S 2.0 · firmware GPL-3.0 · docs CC BY-SA 4.0` |
| **omnibus datus est** | it is given to all | `// every file, in easy-to-remix formats` |
| **Muta frange rescribe** | change it, break it, rewrite it | `// modify · hack · remix · program your own light` |
| **Una sola ardet omnes lucent** | one alone burns — all of them shine | `// ninety lights. one at a time.` |

## VI · DORMITIO
`HALT` · 2:36

| sung | meaning | what it means on the board |
|---|---|---|
| **Tene et dormiet** | hold, and it will sleep | `// hold 500 ms → HALT · 15 µA` |
| **Amen** | amen | `$ make flash` |
