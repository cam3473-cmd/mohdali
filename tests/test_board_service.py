from datetime import date

from app.services import board_service, membership_service


def _make_member(db_session, admin_user, name: str) -> object:
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name=name, member_type="عادية", join_date=date(2015, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)
    return member


def test_list_current_positions_orders_chairman_first_then_vice_then_rest(db_session, admin_user):
    member_c = _make_member(db_session, admin_user, "عضو ج")
    member_a = _make_member(db_session, admin_user, "عضو أ")
    member_vice = _make_member(db_session, admin_user, "نائب الرئيس")
    member_chair = _make_member(db_session, admin_user, "الرئيس")
    member_treasurer = _make_member(db_session, admin_user, "أمين الصندوق")

    board_service.assign_position(db_session, admin_user, member_c, title="عضو مجلس إدارة")
    board_service.assign_position(db_session, admin_user, member_a, title="عضو مجلس إدارة")
    board_service.assign_position(db_session, admin_user, member_treasurer, title="أمين الصندوق (المشرف المالي)")
    board_service.assign_position(db_session, admin_user, member_vice, title="نائب رئيس مجلس الإدارة")
    board_service.assign_position(db_session, admin_user, member_chair, title="رئيس مجلس الإدارة")

    positions = board_service.list_current_positions(db_session)
    titles_in_order = [p.title for p in positions]

    assert titles_in_order[0] == "رئيس مجلس الإدارة"
    assert titles_in_order[1] == "نائب رئيس مجلس الإدارة"
    assert titles_in_order[2] == "أمين الصندوق (المشرف المالي)"
    # بقية الأعضاء بعد الرتب الأساسية، مرتبة أبجديًا بالاسم
    assert titles_in_order[3:] == ["عضو مجلس إدارة", "عضو مجلس إدارة"]


def test_update_and_delete_position(db_session, admin_user):
    member = _make_member(db_session, admin_user, "عضو للتعديل")
    other_member = _make_member(db_session, admin_user, "عضو آخر")
    position = board_service.assign_position(db_session, admin_user, member, title="عضو مجلس إدارة")

    board_service.update_position(
        db_session, admin_user, position, other_member, title="أمين السر", start_date=date(2024, 1, 1)
    )
    assert position.member_id == other_member.id
    assert position.title == "أمين السر"

    position_id = position.id
    board_service.delete_position(db_session, admin_user, position)
    remaining = board_service.list_current_positions(db_session)
    assert position_id not in [p.id for p in remaining]
