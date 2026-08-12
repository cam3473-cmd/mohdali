"""تجزئة والتحقق من كلمات المرور."""
from __future__ import annotations

import bcrypt

_MAX_BCRYPT_BYTES = 72


def hash_password(plain_password: str) -> str:
    password_bytes = plain_password.encode("utf-8")[:_MAX_BCRYPT_BYTES]
    return bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    password_bytes = plain_password.encode("utf-8")[:_MAX_BCRYPT_BYTES]
    return bcrypt.checkpw(password_bytes, password_hash.encode("utf-8"))

