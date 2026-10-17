# Art direction: CCD Platform

Shared by the operator dashboard (`apps/frontend`) and the public product site
(`apps/landing`). Written to the Juried studio method: one idea, executed with restraint.

## Big idea: crowds are terrain

A crowd seen from above behaves like a landscape. Density rises into hills where people
gather, flows downhill toward exits, and a stampede is a landslide. The platform's job is
to read that terrain in real time and warn before the slope gets dangerous.

The visual signature is the **isoline**: the contour line of equal density, drawn from the
platform's own heatmaps. Isolines replace every decorative device a template would reach
for (gradient blobs, glass cards, abstract 3D shapes). Where the product shows a floor, it
shows real geometry; where it decorates, it decorates with contours of a real crowd.

## Signature moment

- **Product site hero:** a live 3D floor of the demo station. Moving people are rendered as
  points, and the density field around them rises as a contoured surface that keeps
  reshaping. On scroll the camera tilts from a near-ground view to a straight overhead plan,
  and the terrain flattens into the 2D isoline map operators see. Terrain becomes an
  instrument. The closing call to action echoes it: the same field, flat, with one hill
  turning amber.
- **Dashboard:** the facility map is the one place 3D is allowed. Everything else is a calm
  instrument panel.

## Audience and promise

Venue security leads, transit operators and event safety officers. After ten seconds they
should believe: *this sees density building before my staff can, and tells me exactly where.*

## Palette (60 / 30 / 10)

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0c0e0d` | Dominant ground (dashboard, dark chapters) |
| `--ink-2` | `#131614` | Panels and alternate chapters |
| `--ink-3` | `#1b1f1c` | Raised controls, hover |
| `--rule` | `rgb(232 228 216 / 0.09)` | Hairlines |
| `--paper` | `#ece8de` | Primary text on ink; light chapters on the site |
| `--paper-dim` | `#a4a69c` | Secondary text (7.1:1 on ink, passes AA) |
| `--amber` | `#f2a93b` | The only accent: primary actions, focus, the active item, key numbers |
| `--amber-deep` | `#b8741a` | Pressed state, accent on paper |

Density colors are **data, not decoration**, and appear only on heatmaps, density badges
and alert severities. The scale runs blue, green, yellow, orange, red, dark red, as the
platform spec requires.

Warm graphite neutrals with a sodium-lamp amber: a transit concourse at night.

## Type

- **Display and interface:** Archivo Variable. The display uses weight 340–420, width 86–92
  (slightly condensed), tracking −0.035em and line-height 1.02. The interface runs at
  14–15px and weight 420.
- **Data:** JetBrains Mono Variable for every number, code, timestamp and small label. It
  uses tabular figures.
- No third family. Labels are 11px mono, uppercase, +0.08em tracking, numbered sections
  (`01 — LIVE`).

## Grid and form

- 12 columns. The dashboard content max width is 1600px; the site uses a 1400px measure
  with `max(1.5rem, (100% - 1400px) / 2)` margins.
- Corners are 4px on controls and 6px on panels. Panels are flat `--ink-2` with a hairline
  border: no blur, no glow, no drop shadows on ink.
- Asymmetric compositions: a 7/5 or 8/4 split, never three identical cards.

## Motion

- One orchestrated motion per view: the map camera, a number settling, a line drawing in.
  No fade-up on every element.
- Easing is `cubic-bezier(0.16, 1, 0.3, 1)`, from 160ms (controls) to 900ms (map camera). No
  bounce.
- Live data never animates for show. Values update in place; only threshold crossings
  pulse, once.
- `prefers-reduced-motion` removes camera moves and pulses entirely.

## Texture

On dark chapters, a film grain at most 0.05 opacity, so large ink areas and the terrain
gradient never band.

## Anti-template checklist (all must be "no")

Gradient hero with pill buttons · rows of icon cards as the main device · glassmorphism or
glowing blobs · buzzword copy · fake testimonials or client logos · identical sections ·
default Inter/Poppins · off-palette accents · low-contrast grey text · placeholder content.

## Copy voice

Plain, specific, operational. Short declaratives about what the system does and measures.
No "unlock", "seamless", "empower", "revolutionise". Numbers only when the product
actually produces them, such as people/m², FPS or seconds to alert.
