from datetime import date

from app.services import membership_service
from app.reports.pdf_export import generate_membership_cards


def test_generate_membership_cards_for_active_and_suspended_members(db_session, admin_user, tmp_path):
    active = membership_service.submit_membership_request(
        db_session,
        admin_user,
        full_name="عضو فعال",
        member_type="عادية",
        membership_number="1",
        national_id_or_cr="1046952857",
        join_date=date(2020, 1, 1),
    )
    membership_service.approve_membership(db_session, admin_user, active)
    membership_service.record_fee_payment(db_session, admin_user, active, fee_year=date.today().year, amount=300)

    suspended = membership_service.submit_membership_request(
        db_session,
        admin_user,
        full_name="عضو موقوف",
        member_type="عادية",
        membership_number="27",
        national_id_or_cr="1019145984",
        join_date=date(2020, 1, 1),
    )
    membership_service.approve_membership(db_session, admin_user, suspended)
    membership_service.suspend_membership(db_session, admin_user, suspended, reason="اختبار")

    output_path = str(tmp_path / "cards.pdf")
    generate_membership_cards(db_session, [active, suspended], output_path)

    with open(output_path, "rb") as f:
        content = f.read()
    assert content.startswith(b"%PDF")
    assert len(content) > 1000


def test_generate_membership_cards_handles_member_without_national_id(db_session, admin_user, tmp_path):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="بدون هوية", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)

    output_path = str(tmp_path / "cards_no_id.pdf")
    generate_membership_cards(db_session, [member], output_path)

    with open(output_path, "rb") as f:
        assert f.read().startswith(b"%PDF")

