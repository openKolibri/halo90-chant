# freecadcmd script: tessellate STEP solids finely, write binary STL, report bounding boxes.
# usage: STEP2STL="a.step=a.stl;b.step=b.stl" freecadcmd src/step2stl.py
import os, Part, MeshPart
for pair in os.environ["STEP2STL"].split(";"):
    src, dst = pair.split("=")
    shape = Part.read(src)
    mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.01, AngularDeflection=0.08, Relative=False)
    mesh.write(dst)
    bb = shape.BoundBox
    print(f"{os.path.basename(src)}: {mesh.CountFacets} facets  x[{bb.XMin:.2f},{bb.XMax:.2f}] "
          f"y[{bb.YMin:.2f},{bb.YMax:.2f}] z[{bb.ZMin:.2f},{bb.ZMax:.2f}]")
