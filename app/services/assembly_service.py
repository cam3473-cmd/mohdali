"""إدارة اجتماعات الجمعية العمومية: الحضور، النصاب، القرارات."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.db.models import (
    Assembly,
    AssemblyAgendaItem,
    AssemblyAttendance,
    AssemblyDecision,
    AssemblyRound,
    AssemblyStatus,
    AssemblyType,
    AttendanceType,
    DecisionResult,
    Member,
    User,
)
from app.services.audit import log_action
from app.services.bylaw_settings_service import get_settings
from app.services.eligibility_service import check_eligibility, list_eligible_members


class AssemblyError(Exception):
    pass


@dataclass
class QuorumResult:
    eligible_count: int
    attendee_count: int
    percent: float
    required_percent: float
    met: bool


def create_assembly(
    session: Session,
    actor: User,
    *,
    title: str,
    type: AssemblyType,
    meeting_date: date,
    location: str | None = None,
    notes: str | None = None,
) -> Assembly:
    assembly = Assembly(title=title, type=type, meeting_date=meeting_date, location=location, notes=notes)
    session.add(assembly)
    session.flush()
    log_action(session, actor, "create_assembly", "assembly", assembly.id)
    session.commit()
    return assembly


def add_agenda_item(
    session: Session, actor: User, assembly: Assembly, title: str, description: str | None = None
) -> AssemblyAgendaItem:
    order = len(assembly.agenda_items)
    item = AssemblyAgendaItem(assembly_id=assembly.id, order=order, title=title, description=description)
    session.add(item)
    session.flush()
    log_action(session, actor, "add_agenda_item", "assembly_agenda_item", item.id)
    session.commit()
    return item


def get_eligible_members(session: Session, assembly: Assembly) -> list[Member]:
    settings = get_settings(session)
    return list_eligible_members(session, as_of_date=assembly.meeting_date, settings=settings)


def open_assembly(session: Session, actor: User, assembly: Assembly) -> None:
    if assembly.status not in (AssemblyStatus.DRAFT, AssemblyStatus.INVITATIONS_SENT):
        raise AssemblyError("لا يمكن فتح اجتماع بحالته الحالية")
    assembly.status = AssemblyStatus.IN_PROGRESS
    log_action(session, actor, "open_assembly", "assembly", assembly.id)
    session.commit()


def close_assembly(session: Session, actor: User, assembly: Assembly) -> None:
    assembly.status = AssemblyStatus.CLOSED
    log_action(session, actor, "close_assembly", "assembly", assembly.id)
    session.commit()


def move_to_second_round(session: Session, actor: User, assembly: Assembly) -> None:
    """يُستخدم عند عدم اكتمال نصاب الاجتماع الأول، للانتقال إلى الجولة الثانية."""
    assembly.round = AssemblyRound.SECOND
    log_action(session, actor, "move_to_second_round", "assembly", assembly.id)
    session.commit()


def check_in_member(
    session: Session,
    actor: User,
    assembly: Assembly,
    member: Member,
    attendance_type: AttendanceType = AttendanceType.IN_PERSON,
    proxy_holder: Member | None = None,
) -> AssemblyAttendance:
    if assembly.status != AssemblyStatus.IN_PROGRESS:
        raise AssemblyError("لا يمكن تسجيل الحضور إلا لاجتماع قيد الانعقاد")

    result = check_eligibility(session, member, as_of_date=assembly.meeting_date)
    if not result.eligible:
        raise AssemblyError("العضو غير مؤهل لحضور/التصويت في الجمعية العمومية: " + "؛ ".join(result.reasons))

    existing = (
        session.query(AssemblyAttendance)
        .filter(AssemblyAttendance.assembly_id == assembly.id, AssemblyAttendance.member_id == member.id)
        .first()
    )
    if existing is not None:
        raise AssemblyError("تم تسجيل حضور هذا العضو مسبقًا في هذا الاجتماع")

    if attendance_type == AttendanceType.PROXY:
        if proxy_holder is None:
            raise AssemblyError("يجب تحديد العضو حامل التوكيل")
        holder_eligible = check_eligibility(session, proxy_holder, as_of_date=assembly.meeting_date)
        if not holder_eligible.eligible:
            raise AssemblyError("حامل التوكيل غير مؤهل هو نفسه لحضور/التصويت")
        settings = get_settings(session)
        if settings.max_proxies_per_holder > 0:
            current_proxies = (
                session.query(AssemblyAttendance)
                .filter(
                    AssemblyAttendance.assembly_id == assembly.id,
                    AssemblyAttendance.proxy_holder_member_id == proxy_holder.id,
                )
                .count()
            )
            if current_proxies >= settings.max_proxies_per_holder:
                raise AssemblyError(
                    f"تجاوز العضو الحد الأقصى للتوكيلات المسموح بحملها ({settings.max_proxies_per_holder})"
                )

    attendance = AssemblyAttendance(
        assembly_id=assembly.id,
        member_id=member.id,
        attendance_type=attendance_type,
        proxy_holder_member_id=proxy_holder.id if proxy_holder else None,
        checked_in_at=datetime.utcnow(),
    )
    session.add(attendance)
    session.flush()
    log_action(session, actor, "check_in_member", "assembly_attendance", attendance.id)
    session.commit()
    return attendance


def compute_quorum(session: Session, assembly: Assembly) -> QuorumResult:
    settings = get_settings(session)
    eligible_count = len(get_eligible_members(session, assembly))
    attendee_count = (
        session.query(AssemblyAttendance).filter(AssemblyAttendance.assembly_id == assembly.id).count()
    )
    percent = (attendee_count / eligible_count * 100) if eligible_count else 0.0
    required_percent = (
        settings.quorum_first_percent if assembly.round == AssemblyRound.FIRST else settings.quorum_second_percent
    )
    return QuorumResult(
        eligible_count=eligible_count,
        attendee_count=attendee_count,
        percent=percent,
        required_percent=required_percent,
        met=percent >= required_percent,
    )


def add_decision(
    session: Session,
    actor: User,
    assembly: Assembly,
    decision_text: str,
    agenda_item: AssemblyAgendaItem | None = None,
    requires_special_majority: bool = False,
) -> AssemblyDecision:
    decision = AssemblyDecision(
        assembly_id=assembly.id,
        agenda_item_id=agenda_item.id if agenda_item else None,
        decision_text=decision_text,
        requires_special_majority=requires_special_majority,
    )
    session.add(decision)
    session.flush()
    log_action(session, actor, "add_decision", "assembly_decision", decision.id)
    session.commit()
    return decision


def record_vote(
    session: Session,
    actor: User,
    decision: AssemblyDecision,
    votes_for: int,
    votes_against: int,
    votes_abstain: int,
) -> AssemblyDecision:
    settings = get_settings(session)
    decision.votes_for = votes_for
    decision.votes_against = votes_against
    decision.votes_abstain = votes_abstain

    votes_cast = votes_for + votes_against
    required_percent = (
        settings.majority_special_percent if decision.requires_special_majority else settings.majority_normal_percent
    )
    approval_percent = (votes_for / votes_cast * 100) if votes_cast else 0.0
    decision.result = DecisionResult.APPROVED if approval_percent > required_percent else DecisionResult.REJECTED

    log_action(
        session,
        actor,
        "record_vote",
        "assembly_decision",
        decision.id,
        details=f"for={votes_for} against={votes_against} abstain={votes_abstain} result={decision.result.value}",
    )
    session.commit()
    return decision

