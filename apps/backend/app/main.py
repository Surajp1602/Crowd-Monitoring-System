import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.config import get_settings
from app.db.demo_seed import seed_demo_facility, seed_demo_team
from app.db.seed import run_seed
from app.db.session import AsyncSessionLocal
from app.ws.bridge import bridge
from app.ws.router import router as ws_router

settings = get_settings()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ccd.backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncSessionLocal() as db:
        try:
            await run_seed(db)
            logger.info("Startup seed complete (roles, permissions, first admin, default settings).")
            if settings.SEED_DEMO_DATA:
                created = await seed_demo_facility(db)
                if await seed_demo_team(db) or created:
                    await db.commit()
        except Exception:
            logger.exception("Startup seed failed - database may not be migrated yet.")
    if settings.ENABLE_WS_BRIDGE:
        bridge.start()
    yield
    if settings.ENABLE_WS_BRIDGE:
        await bridge.stop()


app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    debug=settings.DEBUG,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)
app.include_router(ws_router)


@app.get("/health")
async def root_health():
    """Unauthenticated liveness probe for the container orchestrator / load balancer."""
    return {"status": "ok", "service": settings.APP_NAME}
