"""سياق التطبيق المشترك بين شاشات الواجهة."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.auth.service import AuthService
from app.db.models import User


@dataclass
class AppContext:
    session: Session
    auth: AuthService

    @property
    def current_user(self) -> User | None:
        return self.auth.current_user

