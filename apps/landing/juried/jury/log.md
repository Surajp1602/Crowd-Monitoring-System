# Jury log

## Calibration (2026-10-17 14:20)
Five blind mutants plus the real build, one fresh juror per sheet.
Caught 5/5: no-signature (overall gap 0.9, creativity 2.3) · cramped-broken (1.4, usability 2.2) ·
generic-type (0.8, design 1.3) · template-palette (3.0, design 2.9) · lorem-content (2.0, content 6.5).
Real build scored 6.5 blind (before the contour-art fix). Calibrated: scores can steer the build.

## Round 0 (2026-10-17 14:10): gates only
Gates: 21/23. Failed: `scrollable-region-focusable` on `.cases__track` (mobile and reduced motion).
Fixed: the gallery track is a labelled, focusable region. Also found by eye: contour art strokes were
0.12 px (invisible); set to 1–1.6 px.

## Round 1 (2026-10-17 14:27)
Gates: 23/23.
Scores: design 7.2 · usability 7.0 · creativity 7.6 · content 8.3 → **7.3 (pass)**
Fixed after the round:
- P1: amber contour now visible on first paint (the hot hill always sits just over the threshold and
  swells on a cycle); relief compressed above 1.5 p/m² so the surge reads as a peak, not a spire.
- P3: integrations hub changed from chrome and bronze to matte paper with small paper nodes.
- P4: mobile header button shortened to "Control center"; "Public alerts" moves into the menu.
- P7: duplicate footer CTA removed, footer shortened.
Deferred:
- P2 (first gallery card cut off): the stills catch the pinned horizontal pan mid-scroll. At rest the first
  card aligns to the gutter.
- P5 (closing CTA "frame rectangles"): those are the station's walls in plan view, kept deliberately.
- P6 (step captions small, scrub long): left as is for now; the chapter is the signature motion.
Gates after fixes: 23/23 (2026-10-17 14:32).
