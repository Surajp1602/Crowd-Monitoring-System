import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.schemas.notification import E164

from app.schemas.common import ORMModel


class RoleRead(ORMModel):
    id: uuid.UUID
    name: str
    description: Optional[str] = None


class UserRead(ORMModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    is_active: bool
    is_guest: bool
    role: Optional[RoleRead] = None
    phone_number: Optional[str] = None
    notify_enabled: bool = True
    last_login_at: Optional[datetime] = None
    created_at: datetime


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str
    role_name: str = "viewer"
    phone_number: Optional[str] = None

    @field_validator("phone_number")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        return _phone(value)


def _phone(value: str | None) -> str | None:
    if not value:
        return None
    value = value.replace(" ", "").replace("-", "")
    if not E164.match(value):
        raise ValueError("Use international format, e.g. +919812345678")
    return value


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role_name: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)
    phone_number: Optional[str] = None
    notify_enabled: Optional[bool] = None

    @field_validator("phone_number")
    @classmethod
    def _check_phone(cls, value: str | None) -> str | None:
        return _phone(value)
