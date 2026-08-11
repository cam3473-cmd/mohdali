"""قراءة وتعديل إعدادات اللائحة الأساسية القابلة للتهيئة."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db.models import BylawSetting, User
from app.services.audit import log_action


@dataclass
class BylawSettings:
    min_membership_days: int
    founders_exempt_from_duration: bool
    require_paid_fees: bool
    voting_member_types: list[str]
    quorum_first_percent: float
    quorum_second_percent: float
    majority_normal_percent: float
    majority_special_percent: float
    max_proxies_per_holder: int
    board_term_end_date: str


def _to_bool(value: str) -> bool:
    return value.strip().lower() in {"true", "1", "yes"}


def get_settings(session: Session) -> BylawSettings:
    rows = {row.key: row.value for row in session.query(BylawSetting).all()}
    return BylawSettings(
        min_membership_days=int(rows.get("min_membership_days", "180")),
        founders_exempt_from_duration=_to_bool(rows.get("founders_exempt_from_duration", "true")),
        require_paid_fees=_to_bool(rows.get("require_paid_fees", "true")),
        voting_member_types=[
            t.strip() for t in rows.get("voting_member_types", "مؤسس,عامل").split(",") if t.strip()
        ],
        quorum_first_percent=float(rows.get("quorum_first_percent", "50")),
        quorum_second_percent=float(rows.get("quorum_second_percent", "25")),
        majority_normal_percent=float(rows.get("majority_normal_percent", "50")),
        majority_special_percent=float(rows.get("majority_special_percent", "66.67")),
        max_proxies_per_holder=int(rows.get("max_proxies_per_holder", "0")),
        board_term_end_date=rows.get("board_term_end_date", ""),
    )


def update_setting(session: Session, actor: User, key: str, value: str) -> None:
    row = session.query(BylawSetting).filter(BylawSetting.key == key).first()
    if row is None:
        raise ValueError(f"إعداد غير معروف: {key}")
    old_value = row.value
    row.value = value
    log_action(session, actor, "update_bylaw_setting", "bylaw_settings", details=f"{key}: {old_value} -> {value}")
    session.commit()


def list_settings(session: Session) -> list[BylawSetting]:
    return session.query(BylawSetting).order_by(BylawSetting.key).all()
