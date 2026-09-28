# NONAGINTA cue sheet (generated from src/score.py)
bpm 80
downbeat 0.00

section 0:00.00 prologue  PROLOGVS | hold
section 0:06.00 introit  I · INTROITVS | boot
section 0:30.00 halo  II · HALO | patternNum = 1
section 1:06.00 dynamic  III · DYNAMICA | patternNum = 0
section 1:42.00 sparkle  IV · SCINTILLA | patternNum = 2
section 2:06.00 open  V · APERTVM | CERN-OHL-S · GPL-3.0 · CC BY-SA 4.0
section 2:36.00 sleep  VI · DORMITIO | HALT
section 2:48.00 finis  FINIS | 

mark 0:00.50 press
mark 0:01.68 release
mark 2:36.80 carry
mark 2:37.40 cell
mark 2:39.00 place
mark 2:39.95 hold
mark 2:40.45 halt
mark 2:42.00 lid
mark 2:55.30 wake

line 0:06.00 0:15.38 cantor
  latin In te-ne-bris lux u-na
  syl 6.000 6.750 7.500 8.250 9.375 10.875 12.375
  sylend 6.750 7.500 8.250 9.375 10.875 12.375 15.375
  en in darkness, one light
  tech // hold the button — one LED wakes

line 0:18.00 0:28.50 cantor2
  latin cir-cu-mit et cir-cu-lum fa-cit
  syl 18.000 18.750 19.500 21.000 21.750 22.500 23.250 24.750 25.500
  sylend 18.750 19.500 21.000 21.750 22.500 23.250 24.750 25.500 28.500
  en it goes around, and makes a circle
  tech // boot animation: one full revolution, ~1 s

line 0:30.00 0:36.00 choir
  latin No-na-gin-ta lu-mi-na
  syl 30.000 30.750 31.500 32.625 33.000 33.750 34.500
  sylend 30.750 31.500 32.625 33.000 33.750 34.500 36.000
  en ninety lights
  tech // 90 × red LED · 0402 · 630 nm

line 0:36.00 0:42.00 choir
  latin qua-ter-nis gra-di-bus
  syl 36.000 36.750 37.500 39.000 39.750 40.500
  sylend 36.750 37.500 39.000 39.750 40.500 42.000
  en four degrees apart
  tech // placed at 4° intervals, cathodes facing the center

line 0:42.00 0:54.00 choir
  latin Tre-de-cim tre-de-cim et i-te-rum tre-de-cim
  syl 42.000 42.750 43.500 45.000 45.750 46.500 48.000 48.750 49.500 50.250 51.000 51.750 52.500
  sylend 42.750 43.500 45.000 45.750 46.500 48.000 48.750 49.500 50.250 51.000 51.750 52.500 54.000
  en thirteen, thirteen, and again thirteen
  tech setLed((prevLed + 13) % 90);

line 0:54.00 1:06.00 organum
  latin U-na so-la ar-det om-nes lu-cent
  syl 54.000 55.125 55.500 56.250 57.000 58.500 60.000 60.750 61.500 63.000
  sylend 55.125 55.500 56.250 57.000 58.500 60.000 60.750 61.500 63.000 66.000
  en one alone burns — all of them shine
  tech // charlieplexed: only one LED is ever on. your eye does the rest.

line 1:06.00 1:11.25 chant
  latin Au-dit te au-dit te
  syl 66.000 66.375 66.750 69.000 69.375 69.750
  sylend 66.375 66.750 67.500 69.375 69.750 71.250
  en it hears you
  tech // MEMS microphone → 12-bit ADC

line 1:12.00 1:17.25 chant
  latin Can-ta et re-spon-de-bit
  syl 72.000 72.750 74.250 75.000 75.375 75.750 76.500
  sylend 72.750 73.500 75.000 75.375 75.750 76.500 77.250
  en sing, and it will answer
  tech // audio mode — the default at boot

