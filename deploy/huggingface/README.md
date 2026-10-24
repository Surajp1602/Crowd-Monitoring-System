---
title: CCD Crowd Density API
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
short_description: Backend and AI simulation for the CCD crowd density demo
---

# CCD: Crowd Density Mapping and Anomaly Detection

Backend for the live demo of [Crowd-Monitoring-System](https://github.com/Surajp1602/Crowd-Monitoring-System).
This Space runs the FastAPI backend, the AI pipeline on eight simulated camera feeds, the alert
worker, Postgres and Redis in one container. The dashboard is hosted separately and calls this API.
