import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from common.models import Base

from app.db.seed import run_seed
from app.db.session import get_db
from app.main import app

from tests.fakes import FakeRedis

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(autouse=True)
def fake_redis(monkeypatch):
    """Every module that imported `get_redis` gets the same in-memory fake."""
    import sys

    fake = FakeRedis()
    for name, module in list(sys.modules.items()):
        if (name == "app" or name.startswith("app.")) and hasattr(module, "get_redis"):
            monkeypatch.setattr(module, "get_redis", lambda: fake)
    return fake


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        await run_seed(session)
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def admin_credentials():
    from app.core.config import get_settings

    settings = get_settings()
    return {"email": settings.FIRST_ADMIN_EMAIL, "password": settings.FIRST_ADMIN_PASSWORD}
