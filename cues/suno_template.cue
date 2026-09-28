# Cue sheet template for a new soundtrack (e.g. a Suno render).
# Replace every ?:??.?? with a time from your audio (m:ss.xx). Keep section keys and line order.
# 'bpm' and 'downbeat' are hints for the beat tracker; delete them to detect automatically.
bpm 80
downbeat ?:??.??


section ?:??.?? prologue  PROLOGVS | hold
section ?:??.?? introit  I · INTROITVS | boot
section ?:??.?? halo  II · HALO | patternNum = 1
section ?:??.?? dynamic  III · DYNAMICA | patternNum = 0
section ?:??.?? sparkle  IV · SCINTILLA | patternNum = 2
section ?:??.?? open  V · APERTVM | CERN-OHL-S · GPL-3.0 · CC BY-SA 4.0
section ?:??.?? sleep  VI · DORMITIO | HALT
section ?:??.?? finis  FINIS | 

mark ?:??.?? press
mark ?:??.?? release
mark ?:??.?? hold
mark ?:??.?? halt
mark ?:??.?? lid
mark ?:??.?? wake

line ?:??.?? ?:??.?? cantor
  latin In te-ne-bris lux u-na
  en in darkness, one light
  tech // hold the button — one LED wakes

line ?:??.?? ?:??.?? cantor2
  latin cir-cu-mit et cir-cu-lum fa-cit
  en it goes around, and makes a circle
  tech // boot animation: one full revolution, ~1 s

line ?:??.?? ?:??.?? choir
  latin No-na-gin-ta lu-mi-na
  en ninety lights
  tech // 90 × red LED · 0402 · 630 nm

line ?:??.?? ?:??.?? choir
  latin qua-ter-nis gra-di-bus
  en four degrees apart
  tech // placed at 4° intervals, cathodes facing the center

line ?:??.?? ?:??.?? choir
  latin Tre-de-cim tre-de-cim et i-te-rum tre-de-cim
  en thirteen, thirteen, and again thirteen
  tech setLed((prevLed + 13) % 90);

line ?:??.?? ?:??.?? organum
  latin U-na so-la ar-det om-nes lu-cent
  en one alone burns — all of them shine
  tech // charlieplexed: only one LED is ever on. your eye does the rest.

line ?:??.?? ?:??.?? chant
  latin Au-dit te au-dit te
  en it hears you
  tech // MEMS microphone → 12-bit ADC

line ?:??.?? ?:??.?? chant
  latin Can-ta et re-spon-de-bit
  en sing, and it will answer
  tech // audio mode — the default at boot

line ?:??.?? ?:??.?? chant
  latin De-cem fi-la no-na-gin-ta flam-mae
  en ten threads, ninety flames
  tech // 10 GPIO lines · 90 LEDs · 0 resistors

line ?:??.?? ?:??.?? chant
  latin Mi-li-es in se-cun-do
  en a thousand times each second
  tech // charlieplex scan > 1 kHz

line ?:??.?? ?:??.?? chant
  latin Oc-to bi-to-rum cor
  en a heart of eight bits
  tech // STM8L151 · 8-bit · 16 MHz

line ?:??.?? ?:??.?? organum
  latin U-na so-la ar-det
  en one alone burns
  tech // only one is ever on

line ?:??.?? ?:??.?? cantor
  latin Quin-de-cim sor-tes u-na lux
  en fifteen lots, one light
  tech rand() % 15 ? ledLow(prevLed) : setLed(rand() % 90);

line ?:??.?? ?:??.?? cantor
  latin ex num-mo par-vo vi-vit
  en it lives on a small coin
  tech // powered by one CR2032 coin cell

line ?:??.?? ?:??.?? cantor2
  latin cen-tum et no-vem ho-ras
  en for a hundred and nine hours
  tech // sparkle mode: 2.01 mA · ~109 hours

line ?:??.?? ?:??.?? organum
  latin Li-ber et a-per-tus
  en free and open
  tech // hardware CERN-OHL-S 2.0 · firmware GPL-3.0 · docs CC BY-SA 4.0

line ?:??.?? ?:??.?? organum
  latin om-ni-bus da-tus est
  en it is given to all
  tech // every file, in easy-to-remix formats

line ?:??.?? ?:??.?? organum
  latin Mu-ta fran-ge re-scri-be
  en change it, break it, rewrite it
  tech // modify · hack · remix · program your own light

line ?:??.?? ?:??.?? organum
  latin U-na so-la ar-det om-nes lu-cent
  en one alone burns — all of them shine
  tech // ninety lights. one at a time.

line ?:??.?? ?:??.?? cantor
  latin Te-ne et dor-mi-et
  en hold, and it will sleep
  tech // hold 500 ms → HALT · 15 µA

line ?:??.?? ?:??.?? amen
  latin A-men
  en amen
  tech $ make flash
