# Dossier: CCD — Crowd Density Platform

**Who:** An on-premise platform that turns ordinary security cameras into a live map of crowd density,
with anomaly detection and alerting. Built in this repository (backend, AI service, worker, dashboard).

**Who buys:** Security leads at transit hubs, stadiums, festival sites, malls and campuses; event safety
officers responsible for crowd-crush prevention. They live in control rooms with camera walls and radios.

**What they say (voice):** "people per square metre", "zone load against capacity", "read the crowd before
it moves", "safety notice". Plain, operational, no hype.

**What it can prove (all from the repo or measured in this session):**
- 12 anomaly detectors over trajectories (running, panic, stampede risk, congestion, rapid rise,
  counter-flow, abnormal stopping, loitering, gathering, restricted-zone intrusion, altercation, abandoned bag).
- A per-floor density heatmap every second, with isolines at 0.5 / 1 / 2 / 3.5 / 5 p/m².
- Defaults: congestion at 4 p/m², stampede risk at 6 p/m², running from 2.5 m/s sustained.
- 5 notification channels (email, SMS, WhatsApp, push, public address); staff by role, public by distance.
- 6 camera source types plus a full simulator; 8 simulated cameras ran at ~8 fps each, 26–47 ms latency,
  on one development machine.
- No face recognition; public notices carry only place and guidance; public contacts masked in history.

**Brand:** Warm graphite ink, ivory type, one sodium-amber accent; Archivo + JetBrains Mono; the isoline
mark (three offset contours, amber peak). Full direction in docs/design/art-direction.md.

**No current marketing site**, so there is nothing to preserve beyond links into the product (dashboard
login, public subscribe page). No client logos, testimonials or press exist; none are shown.

**References:** windy.com (a data field as the interface), Palantir Gotham pages (operational restraint),
linear.app (rhythm, light display type).

**Open questions:** pricing and sales contact do not exist yet, so CTAs point into the product itself.
