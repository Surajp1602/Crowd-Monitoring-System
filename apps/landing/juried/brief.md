Media: none (real-time 3D, typography and motion only)

# Brief: CCD — Crowd Density Platform

**Big idea:** Crowds are terrain. Density rises into hills where people gather and flows downhill to exits;
the product reads that landscape live and warns before the slope gets dangerous.

**Signature moment:** The hero is a live 3D density field over a station floor. People are points walking
across it, and their density lifts the surface into contoured hills. One hill runs hot and its top contour
turns amber. Scrolling into the next chapter tilts the camera from an oblique view to straight overhead,
the terrain flattens, and what remains is the 2D isoline plan operators use. Terrain becomes instrument.
The closing CTA echoes it: the same field, flat and calm, with a single amber contour.

**Film:** replaced by a scroll-driven 3D chapter (no video). First frame: oblique terrain at walking height.
Last frame: top-down plan with walls, zones and isolines.

**Audience and promise:** Venue security leads, transit operators and event safety officers. After ten
seconds: *this sees density building before my staff can, and tells me exactly where.*

**Palette:** --ink #0c0e0d, --ink-2 #131614, --paper #ece8de, --paper-dim #a4a69c, --accent #f2a93b
(accent on paper uses --accent-deep #8a5310 for contrast). Density colours appear only as data.

**Type:** display Archivo Variable at width 88, weight 340–420, tracking −0.035 to −0.045em; text Archivo
16–18px; data and labels JetBrains Mono Variable 11px uppercase, +0.08em, numbered sections.

**Motion principles:**
- One orchestrated motion per section: hero terrain breathing, the tilt-to-plan scrub, heading line reveals.
- Live data never animates for show; only threshold crossings (the amber contour) draw attention.
- `prefers-reduced-motion`: a static plan view and static terrain frame; all copy visible immediately.

**Photography:** none. Every visual is generated from the product's own geometry and density maths.

**Section map:**
1. Header: wordmark, How it works · Detectors · Alerts · Deploy · FAQ, "Open the control center".
2. Hero: terrain canvas, headline, two CTAs, fact rail (12 detectors · 1 s heatmaps · 5 channels).
3. Terrain → plan chapter (scroll-scrubbed 3D): four steps from camera to floor plan.
4. Detectors (tabs): Density · Movement · Presence, with real default thresholds as metrics.
5. Where it works (pinned gallery, procedural contour art): transit, stadiums, festivals, malls.
6. Foundation (dark grid): on-prem, privacy, open sources, operations.
7. Integrations (orbit hub with the isoline mark): camera sources and notification channels.
8. Alert lifecycle (flow demos): detection → evidence → staff → public → PA.
9. FAQ.
10. Closing CTA with the flat-field echo.
11. Footer.

**Keep:** links to the dashboard login, the public subscribe page, and the repository documentation.
**Concept notice:** no (the person owns the product).

## Anti-template check

1. Centred gradient hero with pill buttons: no (left-set headline over a data field, square buttons).
2. Rows of icon cards as the main device: no (tabs, a pinned gallery, a hub, flows).
3. Glassmorphism or blobs: no (flat ink panels and hairlines; the only "shape" is real density).
4. Buzzword copy: no (voice list bans unlock/seamless/empower/AI-powered).
5. Fake testimonials or client logos: no (no clients section at all).
6. Identical sections: no (dark and paper chapters alternate, each with its own device).
7. Default Inter/Poppins: no (Archivo + JetBrains Mono).
8. AI imagery artefacts: none (no imagery).
9. Off-brand accents: no (one amber; density colours only as data).
10. Low-contrast grey text: checked (#a4a69c on #0c0e0d is 7.1:1; accent-deep on paper 5.3:1).
11. Motion that delays reading: no (copy visible without animation; reduced-motion path complete).
12. Placeholder anything: no.
