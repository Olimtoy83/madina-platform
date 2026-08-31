# Madina B2.1-S1 Pass 5 — 3D Scene Manifest

## Identity and hierarchy

- **Canonical identity:** B2.1-S1 Pass 5 — Flow-Diamond.
- **Canonical source:** `../signature-flow-diamond-b2-1-s1-pass5-master.svg`.
- **Canonical SHA-256:** `30DAFE49CF80F9CDBD15493EBE807F180359DE0409CFF6C9D2FF485264F095DA`.
- **Production renderer:** Blender 4.5.13 LTS.
- The canonical SVG and its geometry remain unchanged. The 3D PNGs are
  secondary brand derivatives, not canonical masters.

## Deterministic geometry preparation

The source SVG is read-only. Its `outer-flow` and `inner-flow` paths are
expanded into a temporary normalized SVG with each path repeated at rotations
`0°`, `90°`, `180°`, and `270°` around `(500, 500)`. This produces eight
closed flows without tracing, simplification, or geometry reinterpretation.

The canonical visible range is 50–950 source units on each axis. `U` is that
900-unit visible extent; Blender scene normalization maps `1U = 1.0` scene
unit. The front projection remains at `z = 0`, with depth extending behind it.

## Approved 3D treatment

| Property | Final value |
| --- | --- |
| Direction | Satin Green Architectural Relief |
| Extrusion | `0.035U` |
| Bevel | `0.003U`, one segment |
| Front | `#075D52` |
| Sides/rear | `#064D44` |
| Metallic | `0` |
| Roughness | `0.57` |
| Specular IOR level | `0.25` |
| Camera | 12° yaw, 8° elevation, 52 mm |
| Key light | Neutral 40 W area key |
| World illumination | Neutral world, strength `0.35` |

All brand hex values are converted from sRGB to scene-linear values before
they are assigned to Blender material or emission sockets. The front material
is assigned to front-facing mesh polygons; the side material is assigned to
the remaining depth and bevel polygons.

## Hero and transparency architecture

World strength `0.35` provides environment illumination. The visible Hero
background is intentionally separate: an emission-only `#F7F6F2` camera-facing
backdrop. It does not replace or alter World illumination.

The transparent derivative uses the identical geometry, materials, camera, and
illumination, with the camera-visible backdrop disabled and
`film_transparent=true`.

Proof I / 40 W remains the approved visual-direction reference. Minor tonal
differences from historical Proof I are expected and accepted because the
final Hero uses the corrected separation of visible backdrop and environment
illumination.

## Front-reference derivative

The accepted Front Reference is not a Blender material render. It is a direct
canonical SVG rasterization for geometry validation: two canonical paths,
their exact four rotations, flat orthographic projection, 4× supersampling,
and a uniform `#F7F6F2` field with a visible `#075D52` mark. No lighting,
shadow, perspective, or extrusion is involved.

Validation result: bbox `(124,124)–(1923,1923)`; padding `124/124/124/124`;
centroid `1023.384 / 1023.613`; aperture PASS; internal channels PASS;
four-fold rotational IoU `0.99777`; canonical silhouette IoU `0.99972`;
clipping PASS.

## Color management and export

The production scene uses Standard view transform, Look None, Exposure 0,
Gamma 1, and sRGB display/output. The approved derivatives are lossless PNG;
Hero output is RGB and transparent output is RGBA. Render mode is EEVEE Next
at 2048 × 2048, 100% resolution.

## Reproducibility script

`scripts/brand/madina_b2_1_s1_pass5_3d_repro.py`

The script requires an explicit output path and `--write`, so it cannot
silently overwrite the frozen approval assets.

## Frozen final assets

| Asset | SHA-256 |
| --- | --- |
| `madina-b2-1-s1-pass5-3d-hero.png` | `C0CE2A69C1C79FE7E049A51F497522276E9C167D4FCB995BCF91F5450207745D` |
| `madina-b2-1-s1-pass5-3d-transparent.png` | `54920970CE314DCCBB6356E7949BE0C8E340EC584C3BD30CB4434CBFBD486F51` |
| `madina-b2-1-s1-pass5-3d-front-reference.png` | `6B6D34B9810B1FE6903CA8B4E028F7FCAB4310B643D3703B525BB45A9F9600CB` |
