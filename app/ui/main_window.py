"""النافذة الرئيسية للتطبيق."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QIcon
from PySide6.QtWidgets import QHBoxLayout, QLabel, QMainWindow, QMessageBox, QTabWidget, QVBoxLayout, QWidget

from app.auth.service import has_permission
from app.services import backup_service, board_service, bylaw_settings_service
from app.ui.app_context import AppContext
from app.ui.assembly.assembly_list_view import AssemblyListView
from app.ui.board.board_view import BoardView
from app.ui.common import load_logo_pixmap
from app.ui.dashboard_view import DashboardView
from app.ui.documents.documents_view import DocumentsView
from app.ui.members.members_view import MembersView
from app.ui.settings.settings_view import SettingsView

BOARD_TERM_ALERT_THRESHOLD_DAYS = 200


class MainWindow(QMainWindow):
    def __init__(self, ctx: AppContext):
        super().__init__()
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setWindowTitle("نظام عضوية الجمعية العمومية — جمعية البر الخيرية بمحافظة السليل")
        self._size_to_screen()

        logo_pixmap = load_logo_pixmap(max_height=40)
        if logo_pixmap is not None:
            self.setWindowIcon(QIcon(logo_pixmap))

        central = QWidget()
        central_layout = QVBoxLayout(central)
        central_layout.setContentsMargins(0, 0, 0, 0)

        if logo_pixmap is not None:
            header = QWidget()
            header_layout = QHBoxLayout(header)
            logo_label = QLabel()
            logo_label.setPixmap(logo_pixmap)
            title_label = QLabel("<h3>جمعية البر الخيرية بمحافظة السليل</h3>")
            header_layout.addWidget(logo_label)
            header_layout.addWidget(title_label)
            header_layout.addStretch()
            central_layout.addWidget(header)

        tabs = QTabWidget()
        tabs.addTab(DashboardView(ctx), "الرئيسية")
        tabs.addTab(MembersView(ctx), "الأعضاء")
        tabs.addTab(AssemblyListView(ctx), "الجمعية العمومية")
        tabs.addTab(BoardView(ctx), "مجلس الإدارة")
        tabs.addTab(DocumentsView(ctx), "الوثائق")
        if has_permission(ctx.current_user, "settings.manage") or has_permission(ctx.current_user, "users.manage"):
            tabs.addTab(SettingsView(ctx), "الإعدادات")
        central_layout.addWidget(tabs)

        self.setCentralWidget(central)

        self.statusBar().showMessage(f"المستخدم الحالي: {ctx.current_user.full_name}")
        logout_action = self.menuBar().addAction("تسجيل الخروج")
        logout_action.triggered.connect(self._on_logout)

        self._check_board_term_alert()

    def _check_board_term_alert(self) -> None:
        term_end_date = bylaw_settings_service.get_settings(self.ctx.session).board_term_end_date
        if not board_service.term_alert_needed(term_end_date, threshold_days=BOARD_TERM_ALERT_THRESHOLD_DAYS):
            return
        status_text = board_service.term_status_text(term_end_date)
        QMessageBox.warning(self, "تنبيه: دورة مجلس الإدارة", status_text)

    def closeEvent(self, event) -> None:  # noqa: N802 - اسم الدالة مفروض من Qt
        try:
            self.ctx.session.commit()
            backup_service.run_auto_backup_if_due()
        except Exception:  # noqa: BLE001 - يجب ألا يمنع فشل النسخ الاحتياطي إغلاق البرنامج
            pass
        super().closeEvent(event)

    def _size_to_screen(self) -> None:
        """يضبط حجم النافذة وفق الشاشة المتاحة حتى لا يختفي الجزء السفلي على الشاشات الصغيرة."""
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            self.resize(1000, 700)
            return
        available = screen.availableGeometry()
        width = min(1100, int(available.width() * 0.92))
        height = min(780, int(available.height() * 0.9))
        self.resize(width, height)
        self.move(available.center() - self.rect().center())

    def _on_logout(self) -> None:
        self.ctx.auth.logout()
        QMessageBox.information(self, "تسجيل الخروج", "تم تسجيل الخروج. الرجاء إعادة تشغيل التطبيق لتسجيل الدخول مجددًا.")
        self.close()

