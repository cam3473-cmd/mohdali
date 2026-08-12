"""حساب أهلية العضو لحضور/التصويت في الجمعية العمومية."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from app.db.models import FeeStatus, Member, MemberStatus, MembershipFee
from app.services.bylaw_settings_service import BylawSettings, get_settings


@dataclass
class EligibilityResult:
    eligible: bool
    reasons: list[str]


def _has_paid_current_fee(session: Session, member: Member, as_of_date: date) -> bool:
    fee = (
        session.query(MembershipFee)
        .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == as_of_date.year)
        .first()
    )
    return fee is not None and fee.status in (FeeStatus.PAID, FeeStatus.WAIVED)


def check_eligibility(
    session: Session,
    member: Member,
    as_of_date: date | None = None,
    settings: BylawSettings | None = None,
) -> EligibilityResult:
    as_of_date = as_of_date or date.today()
    settings = settings or get_settings(session)
    reasons: list[str] = []

    if member.status != MemberStatus.ACTIVE:
        reasons.append("العضوية غير نشطة")

    if member.member_type not in settings.voting_member_types:
        reasons.append(f"نوع العضوية ({member.member_type}) لا يملك حق التصويت وفق الإعدادات الحالية")

    duration_exempt = member.is_founder and settings.founders_exempt_from_duration
    if not duration_exempt:
        days_elapsed = (as_of_date - member.join_date).days
        if days_elapsed < settings.min_membership_days:
            reasons.append(
                f"مدة العضوية ({days_elapsed} يوم) أقل من الحد الأدنى المطلوب ({settings.min_membership_days} يوم)"
            )

    if settings.require_paid_fees and not _has_paid_current_fee(session, member, as_of_date):
        reasons.append(f"لم يتم سداد اشتراك عام {as_of_date.year}")

    return EligibilityResult(eligible=len(reasons) == 0, reasons=reasons)


def list_eligible_members(
    session: Session, as_of_date: date | None = None, settings: BylawSettings | None = None
) -> list[Member]:
    as_of_date = as_of_date or date.today()
    settings = settings or get_settings(session)
    members = session.query(Member).filter(Member.status == MemberStatus.ACTIVE).all()
    return [m for m in members if check_eligibility(session, m, as_of_date, settings).eligible]

