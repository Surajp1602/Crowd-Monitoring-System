"""Idempotent bootstrap: roles, permissions, the first admin user, and default settings.

Runs automatically on backend startup (see app.main lifespan) so a fresh
`docker compose up` is immediately usable without a manual migration+seed step.
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from common.default_settings import DEFAULT_SETTINGS
from common.enums import RoleName
from common.models import Permission, Role, Setting, User
from common.rbac import ALL_PERMISSIONS, ROLE_PERMISSIONS

from app.core.config import get_settings
from app.core.security import hash_password

logger = logging.getLogger("ccd.seed")
settings = get_settings()


async def seed_permissions_and_roles(db: AsyncSession) -> dict[str, Role]:
    existing_perms = {p.code: p for p in (await db.execute(select(Permission))).scalars().all()}
    for code, description in ALL_PERMISSIONS:
        if code not in existing_perms:
            perm = Permission(code=code, description=description)
            db.add(perm)
            existing_perms[code] = perm
    await db.flush()

    existing_roles = {r.name: r for r in (await db.execute(select(Role))).scalars().all()}
    for role_name in RoleName:
        role = existing_roles.get(role_name.value)
        if role is None:
            role = Role(name=role_name.value, description=f"{role_name.value.replace('_', ' ').title()} role")
            db.add(role)
            existing_roles[role_name.value] = role
        await db.flush()
        await db.refresh(role, attribute_names=["permissions"])
        granted_codes = ROLE_PERMISSIONS.get(role_name, [])
        role.permissions = [existing_perms[c] for c in granted_codes if c in existing_perms]

    await db.flush()
    return existing_roles


async def seed_first_admin(db: AsyncSession, roles: dict[str, Role]) -> None:
    result = await db.execute(select(User).where(User.email == settings.FIRST_ADMIN_EMAIL))
    if result.scalar_one_or_none() is not None:
        return
    admin_role = roles.get(RoleName.ADMIN.value)
    user = User(
        email=settings.FIRST_ADMIN_EMAIL,
        hashed_password=hash_password(settings.FIRST_ADMIN_PASSWORD),
        full_name=settings.FIRST_ADMIN_NAME,
        role_id=admin_role.id if admin_role else None,
        is_active=True,
        is_guest=False,
    )
    db.add(user)
    logger.warning(
        "Seeded first admin user %s with the default password from FIRST_ADMIN_PASSWORD "
        "env var. Change it immediately after first login.",
        settings.FIRST_ADMIN_EMAIL,
    )


async def seed_default_settings(db: AsyncSession) -> None:
    existing = {s.key for s in (await db.execute(select(Setting))).scalars().all()}
    for key, value in DEFAULT_SETTINGS.items():
        if key not in existing:
            db.add(Setting(key=key, value=value))


async def run_seed(db: AsyncSession) -> None:
    roles = await seed_permissions_and_roles(db)
    await seed_first_admin(db, roles)
    await seed_default_settings(db)
    await db.commit()
