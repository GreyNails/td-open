"""Run with data/local-ai/envs/comfy/bin/python; tests real geometric shells."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import trimesh
from backend.local_ai.mesh_cleanup import select_generated_surface
sphere=trimesh.creation.icosphere(subdivisions=4,radius=.6)
cage=trimesh.creation.box(extents=[2,2,2]);cage=cage.subdivide().subdivide().subdivide().subdivide()
inward=trimesh.creation.icosphere(subdivisions=4,radius=.8);inward.invert()
assert select_generated_surface([cage,inward,sphere]) is sphere
assert select_generated_surface([cage]) is cage
assert select_generated_surface([inward]) is inward
fragment=trimesh.creation.icosphere(subdivisions=1,radius=.02)
assert select_generated_surface([cage,inward,fragment]) is inward
try:select_generated_surface([])
except ValueError:pass
else:raise AssertionError('Empty generated output accepted')
print('PASS: volume boundary, inward shell, real object, lone cube, reversed mesh and empty output')
