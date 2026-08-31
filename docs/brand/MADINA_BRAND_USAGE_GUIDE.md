# Madina Brand Usage Guide

## Canonical mark

The official symbol is **B2.1-S1 Flow-Diamond, Pass 5**. Its sole canonical
source is assets/b2-1-s1-pass5/signature-flow-diamond-b2-1-s1-pass5-master.svg.
Do not redraw, trace, optimize, recolor, or otherwise alter this file.

## Asset hierarchy

1. **Pass 5** — canonical full-size/master geometry.
2. **Micro Pass 2** — approved small-size derivative only; it preserves the
   Pass 5 outer silhouette while redistributing inner rails for 20 px and
   16 px use. It never replaces Pass 5 as the master.
3. **Satin Green Architectural Relief** — approved secondary dimensional
   application only. Its Hero, transparent, and front-reference PNGs are
   derivatives of Pass 5, never canonical masters or substitutes for the SVG.
   Proof I / 40 W is the approved visual-direction reference.
4. The preview and technical proof sheet in the Pass 5 package are controls,
   not application assets.

## Official applications

Use the canonical geometry as a CSS mask, SVG use, or equivalent application
wrapper; color application must not modify the canonical master.

| Application | Color | Use |
| --- | --- | --- |
| Primary / Madina Green | #075d52 | Default on white, light neutral, and approved light Madina surfaces. |
| Black / Monochrome | #111111 | Monochrome documents, technical reproduction, and neutral print/digital fallback. Use process black where required by print production. |
| White / Reverse | #ffffff | Only on sufficiently dark approved deep-green or dark-neutral surfaces. |

#075d52 is the current production source of truth: --color-primary in
packages/ui/src/tokens/colors.css. Do not use gold, gradients, strokes,
outlines, shadows, glow, opacity effects, or multicolor versions of the mark.

## Clear space

Let **X** equal the maximum width of one outer-flow shoulder. In Pass 5 this
is approximately 0.06 × the visible symbol width (about 53 of the 900-unit
visible bounds recorded by the technical proof sheet).

- Standalone symbol: keep at least 1X clear space on every side.
- Lockup: keep at least 1X from the symbol to adjacent type and from the
  complete lockup to other content.

Clear space is external placement space; it is not padding added to the SVG.

## Minimum size and Micro Pass 2

| Context | Asset | Minimum / rule |
| --- | --- | --- |
| Normal UI, documents, standard digital | Pass 5 | Use at **24 px or larger**. |
| Compact UI and favicon/app-icon use | Micro Pass 2 | Use at **20 px and 16 px**. |
| Below 16 px | None | Do not create another derivative or force a degraded mark; enlarge the container or omit the symbol. |

The CRM favicon is the approved deep-green Micro Pass 2 application. Its
geometry is not a new master.

## Background and contrast

Use Primary Green only on light, quiet backgrounds with clear contrast. Use
White only on a sufficiently dark approved surface. Use Black/Monochrome when
green is unavailable or neutral reproduction is required.

Never place the mark at low contrast, directly over uncontrolled busy
photography, or over a gradient. For photography, place the mark inside a
solid approved container instead of modifying the mark.

## Lockups

- **Standalone:** symbol only, following the clear-space and size rules.
- **Platform lockup:** symbol followed by MADINA PLATFORM.
- **CRM product lockup:** symbol followed by MADINA PLATFORM as the primary
  line and CRM as the secondary context line.

The CRM Sidebar implements the product lockup. Typography remains separate
from the symbol master; do not embed a wordmark or introduce an external font.
The Header carries the current page context rather than duplicating the
platform lockup.

## Incorrect usage

Do not change geometry, crop the mark, alter proportions, recolor individual
flows, add effects, place it on insufficient contrast, substitute SADEED AUTO
graphite/gold styling, or use Micro Pass 2 as the full-size master.

The Satin Green Architectural Relief is a secondary high-resolution
application. It must never replace the canonical Pass 5 SVG in product UI,
technical reproduction, or normal brand use, and it permits no geometry
reinterpretation.

## Developer notes

- Keep Pass 5 as the single geometry source of truth.
- Prefer a local CSS mask or SVG reference for color variants; do not fork
  geometry merely to change color.
- Give brand/home links one accessible name and keep decorative mark internals
  hidden from assistive technology.
- Preserve keyboard and focus behavior when a mark is used as a link.

## Asset registry

| Asset | Role | SHA-256 |
| --- | --- | --- |
| assets/b2-1-s1-pass5/signature-flow-diamond-b2-1-s1-pass5-master.svg | Canonical Pass 5 master | 30DAFE49CF80F9CDBD15493EBE807F180359DE0409CFF6C9D2FF485264F095DA |
| Historical signature-flow-diamond-b2-1-s1-micro-pass2-master.svg | Approved small-size source | AEF1884E31E0C5DA9BE17005B74C92158D5374F9B0192EFD67B8D47F1F5191E4 |
| assets/b2-1-s1-pass5/3d/madina-b2-1-s1-pass5-3d-hero.png | Satin Green Architectural Relief Hero derivative | C0CE2A69C1C79FE7E049A51F497522276E9C167D4FCB995BCF91F5450207745D |
| assets/b2-1-s1-pass5/3d/madina-b2-1-s1-pass5-3d-transparent.png | Satin Green Architectural Relief transparent derivative | 54920970CE314DCCBB6356E7949BE0C8E340EC584C3BD30CB4434CBFBD486F51 |
| assets/b2-1-s1-pass5/3d/madina-b2-1-s1-pass5-3d-front-reference.png | Pass 5 geometry-validation derivative | 6B6D34B9810B1FE6903CA8B4E028F7FCAB4310B643D3703B525BB45A9F9600CB |
