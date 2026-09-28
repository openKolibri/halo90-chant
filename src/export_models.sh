#!/bin/zsh
# Export the 3D assets from the HALO-90 sources: board + parts + earwire from KiCad, case from STEP.
set -e
cd "$(dirname "$0")/.."
REPO=${HALO90_REPO:-vendor/halo-90}
mkdir -p build/models
kicad-cli pcb export glb --subst-models --include-tracks --include-pads --include-silkscreen \
  --include-soldermask -f -o build/models/halo90.glb "$REPO/pcb/halo-90.kicad_pcb"
FREECAD=${FREECAD:-/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd}
STEP2STL="$PWD/$REPO/case/caseBot.STEP=$PWD/build/models/caseBot.stl;$PWD/$REPO/case/caseTop.STEP=$PWD/build/models/caseTop.stl" \
  "$FREECAD" src/step2stl.py 2>&1 | grep facets
ls -la build/models
