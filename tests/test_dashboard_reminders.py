from datetime import date

from app.services import audit, membership_service


def test_list_unpaid_active_members_excludes_paid_and_inactive(db_session, admin_user):
    paid = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو سدد", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, paid)
    membership_service.record_fee_payment(db_session, admin_user, paid, fee_year=date.today().year, amount=300)

    unpaid = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو لم يسدد", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, unpaid)

    pending = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو معلق", member_type="عادية", join_date=date(2020, 1, 1)
    )

    result = membership_service.list_unpaid_active_members(db_session)
    names = {m.full_name for m in result}
    assert names == {"عضو لم يسدد"}


def test_compute_member_arrears_counts_years_since_join_when_never_paid(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="لم يسدد أبدًا", member_type="عادية", join_date=date(2023, 6, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)

    arrears = membership_service.compute_member_arrears(db_session, member, as_of_year=2026)
    assert arrears.unpaid_years == [2023, 2024, 2025, 2026]
    assert arrears.years_count == 4
    assert arrears.estimated_amount == 4 * 300


def test_compute_member_arrears_counts_only_gap_years_since_last_payment(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="سدد ثم توقف", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=2023, amount=300)

    arrears = membership_service.compute_member_arrears(db_session, member, as_of_year=2026)
    assert arrears.unpaid_years == [2020, 2021, 2022, 2024, 2025, 2026]
    assert arrears.years_count == 6


def test_compute_member_arrears_zero_when_supporting_member_prepaid_future_years(db_session, admin_user):
    """حالة العضو الداعم الذي يدفع مبلغًا كبيرًا مقدمًا يغطي عدة سنوات — لا يظهر متأخرًا طالما سُجِّل سند لكل سنة."""
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو داعم", member_type="داعم", join_date=date(2023, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)
    for year in (2023, 2024, 2025, 2026):
        membership_service.record_fee_payment(db_session, admin_user, member, fee_year=year, amount=25000)

    arrears = membership_service.compute_member_arrears(db_session, member, as_of_year=2026)
    assert arrears.unpaid_years == []
    assert arrears.estimated_amount == 0


def test_list_members_with_arrears_sorted_most_overdue_first(db_session, admin_user):
    old = membership_service.submit_membership_request(
        db_session, admin_user, full_name="متأخر قديم", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, old)
    recent = membership_service.submit_membership_request(
        db_session, admin_user, full_name="متأخر حديث", member_type="عادية", join_date=date(2025, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, recent)
    paid_up = membership_service.submit_membership_request(
        db_session, admin_user, full_name="مسدد بالكامل", member_type="عادية", join_date=date(2026, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, paid_up)
    membership_service.record_fee_payment(db_session, admin_user, paid_up, fee_year=2026, amount=300)

    result = membership_service.list_members_with_arrears(db_session, as_of_year=2026)
    names_in_order = [a.member.full_name for a in result]
    assert names_in_order == ["متأخر قديم", "متأخر حديث"]


def test_list_members_with_arrears_includes_suspended_members(db_session, admin_user):
    """علة سابقة: الأعضاء الموقوفون (وهم الأكثر عرضة للتأخر عن السداد) كانوا مستبعدين كليًا من هذه القائمة."""
    suspended = membership_service.submit_membership_request(
        db_session, admin_user, full_name="موقوف ومتأخر", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, suspended)
    membership_service.record_fee_payment(db_session, admin_user, suspended, fee_year=2024, amount=300)
    membership_service.suspend_membership(db_session, admin_user, suspended, reason="تأخر عن السداد")

    result = membership_service.list_members_with_arrears(db_session, as_of_year=2026)
    names = {a.member.full_name for a in result}
    assert "موقوف ومتأخر" in names

    entry = next(a for a in result if a.member.full_name == "موقوف ومتأخر")
    assert entry.unpaid_years == [2020, 2021, 2022, 2023, 2025, 2026]


def test_audit_log_records_and_lists_recent_actions(db_session, admin_user):
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو للتدقيق", member_type="عادية", join_date=date(2020, 1, 1)
    )
    entries = audit.list_recent(db_session)
    assert any(e.action == "submit_membership_request" for e in entries)


def test_audit_log_search_filters_by_action(db_session, admin_user):
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو آخر للتدقيق", member_type="عادية", join_date=date(2020, 1, 1)
    )
    matches = audit.list_recent(db_session, search="submit_membership")
    assert len(matches) >= 1
    no_matches = audit.list_recent(db_session, search="لا شيء بهذا الاسم")
    assert no_matches == []
