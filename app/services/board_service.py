"""إدارة مناصب مجلس الإدارة (تعيين، إنهاء، سجل تاريخي)."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import BoardPosition, Member, User
from app.services.audit import log_action


class BoardError(Exception):
    pass


def _position_rank(title: str) -> int:
    """ترتيب عرض المنصب: الرئيس أولًا، ثم نائب الرئيس، ثم أمين الصندوق، ثم أمين السر، ثم بقية الأعضاء."""
    t = title or ""
    if "نائب" in t:
        return 1
    if "رئيس" in t:
        return 0
    if "صندوق" in t or "مالي" in t:
        return 2
    if "سر" in t:
        return 3
    return 4


def assign_position(
    session: Session,
    actor: User,
    member: Member,
    title: str,
    start_date: date | None = None,
    notes: str | None = None,
) -> BoardPosition:
    position = BoardPosition(
        member_id=member.id, title=title, start_date=start_date or date.today(), notes=notes
    )
    session.add(position)
    session.flush()
    log_action(session, actor, "assign_board_position", "board_position", position.id, details=title)
    session.commit()
    return position


def end_position(session: Session, actor: User, position: BoardPosition, end_date: date | None = None) -> None:
    if position.end_date is not None:
        raise BoardError("تم إنهاء هذا المنصب مسبقًا")
    position.end_date = end_date or date.today()
    log_action(session, actor, "end_board_position", "board_position", position.id)
    session.commit()


def update_position(
    session: Session,
    actor: User,
    position: BoardPosition,
    member: Member,
    title: str,
    start_date: date | None = None,
    notes: str | None = None,
) -> None:
    position.member_id = member.id
    position.title = title
    position.start_date = start_date
    position.notes = notes
    log_action(session, actor, "update_board_position", "board_position", position.id, details=title)
    session.commit()


def delete_position(session: Session, actor: User, position: BoardPosition) -> None:
    position_id = position.id
    details = f"{position.title} — {position.member.full_name}"
    session.delete(position)
    log_action(session, actor, "delete_board_position", "board_position", position_id, details=details)
    session.commit()


def list_current_positions(session: Session) -> list[BoardPosition]:
    positions = (
        session.query(BoardPosition)
        .filter(BoardPosition.end_date.is_(None))
        .join(Member)
        .order_by(Member.full_name)
        .all()
    )
    return sorted(positions, key=lambda p: (_position_rank(p.title), p.member.full_name))


def list_position_history(session: Session, member: Member) -> list[BoardPosition]:
    return (
        session.query(BoardPosition)
        .filter(BoardPosition.member_id == member.id)
        .order_by(BoardPosition.start_date.desc().nulls_last())
        .all()
    )


def term_status_text(term_end_date: str, as_of: date | None = None) -> str | None:
    """يبني نص حالة دورة المجلس مع عداد الأيام المتبقية (أو المنقضية) حتى تاريخ نهاية الدورة."""
    if not term_end_date:
        return None
    try:
        end = date.fromisoformat(term_end_date)
    except ValueError:
        return None
    today = as_of or date.today()
    days = (end - today).days
    if days >= 0:
        return f"دورة المجلس الحالية سارية حتى تاريخ: {term_end_date} — متبقٍ {days} يوم"
    return f"انتهت دورة المجلس بتاريخ: {term_end_date} منذ {abs(days)} يوم — يلزم تجديد اعتماد المجلس"
