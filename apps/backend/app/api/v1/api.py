from fastapi import APIRouter

from app.api.v1.endpoints import (
    alerts,
    analytics,
    auth,
    buildings,
    cameras,
    events,
    floors,
    health,
    notifications,
    settings,
    users,
    zones,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(cameras.router)
api_router.include_router(buildings.router)
api_router.include_router(floors.router)
api_router.include_router(zones.router)
api_router.include_router(alerts.router)
api_router.include_router(events.router)
api_router.include_router(analytics.router)
api_router.include_router(notifications.router)
api_router.include_router(settings.router)
