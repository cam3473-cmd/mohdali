"""إدارة طلبات العضوية والأعضاء والاشتراكات."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import AssemblyAttendance, FeeStatus, Member, MemberStatus, MembershipFee, User
from app.services.audit import log_action


class MembershipError(Exception):
    pass


def _check_unique_fields(
    session: Session,
    member_id: int | None,
    membership_number: str | None,
    national_id_or_cr: str | None,
) -> None:
    """يتحقق أن رقم العضوية والسجل المدني غير مستخدمين لعضو آخر، ويرفع رسالة عربية واضحة عند التعارض
    بدلًا من ترك خطأ قاعدة البيانات الخام يصل للواجهة ويُعطّل الجلسة."""
    if membership_number:
        query = session.query(Member).filter(Member.membership_number == membership_number)
        if member_id is not None:
            query = query.filter(Member.id != member_id)
        conflict = query.first()
        if conflict is not None:
            raise MembershipError(f"رقم العضوية \"{membership_number}\" مستخدم بالفعل للعضو: {conflict.full_name}")
    if national_id_or_cr:
        query = session.query(Member).filter(Member.national_id_or_cr == national_id_or_cr)
        if member_id is not None:
            query = query.filter(Member.id != member_id)
        conflict = query.first()
        if conflict is not None:
            raise MembershipError(f"رقم الهوية/السجل \"{national_id_or_cr}\" مستخدم بالفعل للعضو: {conflict.full_name}")


def submit_membership_request(
    session: Session,
    actor: User,
    *,
    full_name: str,
    member_type: str,
    membership_number: str | None = None,
    national_id_or_cr: str | None = None,
    gender: str | None = None,
    birth_date: date | None = None,
    phone: str | None = None,
    email: str | None = None,
    address: str | None = None,
    qualification: str | None = None,
    city: str | None = None,
    occupation: str | None = None,
    join_date: date | None = None,
    is_founder: bool = False,
    notes: str | None = None,
) -> Member:
    _check_unique_fields(session, None, membership_number, national_id_or_cr)
    member = Member(
        full_name=full_name,
        membership_number=membership_number,
        member_type=member_type,
        national_id_or_cr=national_id_or_cr,
        gender=gender,
        birth_date=birth_date,
        phone=phone,
        email=email,
        address=address,
        qualification=qualification,
        city=city,
        occupation=occupation,
        join_date=join_date or date.today(),
        is_founder=is_founder,
        status=MemberStatus.PENDING,
        notes=notes,
    )
    session.add(member)
    session.flush()
    log_action(session, actor, "submit_membership_request", "member", member.id)
    session.commit()
    return member


def approve_membership(session: Session, actor: User, member: Member) -> None:
    if member.status not in (MemberStatus.PENDING, MemberStatus.SUSPENDED):
        raise MembershipError("لا يمكن قبول عضو ليس في حالة طلب معلّق أو موقوف")
    member.status = MemberStatus.ACTIVE
    log_action(session, actor, "approve_membership", "member", member.id)
    session.commit()


def reject_membership(session: Session, actor: User, member: Member, reason: str) -> None:
    if member.status != MemberStatus.PENDING:
        raise MembershipError("لا يمكن رفض عضو ليس في حالة طلب معلّق")
    member.status = MemberStatus.REJECTED
    member.notes = ((member.notes or "") + f"\nسبب الرفض: {reason}").strip()
    log_action(session, actor, "reject_membership", "member", member.id, details=reason)
    session.commit()


def suspend_membership(session: Session, actor: User, member: Member, reason: str) -> None:
    member.status = MemberStatus.SUSPENDED
    member.notes = ((member.notes or "") + f"\nسبب الإيقاف: {reason}").strip()
    log_action(session, actor, "suspend_membership", "member", member.id, details=reason)
    session.commit()


def withdraw_membership(session: Session, actor: User, member: Member) -> None:
    member.status = MemberStatus.WITHDRAWN
    log_action(session, actor, "withdraw_membership", "member", member.id)
    session.commit()


def delete_member(session: Session, actor: User, member: Member) -> None:
    """حذف عضو نهائيًا (لتصحيح تكرار ناتج عن استيراد، مثلًا). يُرفض الحذف إن كان للعضو سجل حضور/توكيل
    في اجتماع سابق للجمعية العمومية — استخدم إيقاف العضوية أو تسجيل الانسحاب في هذه الحالة بدلًا من الحذف."""
    has_history = (
        session.query(AssemblyAttendance)
        .filter(
            (AssemblyAttendance.member_id == member.id) | (AssemblyAttendance.proxy_holder_member_id == member.id)
        )
        .first()
    )
    if has_history is not None:
        raise MembershipError(
            "لا يمكن حذف هذا العضو لوجود سجل حضور/توكيل مرتبط به في اجتماع سابق للجمعية العمومية. "
            "استخدم \"إيقاف العضوية\" أو \"تسجيل انسحاب\" بدلًا من الحذف."
        )
    member_id = member.id
    details = f"{member.full_name} ({member.membership_number or '—'})"
    session.delete(member)
    log_action(session, actor, "delete_member", "member", member_id, details=details)
    session.commit()


def update_member(session: Session, actor: User, member: Member, **fields) -> Member:
    for key in fields:
        if not hasattr(member, key):
            raise MembershipError(f"حقل غير معروف: {key}")
    _check_unique_fields(
        session,
        member.id,
        fields.get("membership_number", member.membership_number),
        fields.get("national_id_or_cr", member.national_id_or_cr),
    )
    for key, value in fields.items():
        setattr(member, key, value)
    log_action(session, actor, "update_member", "member", member.id)
    session.commit()
    return member


def record_fee_payment(
    session: Session,
    actor: User,
    member: Member,
    *,
    fee_year: int,
    amount: float,
    paid_date: date | None = None,
    payment_method: str | None = None,
    receipt_number: str | None = None,
) -> MembershipFee:
    fee = (
        session.query(MembershipFee)
        .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == fee_year)
        .first()
    )
    if fee is None:
        fee = MembershipFee(member_id=member.id, fee_year=fee_year)
        session.add(fee)
    fee.amount = amount
    fee.paid_date = paid_date or date.today()
    fee.payment_method = payment_method
    fee.receipt_number = receipt_number
    fee.status = FeeStatus.PAID
    session.flush()
    log_action(session, actor, "record_fee_payment", "membership_fee", fee.id, details=f"year={fee_year}")
    session.commit()
    return fee


def list_members(
    session: Session, status: MemberStatus | None = None, search: str | None = None
) -> list[Member]:
    query = session.query(Member)
    if status is not None:
        query = query.filter(Member.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter(Member.full_name.ilike(like))
    return query.order_by(Member.full_name).all()


def list_unpaid_active_members(session: Session, fee_year: int | None = None) -> list[Member]:
    """الأعضاء النشطون الذين لم يُسجَّل لهم سداد اشتراك (مقبول أو معفى) عن السنة المحددة."""
    fee_year = fee_year or date.today().year
    paid_member_ids = session.query(MembershipFee.member_id).filter(
        MembershipFee.fee_year == fee_year, MembershipFee.status.in_([FeeStatus.PAID, FeeStatus.WAIVED])
    )
    return (
        session.query(Member)
        .filter(Member.status == MemberStatus.ACTIVE, ~Member.id.in_(paid_member_ids))
        .order_by(Member.full_name)
        .all()
    )

