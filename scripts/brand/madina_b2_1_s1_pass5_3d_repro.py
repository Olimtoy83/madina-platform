#!/usr/bin/env python3
"""Reproducibility recipe for Madina B2.1-S1 Pass 5 3D derivatives.

Run 3D modes with Blender 4.5.13 LTS:
  blender --background --python scripts/brand/madina_b2_1_s1_pass5_3d_repro.py -- \
    --mode hero --output /safe/output/hero.png --write

Run the geometry-validation reference with a regular Python interpreter that
has Pillow installed:
  python scripts/brand/madina_b2_1_s1_pass5_3d_repro.py \
    --mode front-reference --output /safe/output/front-reference.png --write

The repository approval PNGs are frozen. This script never writes any output
unless --write is supplied, and callers should direct output to a safe,
non-production location when reproducing a scene.
"""

from __future__ import annotations

import argparse
import math
import re
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CANONICAL_SVG = ROOT / "docs/brand/assets/b2-1-s1-pass5/signature-flow-diamond-b2-1-s1-pass5-master.svg"
SOURCE_UNITS_PER_U = 900.0  # The visible canonical extent is 50..950 source units.
FRONT_SRGB = "075D52"
SIDE_SRGB = "064D44"
BACKDROP_SRGB = "F7F6F2"


def srgb_hex_to_linear(value: str) -> tuple[float, float, float, float]:
    """Convert an sRGB hex colour to Blender's scene-linear RGBA values."""
    rgb = [int(value[index : index + 2], 16) / 255.0 for index in (0, 2, 4)]

    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    return (*[linear(channel) for channel in rgb], 1.0)


def canonical_paths() -> dict[str, str]:
    """Read, but never change, the two canonical source paths."""
    root = ET.parse(CANONICAL_SVG).getroot()
    namespace = {"svg": "http://www.w3.org/2000/svg"}
    paths = {
        node.attrib["id"]: node.attrib["d"]
        for node in root.findall(".//svg:defs/svg:path", namespace)
    }
    if set(paths) != {"outer-flow", "inner-flow"}:
        raise RuntimeError("The canonical SVG must contain exactly outer-flow and inner-flow.")
    return paths


def write_normalized_svg(directory: Path) -> Path:
    """Create a temporary, deterministic <use>-expanded import representation.

    The canonical source remains read-only. The normalized SVG replaces its
    eight <use> nodes with two source paths at rotations 0/90/180/270 degrees.
    """
    paths = canonical_paths()
    svg = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg", "viewBox": "0 0 1000 1000"})
    group = ET.SubElement(svg, "g", {"fill": f"#{FRONT_SRGB}"})
    for path_name in ("outer-flow", "inner-flow"):
        for degrees in (0, 90, 180, 270):
            attributes = {"d": paths[path_name]}
            if degrees:
                attributes["transform"] = f"rotate({degrees} 500 500)"
            ET.SubElement(group, "path", attributes)
    normalized = directory / "madina-b2-1-s1-pass5-normalized.svg"
    ET.ElementTree(svg).write(normalized, encoding="utf-8", xml_declaration=True)
    return normalized


def require_write(args: argparse.Namespace) -> None:
    if not args.write:
        raise SystemExit("Refusing to write output without --write.")
    if not args.output:
        raise SystemExit("An explicit --output path is required.")


def parse_svg_path(path_data: str, curve_steps: int = 256) -> list[tuple[float, float]]:
    """Flatten the canonical M/L/C/Z path grammar deterministically."""
    number = r"-?(?:\d+(?:\.\d*)?|\.\d+)"
    tokens = re.findall(r"[MLCZ]|" + number, path_data)
    index = 0
    cursor: tuple[float, float] | None = None
    outline: list[tuple[float, float]] = []
    while index < len(tokens):
        command = tokens[index]
        index += 1
        if command in {"M", "L"}:
            cursor = (float(tokens[index]), float(tokens[index + 1]))
            index += 2
            outline.append(cursor)
        elif command == "C":
            if cursor is None:
                raise RuntimeError("Cubic path command has no start point.")
            start = cursor
            control_1 = (float(tokens[index]), float(tokens[index + 1]))
            control_2 = (float(tokens[index + 2]), float(tokens[index + 3]))
            end = (float(tokens[index + 4]), float(tokens[index + 5]))
            index += 6
            for step in range(1, curve_steps + 1):
                t = step / curve_steps
                mt = 1.0 - t
                outline.append((
                    mt**3 * start[0] + 3 * mt**2 * t * control_1[0] + 3 * mt * t**2 * control_2[0] + t**3 * end[0],
                    mt**3 * start[1] + 3 * mt**2 * t * control_1[1] + 3 * mt * t**2 * control_2[1] + t**3 * end[1],
                ))
            cursor = end
        elif command != "Z":
            raise RuntimeError(f"Unsupported canonical SVG command: {command}")
    return outline


def render_front_reference(output: Path) -> None:
    """Make the approved flat, orthographic 2048 px geometry reference.

    This deliberately does not import Blender, lighting, materials, depth, or
    a backdrop object. It is a direct canonical-front rasterization: two paths,
    four exact rotations, 4x supersampling, #075D52 on a uniform #F7F6F2 field.
    """
    try:
        from PIL import Image, ImageDraw
    except ImportError as error:  # pragma: no cover - depends on invoking Python environment.
        raise SystemExit("front-reference mode requires Pillow.") from error

    scale = 4
    size = 2048
    canvas = Image.new("RGB", (size * scale, size * scale), f"#{BACKDROP_SRGB}")
    draw = ImageDraw.Draw(canvas)

    def project(point: tuple[float, float], turns: int) -> tuple[float, float]:
        x, y = point[0] - 500.0, point[1] - 500.0
        for _ in range(turns):
            x, y = -y, x
        # 50..950 source units map to 124..1924 px: 124 px quiet space per side.
        return ((x * 2.0 + 1024.0) * scale, (y * 2.0 + 1024.0) * scale)

    for path_name in ("outer-flow", "inner-flow"):
        outline = parse_svg_path(canonical_paths()[path_name])
        for turns in range(4):
            draw.polygon([project(point, turns) for point in outline], fill=f"#{FRONT_SRGB}")
    canvas.resize((size, size), Image.Resampling.LANCZOS).save(output, format="PNG", optimize=False, compress_level=9)


