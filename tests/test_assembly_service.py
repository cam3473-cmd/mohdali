from datetime import date

import pytest

from app.db.models import AssemblyRound, AssemblyStatus, AssemblyType, AttendanceType
from app.services import assembly_service, membership_service
from app.services.bylaw_settings_service import update_setting


def _eligible_member(db_session, admin_user, name="عضو"):
    join_date = date.today().replace(year=date.today().year - 1)
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name=name, member_type="عامل", join_date=join_date
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)
    return member


def _open_assembly(db_session, admin_user):
    assembly = assembly_service.create_assembly(
        db_session, admin_user, title="اجتماع اختبار", type=AssemblyType.ORDINARY, meeting_date=date.today()
    )
    assembly_service.open_assembly(db_session, admin_user, assembly)
    return assembly


def test_quorum_not_met_then_met_after_checkins(db_session, admin_user):
    members = [_eligible_member(db_session, admin_user, f"عضو{i}") for i in range(4)]
    assembly = _open_assembly(db_session, admin_user)

    quorum = assembly_service.compute_quorum(db_session, assembly)
    assert quorum.eligible_count == 4
    assert quorum.attendee_count == 0
    assert not quorum.met

    assembly_service.check_in_member(db_session, admin_user, assembly, members[0])
    quorum = assembly_service.compute_quorum(db_session, assembly)
    assert quorum.percent == 25.0
    assert not quorum.met  # النصاب الافتراضي للجولة الأولى 50%

    for m in members[1:3]:
        assembly_service.check_in_member(db_session, admin_user, assembly, m)
    quorum = assembly_service.compute_quorum(db_session, assembly)
    assert quorum.attendee_count == 3
    assert quorum.met


def test_second_round_uses_lower_quorum(db_session, admin_user):
    members = [_eligible_member(db_session, admin_user, f"عضو{i}") for i in range(4)]
    assembly = _open_assembly(db_session, admin_user)
    assembly_service.move_to_second_round(db_session, admin_user, assembly)
    assert assembly.round == AssemblyRound.SECOND

    assembly_service.check_in_member(db_session, admin_user, assembly, members[0])
    quorum = assembly_service.compute_quorum(db_session, assembly)
    assert quorum.required_percent == 25.0
    assert quorum.met


def test_cannot_check_in_same_member_twice(db_session, admin_user):
    member = _eligible_member(db_session, admin_user)
    assembly = _open_assembly(db_session, admin_user)
    assembly_service.check_in_member(db_session, admin_user, assembly, member)
    with pytest.raises(assembly_service.AssemblyError):
        assembly_service.check_in_member(db_session, admin_user, assembly, member)


def test_proxy_attendance_requires_eligible_holder(db_session, admin_user):
    absent_member = _eligible_member(db_session, admin_user, "غائب")
    holder = _eligible_member(db_session, admin_user, "حامل توكيل")
    assembly = _open_assembly(db_session, admin_user)

    attendance = assembly_service.check_in_member(
        db_session, admin_user, assembly, absent_member, attendance_type=AttendanceType.PROXY, proxy_holder=holder
    )
    assert attendance.proxy_holder_member_id == holder.id


def test_proxy_limit_enforced(db_session, admin_user):
    update_setting(db_session, admin_user, "max_proxies_per_holder", "1")
    holder = _eligible_member(db_session, admin_user, "حامل")
    absent1 = _eligible_member(db_session, admin_user, "غائب1")
    absent2 = _eligible_member(db_session, admin_user, "غائب2")
    assembly = _open_assembly(db_session, admin_user)

    assembly_service.check_in_member(
        db_session, admin_user, assembly, absent1, attendance_type=AttendanceType.PROXY, proxy_holder=holder
    )
    with pytest.raises(assembly_service.AssemblyError):
        assembly_service.check_in_member(
            db_session, admin_user, assembly, absent2, attendance_type=AttendanceType.PROXY, proxy_holder=holder
        )


def test_decision_approved_with_normal_majority(db_session, admin_user):
    assembly = _open_assembly(db_session, admin_user)
    decision = assembly_service.add_decision(db_session, admin_user, assembly, "اعتماد الميزانية")
    assembly_service.record_vote(db_session, admin_user, decision, votes_for=6, votes_against=4, votes_abstain=0)
    assert decision.result.value == "approved"


def test_decision_rejected_when_special_majority_not_met(db_session, admin_user):
    assembly = _open_assembly(db_session, admin_user)
    decision = assembly_service.add_decision(
        db_session, admin_user, assembly, "تعديل اللائحة الأساسية", requires_special_majority=True
    )
    # 60% موافقة لا تكفي لأغلبية خاصة افتراضية 66.67%
    assembly_service.record_vote(db_session, admin_user, decision, votes_for=6, votes_against=4, votes_abstain=0)
    assert decision.result.value == "rejected"

