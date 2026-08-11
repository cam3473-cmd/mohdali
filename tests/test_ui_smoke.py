"""فحص دخان: التأكد من أن جميع شاشات الواجهة تُقلع دون أخطاء (بيئة offscreen)."""
from datetime import date

from app.auth.service import AuthService
from app.db.models import AssemblyType
from app.services import assembly_service, board_service, membership_service
from app.ui.app_context import AppContext
from app.ui.assembly.assembly_detail_view import AssemblyDetailView
from app.ui.assembly.assembly_list_view import AssemblyListView
from app.ui.board.board_view import BoardView
from app.ui.dashboard_view import DashboardView
from app.ui.documents.documents_view import DocumentsView
from app.ui.forgot_password_dialog import ForgotPasswordDialog
from app.ui.main_window import MainWindow
from app.ui.members.import_dialog import ImportDialog
from app.ui.members.members_view import MembersView
from app.ui.settings.settings_view import SettingsView


def _make_ctx(db_session, admin_user) -> AppContext:
    auth = AuthService(db_session)
    auth.current_user = admin_user
    return AppContext(session=db_session, auth=auth)


def _seed_sample_data(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو تجريبي", member_type="عامل", join_date=join_date
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)

    assembly = assembly_service.create_assembly(
        db_session, admin_user, title="اجتماع تجريبي", type=AssemblyType.ORDINARY, meeting_date=date.today()
    )
    assembly_service.add_agenda_item(db_session, admin_user, assembly, "بند تجريبي")
    return member, assembly


def test_dashboard_view_builds(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    view = DashboardView(ctx)
    assert "عضو تجريبي" not in view.summary_label.text()  # الملخص لا يعرض الأسماء، فقط الأعداد
    assert "1" in view.summary_label.text()


def test_members_view_builds_and_lists_members(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    view = MembersView(ctx)
    assert view.table.rowCount() == 1


def test_assembly_list_and_detail_views_build(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _member, assembly = _seed_sample_data(db_session, admin_user)
    list_view = AssemblyListView(ctx)
    assert list_view.table.rowCount() == 1

    detail_view = AssemblyDetailView(ctx, assembly.id)
    assert detail_view.agenda_list.count() == 1


def test_board_view_builds(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    member, _assembly = _seed_sample_data(db_session, admin_user)
    board_service.assign_position(db_session, admin_user, member, title="رئيس مجلس الإدارة")
    view = BoardView(ctx)
    assert view.table.rowCount() == 1


def test_import_dialog_builds(qapp, db_session, admin_user):
    dialog = ImportDialog()
    assert dialog.sheet_combo.count() == 0


def test_settings_view_builds(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    view = SettingsView(ctx)
    assert view.count() >= 2  # اللائحة الأساسية + المستخدمون + النسخ الاحتياطي


def test_main_window_builds_with_all_tabs(qapp, db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    window = MainWindow(ctx)
    assert window.windowTitle()


def test_documents_view_builds(qapp, db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))
    ctx = _make_ctx(db_session, admin_user)
    view = DocumentsView(ctx)
    assert view.table.rowCount() == 0


def test_forgot_password_dialog_builds(qapp, db_session):
    dialog = ForgotPasswordDialog(db_session)
    assert dialog.confirm_btn.isVisible() is False