line 1:18.00 1:24.00 chant
  latin De-cem fi-la no-na-gin-ta flam-mae
  syl 78.000 78.375 78.750 79.125 81.000 81.375 81.750 82.125 82.500 83.250
  sylend 78.375 78.750 79.125 80.250 81.375 81.750 82.125 82.500 83.250 84.000
  en ten threads, ninety flames
  tech // 10 GPIO lines · 90 LEDs · 0 resistors

line 1:24.00 1:29.25 chant
  latin Mi-li-es in se-cun-do
  syl 84.000 84.375 84.750 85.500 87.000 87.375 87.750
  sylend 84.375 84.750 85.500 86.250 87.375 87.750 89.250
  en a thousand times each second
  tech // charlieplex scan > 1 kHz

line 1:30.00 1:36.00 chant
  latin Oc-to bi-to-rum cor
  syl 90.000 90.750 91.500 91.875 92.250 93.000
  sylend 90.750 91.500 91.875 92.250 93.000 96.000
  en a heart of eight bits
  tech // STM8L151 · 8-bit · 16 MHz

line 1:36.00 1:42.00 organum
  latin U-na so-la ar-det
  syl 96.000 96.375 96.750 97.500 99.000 99.750
  sylend 96.375 96.750 97.500 98.250 99.750 102.000
  en one alone burns
  tech // only one is ever on

line 1:42.00 1:48.00 cantor
  latin Quin-de-cim sor-tes u-na lux
  syl 102.000 102.750 103.125 104.250 105.000 105.750 106.125 106.500
  sylend 102.750 103.125 104.250 105.000 105.750 106.125 106.500 108.000
  en fifteen lots, one light
  tech rand() % 15 ? ledLow(prevLed) : setLed(rand() % 90);

line 1:48.00 1:54.00 cantor
  latin ex num-mo par-vo vi-vit
  syl 108.000 108.375 108.750 109.875 110.250 111.000 111.750
  sylend 108.375 108.750 109.875 110.250 111.000 111.750 114.000
  en it lives on a small coin
  tech // powered by one CR2032 coin cell

line 1:54.00 2:00.00 cantor2
  latin cen-tum et no-vem ho-ras
  syl 114.000 114.750 115.125 115.500 116.250 117.000 117.750
  sylend 114.750 115.125 115.500 116.250 117.000 117.750 120.000
  en for a hundred and nine hours
  tech // sparkle mode: 2.01 mA · ~109 hours

line 2:06.00 2:12.00 organum
  latin Li-ber et a-per-tus
  syl 126.000 127.125 127.500 128.250 129.000 129.750
  sylend 127.125 127.500 128.250 129.000 129.750 132.000
  en free and open
  tech // hardware CERN-OHL-S 2.0 · firmware GPL-3.0 · docs CC BY-SA 4.0

line 2:12.00 2:18.00 organum
  latin om-ni-bus da-tus est
  syl 132.000 132.750 133.500 135.000 135.750 136.500
  sylend 132.750 133.500 135.000 135.750 136.500 138.000
  en it is given to all
  tech // every file, in easy-to-remix formats

line 2:18.00 2:24.00 organum
  latin Mu-ta fran-ge re-scri-be
  syl 138.000 138.750 139.500 140.250 141.000 141.375 142.500
  sylend 138.750 139.500 140.250 141.000 141.375 142.500 144.000
  en change it, break it, rewrite it
  tech // modify · hack · remix · program your own light

line 2:24.00 2:36.00 organum
  latin U-na so-la ar-det om-nes lu-cent
  syl 144.000 145.125 145.500 146.250 147.000 148.500 150.000 150.750 151.500 153.000
  sylend 145.125 145.500 146.250 147.000 148.500 150.000 150.750 151.500 153.000 156.000
  en one alone burns — all of them shine
  tech // ninety lights. one at a time.

line 2:36.00 2:42.00 cantor
  latin Te-ne et dor-mi-et
  syl 156.000 156.750 157.500 159.000 159.750 160.500
  sylend 156.750 157.500 159.000 159.750 160.500 162.000
  en hold, and it will sleep
  tech // hold 500 ms → HALT · 15 µA

line 2:42.00 2:49.50 amen
  latin A-men
  syl 162.000 165.000
  sylend 165.000 169.500
  en amen
  tech $ make flash
