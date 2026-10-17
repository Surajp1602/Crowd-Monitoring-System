# Jury log: operator dashboard

Captured with a Playwright script that signs in as the seeded dev admin and screenshots eleven pages
(desktop 1440×900 first screen, mobile 390 full page). It runs axe (WCAG 2 A/AA), records console
errors and horizontal overflow. One fresh `juried:juror` per round, given only the screenshots and
`juried/brief.md`. Pass line 7.0.

## Round 0 (2026-10-17 20:21): gates only
Failed: colour contrast on every page (`--paper-faint` #73766d was 3.6–4.2:1 on the panels), an
`aria-required-children` on the alert status chips (role tablist without tabs), a favicon 404.
Fixed: `--paper-faint` raised to #8b8e84 (5.0:1 on ink-3), chips are a labelled group, isoline mark as
the app icon, critical badge text in ink (white on red was 3.9:1). After: 0 violations, 0 errors.

## Round 1 (20:28): 6.87, revise
design 7.2 · usability 6.2 · creativity 7.0 · content 7.3
Fixed:
- Toasts moved to the bottom right, at most two visible, and one per alert type and place (a repeat
  replaces the toast instead of stacking).
- Next dev indicator off.
- Tables become labelled cards on phones (`.table-stack`): cameras, notifications, users.
- Map view switcher and layer toggles share one wrapping toolbar (they overlapped on phones).
- Overview plan: alert rings only for high and critical alerts from the last ten minutes, one per
  two-metre cell (it was every open alert).
- **Alert grouping in the backend**: a repeat of the same type on the same camera and zone within ten
  minutes of the last occurrence joins the open alert (`occurrences`, `last_seen_at`). Only an
  escalation in severity notifies again. The list shows `×N · last 2m ago`.
- Word readouts ("Abnormal stopping") wrap at a smaller size instead of being cut off. Service names
  are no longer truncated.
- Demo team seeded: one person per role, with no password, so they cannot sign in until an admin sets one.
- Simulated clothing colours muted. Calm walkers' boxes are paper, fast movers amber, running red.
- Local data only: deleted a stray `cam-01` test camera and closed the simulated backlog that built up
  before grouping existed.

## Round 2 (20:48): 6.90, revise
design 7.2 · usability 6.6 · creativity 6.8 · content 6.8
Fixed:
- Overview "cameras online" counted only cameras whose first live heartbeat had arrived ("1/8" right
  after load). It now uses the camera table's rule: the live status if present, else the stored status.
- Alerts page on phones laid out at 552 px: the single implicit grid column was sized to its
  min-content. Fixed with `grid-cols-[minmax(0,1fr)]` and `min-w-0`.
- Hourly ticks read "Mon, 18" (looked like a date). Now "Mon 18:00".
- Dispatcher cell showed the host name. Now "N sent · up 3h 12m".
- Delivery history page size 25.
- Overlay labels only on fast movers. Empty rooms say "No one in view".
- The mobile login keeps a strip of the contour field.
- Relative timestamps in mono.

## Round 3 (20:56): **7.10, pass**
design 7.4 · usability 6.8 · creativity 6.8 · content 7.2
Fixed after the round: alerts-per-day axis abbreviates thousands (`1.4k`).
Deferred, recorded for later:
- Contour-rendered density on the map and overview plan (marching squares at the legend thresholds,
  stepped terraces in 3D). This is the largest creativity gain left.
- Label collision avoidance in the 3D map, and plan view by default on portrait phones.
- Grouping notification deliveries by alert.
- Juror's count-reconciliation note: the overview "open alerts" and the alerts page "raised in 24 h"
  are different windows by design. Their labels say so.
