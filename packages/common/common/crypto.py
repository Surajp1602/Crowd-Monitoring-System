"""Fernet-based secret encryption shared by backend (encrypts on camera create/update)
and ai-service (decrypts to open authenticated RTSP/HTTP/ONVIF streams). Both services
must be configured with the same `CAMERA_CREDENTIAL_ENCRYPTION_KEY`.
"""

from functools import lru_cache

from cryptography.fernet import Fernet


@lru_cache
def _fernet(key: str) -> Fernet:
    return Fernet(key.encode())


def encrypt_secret(plain: str, key: str) -> str:
    return _fernet(key).encrypt(plain.encode()).decode()


def decrypt_secret(token: str, key: str) -> str:
    return _fernet(key).decrypt(token.encode()).decode()
