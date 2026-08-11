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


def list_recent(session: Session, limit: int = 300, search: str | None = None) -> list[AuditLog]:
    query = session.query(AuditLog).order_by(AuditLog.timestamp.desc())
    if search:
        like = f"%{search}%"
        query = query.filter((AuditLog.action.ilike(like)) | (AuditLog.entity.ilike(like)) | (AuditLog.details.ilike(like)))
    return query.limit(limit).all()