def blender_required():
    try:
        import bpy  # type: ignore
    except ImportError as error:  # pragma: no cover - requires Blender.
        raise SystemExit("hero and transparent modes must run under Blender 4.5.13 LTS.") from error
    return bpy


def point_camera_at(camera, target=(0.0, 0.0, -0.0175)) -> None:
    direction = mathutils.Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def build_blender_scene(mode: str, output: Path) -> None:
    """Build the approved Satin Green Architectural Relief scene in Blender."""
    bpy = blender_required()
    global mathutils
    import mathutils  # type: ignore

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    with tempfile.TemporaryDirectory(prefix="madina-pass5-") as temporary_directory:
        normalized_svg = write_normalized_svg(Path(temporary_directory))
        bpy.ops.import_curve.svg(filepath=str(normalized_svg))

    imported = list(bpy.context.selected_objects)
    if not imported:
        raise RuntimeError("Blender did not import the normalized canonical SVG.")
    bpy.context.view_layer.objects.active = imported[0]
    for obj in imported:
        obj.select_set(True)
    bpy.ops.object.join()
    mark = bpy.context.active_object
    mark.name = "Madina_B2_1_S1_Pass5"
    mark.scale = (1.0 / SOURCE_UNITS_PER_U, 1.0 / SOURCE_UNITS_PER_U, 1.0 / SOURCE_UNITS_PER_U)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mark.data.extrude = 0.035 / 2.0
    mark.data.bevel_depth = 0.003
    mark.data.bevel_resolution = 1
    bpy.ops.object.convert(target="MESH")
    # Place the exact imported front projection at z=0; physical depth stays behind it.
    front_z = max(vertex.co.z for vertex in mark.data.vertices)
    for vertex in mark.data.vertices:
        vertex.co.z -= front_z

    def material(name: str, colour: str):
        value = bpy.data.materials.new(name)
        value.use_nodes = True
        principled = value.node_tree.nodes.get("Principled BSDF")
        principled.inputs["Base Color"].default_value = srgb_hex_to_linear(colour)
        principled.inputs["Metallic"].default_value = 0.0
        principled.inputs["Roughness"].default_value = 0.57
        principled.inputs["Specular IOR Level"].default_value = 0.25
        return value

    side_material = material("Madina Side #064D44", SIDE_SRGB)
    front_material = material("Madina Front #075D52", FRONT_SRGB)
    mark.data.materials.append(side_material)
    mark.data.materials.append(front_material)
    for polygon in mark.data.polygons:
        polygon.material_index = 1 if polygon.normal.z > 0.999 else 0

    camera_data = bpy.data.cameras.new("Madina Camera")
    camera_data.lens = 52.0
    camera = bpy.data.objects.new("Madina Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    radius = 2.6
    yaw = math.radians(12.0)
    elevation = math.radians(8.0)
    camera.location = (radius * math.sin(yaw) * math.cos(elevation), -radius * math.cos(yaw) * math.cos(elevation), radius * math.sin(elevation))
    point_camera_at(camera)
    bpy.context.scene.camera = camera

    light_data = bpy.data.lights.new("40 W key", type="AREA")
    light_data.energy = 40.0
    light_data.shape = "DISK"
    light_data.size = 3.0
    key = bpy.data.objects.new("40 W key", light_data)
    key.location = (-1.5, -2.0, 2.0)
    bpy.context.collection.objects.link(key)
    key.rotation_euler = (math.radians(35), 0.0, math.radians(-35))

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35

    if mode == "hero":
        backdrop_material = bpy.data.materials.new("Emission-only #F7F6F2 backdrop")
        backdrop_material.use_nodes = True
        nodes = backdrop_material.node_tree.nodes
        for node in list(nodes):
            nodes.remove(node)
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = srgb_hex_to_linear(BACKDROP_SRGB)
        output_node = nodes.new("ShaderNodeOutputMaterial")
        backdrop_material.node_tree.links.new(emission.outputs[0], output_node.inputs[0])
        bpy.ops.mesh.primitive_plane_add(size=20.0, location=(0.0, 1.0, 0.0))
        backdrop = bpy.context.active_object
        backdrop.name = "Camera-visible emission-only backdrop"
        backdrop.data.materials.append(backdrop_material)
        # The plane is camera-facing and exists only for visible background, not world lighting.
        backdrop.rotation_euler = camera.rotation_euler
        backdrop.location = camera.location + camera.rotation_euler.to_matrix() @ mathutils.Vector((0.0, 0.0, -5.0))
        bpy.context.scene.render.film_transparent = False
    else:
        bpy.context.scene.render.film_transparent = True

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 2048
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if mode == "transparent" else "RGB"
    scene.render.filepath = str(output)
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.view_transform = "Standard"
    bpy.ops.render.render(write_still=True)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("hero", "transparent", "front-reference"), required=True)
    parser.add_argument("--output", type=Path, help="Explicit output file outside the frozen approval set.")
    parser.add_argument("--write", action="store_true", help="Required acknowledgement before an output may be written.")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_arguments()
    require_write(arguments)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    if arguments.mode == "front-reference":
        render_front_reference(arguments.output)
    else:
        build_blender_scene(arguments.mode, arguments.output)
