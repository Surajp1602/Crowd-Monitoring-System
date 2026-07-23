"""Default values seeded into the `settings` table on first boot.

Exposed to authorized users via `/api/v1/settings` and consumed by ai-service
(polled/subscribed) so threshold changes apply without redeploying.
"""

DEFAULT_SETTINGS: dict[str, dict] = {
    "yolo": {
        "model": "yolo11n.pt",
        "confidence_threshold": 0.45,
        "iou_threshold": 0.45,
        "frame_skip": 1,
        "input_size": 640,
    },
    "tracking": {
        "max_age": 30,
        "n_init": 3,
        "max_iou_distance": 0.7,
        "max_cosine_distance": 0.3,
        "nn_budget": 100,
    },
    "density": {
        "cell_size_m": 1.0,
        "smoothing_alpha": 0.35,
        "levels": [
            {"label": "low", "max_per_sqm": 1.0, "color": "#3b82f6"},
            {"label": "moderate", "max_per_sqm": 2.0, "color": "#22c55e"},
            {"label": "busy", "max_per_sqm": 3.5, "color": "#eab308"},
            {"label": "high", "max_per_sqm": 5.0, "color": "#f97316"},
            {"label": "critical", "max_per_sqm": 999.0, "color": "#dc2626"},
        ],
    },
    "anomaly": {
        "running_speed_mps": 2.5,
        "panic_speed_mps": 3.5,
        "loitering_dwell_s": 120,
        "congestion_density_per_sqm": 4.0,
        "stampede_density_per_sqm": 6.0,
        "counter_flow_angle_deg": 135,
        "abnormal_stop_s": 60,
        "min_confidence": 0.6,
    },
    "heatmap": {
        "sensitivity": 0.5,
        "decay_seconds": 8,
        "grid_resolution_m": 0.5,
    },
    "notifications": {
        "enabled_channels": ["push", "email"],
        "default_geofence_radius_m": 200,
    },
}
