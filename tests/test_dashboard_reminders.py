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
