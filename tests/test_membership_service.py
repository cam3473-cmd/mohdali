from datetime import date

import pytest

from app.db.models import MemberStatus
from app.services import membership_service


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

