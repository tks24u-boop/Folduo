"""Product renders of the dock with Blender's Cycles (headless, via the bpy module).

    pip install bpy            # needs Python 3.11 and its own numpy<2 (use a venv)
    python3 clamshell_dock.py --assembly /tmp/asm
    python render_blender.py /tmp/asm ../images [--quick]

The assembly folder holds <set>__<part>.stl plus <set>.json manifests written by
clamshell_dock.py. Each shot below picks a set and a camera; the night shot turns the
lights down and lets the glow badge emit.
"""

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def lin(hex_rgb: str) -> tuple:
    """sRGB hex -> linear RGBA for the Principled BSDF."""
    out = []
    for i in (1, 3, 5):
        c = int(hex_rgb[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


PALETTES = {
    # black PETG body, Clawd in orange glow PLA, black felt, MacBook Air in Silver: the
    # light Mac shows the dock's real visual weight, where Midnight would hide it
    "studio": {"petg": "#141416", "glow": "#FF9D5B", "white": "#EDEDE8", "felt": "#232325", "rubber": "#1E1E1E",
               "laptop": "#D6D7D9", "floor": "#CBC5BA"},
}

MATERIAL_FINISH = {  # roughness, metallic
    "petg": (0.36, 0.0),  # satin, as black PETG prints
    "glow": (0.55, 0.0),
    "white": (0.6, 0.0),
    "felt": (0.95, 0.0),
    "rubber": (0.8, 0.0),
    "laptop": (0.33, 1.0),
    "floor": (0.85, 0.0),
}

SHOTS = [
    {"name": "hero", "set": "assembled", "cam": (420, -720, 260), "target": (0, 0, 100), "lens": 58},
    # what the owner sees from the chair: eye 450 mm above the desk, 650 mm away
    {"name": "seat", "set": "assembled", "cam": (0, -650, 450), "target": (0, 0, 80), "lens": 42},
    {"name": "dock", "set": "dock", "cam": (240, -340, 200), "target": (0, 0, 22), "lens": 55},
    {"name": "end", "set": "dock", "cam": (-470, -40, 70), "target": (0, 0, 28), "lens": 60},
    {"name": "rear", "set": "dock", "cam": (330, 380, 210), "target": (40, 0, 18), "lens": 55},
    # lights out: only the glow badge and a faint blue night fill
    {"name": "night", "set": "assembled", "cam": (300, -640, 190), "target": (0, 0, 60), "lens": 58, "night": True},
]


def material(name: str, hex_rgb: str, glow: float = 0.0) -> bpy.types.Material:
    rough, metal = MATERIAL_FINISH[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(hex_rgb)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if glow:  # afterglow of the phosphor
        b.inputs["Emission Color"].default_value = lin(hex_rgb)
        b.inputs["Emission Strength"].default_value = glow
    return m


def look_at(obj, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def sweep(mat, back: float, yaw: float = 0.0, radius: float = 0.6, width: float = 8.0) -> None:
    """Seamless studio backdrop: floor that curves up into a wall behind the product,
    turned by yaw about the vertical so the wall faces the camera."""
    prof = [(-4.0, 0.0), (back - radius, 0.0)]
    for i in range(1, 17):
        a = math.pi / 2 * i / 16
        prof.append((back - radius + radius * math.sin(a), radius - radius * math.cos(a)))
    prof.append((back, 3.0))
    verts = [(x, y, z) for x in (-width / 2, width / 2) for (y, z) in prof]
    n = len(prof)
    faces = [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)]
    mesh = bpy.data.meshes.new("sweep")
    mesh.from_pydata(verts, [], faces)
    for poly in mesh.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new("sweep", mesh)
    ob.rotation_euler = (0.0, 0.0, yaw)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)


def area_light(name, loc_mm, energy, size, target=(0, 0, 60)):
    light = bpy.data.lights.new(name, "AREA")
    light.energy, light.size = energy, size
    obj = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = Vector(loc_mm) / 1000
    look_at(obj, Vector(target) / 1000)


def render(shot: dict, asm: Path, out: Path, samples: int, scale: float) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = int(1600 * scale), int(1067 * scale)
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    sc.view_settings.exposure = shot.get("exposure", 0.0)
    night = shot.get("night", False)
    pal = PALETTES["studio"]
    mats = {k: material(k, v, glow=3.0 if night and k == "glow" else 0.0) for k, v in pal.items()}

    manifest = json.loads((asm / f"{shot['set']}.json").read_text())
    objs = []
    for item in manifest:
        bpy.ops.wm.stl_import(filepath=str(asm / item["file"]))
        ob = bpy.context.selected_objects[0]
        ob.data.materials.append(mats[item["material"]])
        # smooth the mesh facets (under 5 deg apart) but keep real creases, such as the 20 deg toe tab
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(12))
        except Exception:
            bpy.ops.object.shade_auto_smooth(angle=math.radians(12))
        objs.append(ob)
    # STL is in mm; the scene is in metres. Parent everything to one empty.
    root = bpy.data.objects.new("root", None)
    sc.collection.objects.link(root)
    for ob in objs:
        ob.parent = root
    root.scale = (0.001, 0.001, 0.001)

    view = Vector(shot["target"]) - Vector(shot["cam"])
    sweep(mats["floor"], back=0.9, yaw=math.atan2(-view.x, view.y))  # the wall behind, as the camera sees it

    cam = bpy.data.cameras.new("cam")
    cam.lens = shot["lens"]
    cam_ob = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(cam_ob)
    sc.camera = cam_ob
    cam_ob.location = Vector(shot["cam"]) / 1000
    look_at(cam_ob, Vector(shot["target"]) / 1000)

    dim = 0.012 if night else 1.0
    area_light("key", (-600, -700, 900), 70 * dim, 1.2)
    area_light("fill", (900, -300, 350), 18 * dim, 1.5)
    area_light("rim", (200, 900, 700), 45 * dim, 1.0)
    world = bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = lin("#22304A" if night else pal["floor"])
    bg.inputs[1].default_value = 0.02 if night else 0.12

    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 92
    sc.render.filepath = str(out / f"{shot['name']}.jpg")
    bpy.ops.render.render(write_still=True)


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    quick = "--quick" in argv
    only = [a.split("=", 1)[1] for a in argv if a.startswith("--only=")]
    args = [a for a in argv if not a.startswith("--")]
    asm, out = Path(args[0]), Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    for shot in SHOTS:
        if only and shot["name"] not in only:
            continue
        render(shot, asm, out, samples=24 if quick else 160, scale=0.5 if quick else 1.0)


if __name__ == "__main__":
    main()
