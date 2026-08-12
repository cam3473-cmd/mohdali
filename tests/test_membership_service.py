from datetime import date

import pytest

from app.db.models import AssemblyType, MemberStatus
from app.services import assembly_service, membership_service


def test_submit_and_approve_membership(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="أحمد علي", member_type="عامل", join_date=date.today()
    )
    assert member.status == MemberStatus.PENDING

    membership_service.approve_membership(db_session, admin_user, member)
    assert member.status == MemberStatus.ACTIVE


def test_cannot_approve_already_active_member(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="سعيد محمد", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    with pytest.raises(membership_service.MembershipError):
        membership_service.approve_membership(db_session, admin_user, member)


def test_reject_membership_records_reason(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="خالد سالم", member_type="عامل", join_date=date.today()
    )
    membership_service.reject_membership(db_session, admin_user, member, reason="عدم استيفاء الشروط")
    assert member.status == MemberStatus.REJECTED
    assert "عدم استيفاء الشروط" in member.notes


def test_record_fee_payment_updates_status(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="منى فهد", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    fee = membership_service.record_fee_payment(
        db_session, admin_user, member, fee_year=date.today().year, amount=150
    )
    assert fee.status.value == "paid"
    assert fee.amount == 150


def test_delete_member_removes_duplicate_without_history(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="نسخة مكررة", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)
    member_id = member.id

    membership_service.delete_member(db_session, admin_user, member)

    assert db_session.get(type(member), member_id) is None


def test_delete_member_blocked_when_has_assembly_attendance(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو له سجل حضور", member_type="عامل", join_date=join_date
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)

    assembly = assembly_service.create_assembly(
        db_session, admin_user, title="اجتماع اختبار الحذف", type=AssemblyType.ORDINARY, meeting_date=date.today()
    )
    assembly_service.open_assembly(db_session, admin_user, assembly)
    assembly_service.check_in_member(db_session, admin_user, assembly, member)

    with pytest.raises(membership_service.MembershipError, match="سجل حضور"):
        membership_service.delete_member(db_session, admin_user, member)

