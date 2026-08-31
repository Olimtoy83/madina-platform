# Madina 3D Brand Mark — Direction and Engineering

## Purpose and hierarchy

This document defines the one approved direction for a **secondary 3D brand
application** of the B2.1-S1 Flow-Diamond, Pass 5 mark. It is for premium,
high-resolution communications: presentation covers, launch materials,
marketing heroes, app/store presentation, and selected announcements.

The flat **Pass 5** master remains the sole canonical geometry and the normal
product mark. The approved Micro Pass 2 remains a controlled small-size
derivative. A 3D render is neither a new master nor a replacement for either.

Authoritative source:

`assets/b2-1-s1-pass5/signature-flow-diamond-b2-1-s1-pass5-master.svg`

Canonical master SHA-256:

`30DAFE49CF80F9CDBD15493EBE807F180359DE0409CFF6C9D2FF485264F095DA`

## Non-negotiable geometry

The front orthographic projection must be the canonical Pass 5 SVG exactly.
Import its two closed paths and their four exact rotations as geometry; do not
trace, simplify, redraw, expand, repair, or reinterpret them. Preserve the
outer silhouette, cardinal tips, central aperture, separate inner and outer
flows, inter-flow channels, and four-fold symmetry.

For engineering reference, the technical proof sheet records a visible symbol
extent of **U = 900 master units**, a central aperture envelope of `0.400U`,
and a narrowest sampled inter-flow channel of approximately `0.026U`. Those
measurements are guardrails, not permission to alter the SVG.

Keep every sharp front-edge cusp sharp. The front face is the original 2D
outline at `z = 0`; all depth and shading must sit behind it. Never fillet or
round away front-face corners, rails, or aperture junctions.

## Approved direction — Satin Green Architectural Relief

Use a single, solid deep-green Flow-Diamond as a precise architectural relief:
a calm studio object with shallow physical depth, subdued plane separation,
and an immediately recognisable front face. The intended feel is mature,
professional, and restrained-premium—not automotive, gaming, crypto, jewelry,
or cinematic.

### Color and material

| Surface | Specification | Rule |
| --- | --- | --- |
| Front face | Madina Primary Green `#075D52` | Solid color; satin / semi-matte dielectric finish. |
| Side and rear faces | Madina Primary Hover `#064D44` | Subordinate tonal separation only; not a second brand color. |
| Highlights | Material response only | Neutral white studio reflection; no painted gradient or metallic tint. |

Use a non-metallic material: metallic `0.00`, roughness `0.52–0.62`, and no
clearcoat, transmission, translucency, glitter, texture, or noise pattern.
These values describe the intended satin response; a renderer may translate
them to its equivalent physically based material controls.

Do not use gold, bronze, automotive chrome, mirror metal, glass, resin, neon,
holographic/rainbow surfaces, glow, or an independent colorful gradient. These
also prevent any SADEED AUTO identity leakage.

### Extrusion and bevel

Use **extrusion depth `0.035U`** (`31.5` units when importing the source SVG
at its native 900-unit visible extent). A production renderer may vary within
`0.030U–0.040U` only to retain the same shallow-relief character; do not make
the mark thick enough to compete with its front silhouette.

Use a single planar chamfer that begins behind the exact front outline:

- nominal bevel width: `0.003U` (`2.7` units);
- hard maximum bevel width: `0.004U` (`3.6` units);
- no bevel may close, bridge, or visually merge an inter-flow channel;
- front edges, cardinal tips, aperture points, and axial junctions remain
  unrounded at `z = 0`.

The maximum is intentionally far below the narrowest sampled channel
(`~0.026U`). If a renderer's bevel topology disturbs a channel, the bevel must
be reduced or omitted locally; never compensate by changing Pass 5 geometry.

### Lighting and shadow

Use a neutral studio setup:

- a large soft key from upper-left/front, approximately 35° above the object;
- broad low-intensity neutral fill from camera-right to retain the aperture and
  inner rails;
- optional very soft, neutral edge separation only when the side plane loses
  definition;
- no colored lighting, neon rim, dramatic backlight, hard specular streak, or
  lens flare.

Ground the mark with a physically plausible contact shadow and a short, soft
cast shadow falling down-right. At the hero scale, target a shadow opacity of
about 12–16% with a soft penumbra; it must reveal placement, not suggest that
the mark floats. No glow, halo, long cinematic shadow, or colored shadow.

### Camera, framing, and background

Primary hero view: a restrained three-quarter product view with yaw **18° to
camera-left** and elevation **12° above** the front plane. Use a 50–55 mm
full-frame-equivalent lens (or an equivalent moderate perspective camera),
with no fisheye or wide-angle distortion. The canonical silhouette must remain
immediately readable.

The required reference view is front orthographic, with the front face aligned
to camera. It is a geometry check, not an alternative mark.

Use a quiet off-white studio field (`#F7F6F2`) for the primary application.
Keep the full object in frame with at least `0.10U` of quiet space around its
visible projected bounds; do not crop tips, aperture, or cast shadow. A dark
neutral (`#1F2937`) is permitted only for a specifically approved premium
placement, with the same material and controlled contrast. Backgrounds are
application composition, never part of the canonical asset.

## Correct and incorrect use

Correct use is limited to high-resolution promotional or presentation contexts
where depth adds meaning and there is sufficient space to read the mark.
Continue to use flat Pass 5 for standard documents and normal product UI, and
Micro Pass 2 for the approved 20/16 px favicon and compact contexts.

Never use this 3D treatment for favicons, small UI, CRM navigation,
accessibility-critical UI, technical diagrams, everyday interface controls, or
as a substitute for the canonical SVG. Do not animate it, introduce a new
palette, use busy photography, crop it aggressively, create arbitrary camera
variants, or present the 3D output as a new logo revision.

## Production and export plan

Stage 2, when separately approved, should produce only this controlled asset
set from a reproducible scene:

1. One 3200 × 2000 px RGB hero render on the approved off-white background.
2. One 2048 × 2048 px RGBA transparent-background render at the same primary
   camera angle, for approved composition use.
3. One 2048 × 2048 px front orthographic PNG reference render for visual
   verification against Pass 5.
4. A compact scene manifest recording source-master SHA-256, imported scale,
   extrusion, bevel, camera, lights, material values, renderer, and color
   space.

Render in an sRGB output workflow, use lossless PNG for approval masters, and
derive WebP/JPEG delivery copies only after approval. Keep the canonical SVG
unmodified and outside the render output folder. Validate every production
render by overlaying its front orthographic reference against the Pass 5 SVG;
any silhouette, aperture, or channel mismatch rejects the render.

## Stage 1 boundary

No 3D proof render is registered in Stage 1. This document is the direction and
engineering decision; Stage 2 production requires separate approval. No CRM
components, CSS, favicon, runtime dependencies, or canonical/Micro assets are
changed by this stage.
