"""إدارة مناصب مجلس الإدارة (تعيين، إنهاء، سجل تاريخي)."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import BoardPosition, Member, User
from app.services.audit import log_action


class BoardError(Exception):
    pass


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


def list_current_positions(session: Session) -> list[BoardPosition]:
    return (
        session.query(BoardPosition)
        .filter(BoardPosition.end_date.is_(None))
        .join(Member)
        .order_by(Member.full_name)
        .all()
    )


def list_position_history(session: Session, member: Member) -> list[BoardPosition]:
    return (
        session.query(BoardPosition)
        .filter(BoardPosition.member_id == member.id)
        .order_by(BoardPosition.start_date.desc().nulls_last())
        .all()
    )

