"""تسجيل العمليات الحساسة في سجل التدقيق."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import AuditLog, User


def log_action(
    session: Session,
    user: User | None,
    action: str,
    entity: str,
    entity_id: int | None = None,
    details: str | None = None,
) -> None:
    session.add(
        AuditLog(
            user_id=user.id if user else None,
            action=action,
            entity=entity,
            entity_id=entity_id,
            details=details,
        )
    )

