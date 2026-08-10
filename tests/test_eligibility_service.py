from datetime import date

from app.services import membership_service
from app.services.eligibility_service import check_eligibility


def _make_member(db_session, admin_user, join_date, member_type="عامل", is_founder=False, paid=True):
    member = membership_service.submit_membership_request(
        db_session,
        admin_user,
        full_name="عضو اختبار",
        member_type=member_type,
        join_date=join_date,
        is_founder=is_founder,
    )
    membership_service.approve_membership(db_session, admin_user, member)
    if paid:
        membership_service.record_fee_payment(
            db_session, admin_user, member, fee_year=date.today().year, amount=100
        )
    return member


def test_member_under_minimum_duration_is_not_eligible(db_session, admin_user):
    member = _make_member(db_session, admin_user, join_date=date.today())
    result = check_eligibility(db_session, member, as_of_date=date.today())
    assert not result.eligible
    assert any("مدة العضوية" in r for r in result.reasons)


def test_member_over_minimum_duration_with_paid_fee_is_eligible(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = _make_member(db_session, admin_user, join_date=join_date)
    result = check_eligibility(db_session, member, as_of_date=date.today())
    assert result.eligible, result.reasons


def test_founder_exempt_from_duration_requirement(db_session, admin_user):
    member = _make_member(db_session, admin_user, join_date=date.today(), is_founder=True)
    result = check_eligibility(db_session, member, as_of_date=date.today())
    assert result.eligible, result.reasons


def test_unpaid_fee_makes_member_ineligible(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = _make_member(db_session, admin_user, join_date=join_date, paid=False)
    result = check_eligibility(db_session, member, as_of_date=date.today())
    assert not result.eligible
    assert any("سداد" in r for r in result.reasons)


def test_non_voting_member_type_is_ineligible(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = _make_member(db_session, admin_user, join_date=join_date, member_type="منتسب")
    result = check_eligibility(db_session, member, as_of_date=date.today())
    assert not result.eligible

