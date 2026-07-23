from pydantic import BaseModel


class SettingRead(BaseModel):
    key: str
    value: dict


class SettingUpdate(BaseModel):
    value: dict
