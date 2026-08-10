"""شاشة الإعدادات: اللائحة الأساسية، المستخدمون، النسخ الاحتياطي."""
from __future__ import annotations

import shutil
from datetime import datetime

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import AuthService, has_permission
from app.db.models import User
from app.db.session import get_db_path
from app.services import bylaw_settings_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.settings.user_form_dialog import ROLE_LABELS, UserFormDialog


class SettingsView(QTabWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        self.addTab(BylawSettingsTab(ctx), "اللائحة الأساسية")
        if has_permission(ctx.current_user, "users.manage"):
            self.addTab(UsersTab(ctx), "المستخدمون")
        self.addTab(BackupTab(ctx), "النسخ الاحتياطي")


class BylawSettingsTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self._can_manage = has_permission(ctx.current_user, "settings.manage")

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "<b>ملاحظة:</b> راجع هذه القيم وفق اللائحة الأساسية المعتمدة رسميًا للجمعية "
                "من المركز الوطني لتنمية القطاع غير الربحي قبل الاعتماد عليها."
            )
        )

        self.table = QTableWidget(0, 2)
        self.table.setHorizontalHeaderLabels(["الوصف", "القيمة"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        layout.addWidget(self.table)

        save_btn = QPushButton("حفظ التغييرات")
        save_btn.setEnabled(self._can_manage)
        save_btn.clicked.connect(self._on_save)
        layout.addWidget(save_btn)

        self._keys: list[str] = []
        self.refresh()

    def refresh(self) -> None:
        settings = bylaw_settings_service.list_settings(self.ctx.session)
        self._keys = [s.key for s in settings]
        self.table.setRowCount(0)
        for setting in settings:
            row = self.table.rowCount()
            self.table.insertRow(row)
            self.table.setItem(row, 0, QTableWidgetItem(setting.description or setting.key))
            value_item = QTableWidgetItem(setting.value)
            if not self._can_manage:
                value_item.setFlags(value_item.flags() & ~Qt.ItemFlag.ItemIsEditable)
            self.table.setItem(row, 1, value_item)

    def _on_save(self) -> None:
        for row, key in enumerate(self._keys):
            value = self.table.item(row, 1).text().strip()
            try:
                bylaw_settings_service.update_setting(self.ctx.session, self.ctx.current_user, key, value)
            except ValueError as exc:
                show_error(self, str(exc))
                return
        show_info(self, "تم حفظ الإعدادات بنجاح")
        self.refresh()


class UsersTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx

        layout = QVBoxLayout(self)
        toolbar = QHBoxLayout()
        toolbar.addStretch()
        add_btn = QPushButton("إضافة مستخدم")
        add_btn.clicked.connect(self._on_add)
        toolbar.addWidget(add_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(["اسم المستخدم", "الاسم الكامل", "الدور", "نشط"])
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        layout.addWidget(self.table)

        toggle_btn = QPushButton("تفعيل/إيقاف المستخدم المحدد")
        toggle_btn.clicked.connect(self._on_toggle_active)
        layout.addWidget(toggle_btn)

        self.refresh()

    def refresh(self) -> None:
        auth = AuthService(self.ctx.session)
        users = auth.list_users()
        self.table.setRowCount(0)
        for user in users:
            row = self.table.rowCount()
            self.table.insertRow(row)
            username_item = QTableWidgetItem(user.username)
            username_item.setData(Qt.ItemDataRole.UserRole, user.id)
            self.table.setItem(row, 0, username_item)
            self.table.setItem(row, 1, QTableWidgetItem(user.full_name))
            self.table.setItem(row, 2, QTableWidgetItem(ROLE_LABELS.get(user.role, user.role.value)))
            self.table.setItem(row, 3, QTableWidgetItem("نعم" if user.active else "لا"))

    def _on_add(self) -> None:
        dialog = UserFormDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            auth = AuthService(self.ctx.session)
            try:
                auth.create_user(self.ctx.current_user, **dialog.values)
                self.refresh()
            except Exception as exc:  # noqa: BLE001
                show_error(self, str(exc))

    def _on_toggle_active(self) -> None:
        row = self.table.currentRow()
        if row < 0:
            return
        user_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        user = self.ctx.session.get(User, user_id)
        if user.id == self.ctx.current_user.id:
            show_error(self, "لا يمكنك إيقاف حسابك الحالي")
            return
        auth = AuthService(self.ctx.session)
        auth.set_active(self.ctx.current_user, user, not user.active)
        self.refresh()


class BackupTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(f"مسار قاعدة البيانات الحالية:\n{get_db_path()}"))

        export_btn = QPushButton("تصدير نسخة احتياطية")
        export_btn.clicked.connect(self._on_export)
        layout.addWidget(export_btn)

        import_btn = QPushButton("استعادة نسخة احتياطية")
        import_btn.clicked.connect(self._on_import)
        layout.addWidget(import_btn)

        layout.addStretch()

    def _on_export(self) -> None:
        default_name = f"نسخة-احتياطية-{datetime.now().strftime('%Y-%m-%d_%H%M')}.db"
        path, _ = QFileDialog.getSaveFileName(self, "حفظ نسخة احتياطية", default_name, "SQLite (*.db)")
        if not path:
            return
        self.ctx.session.commit()
        shutil.copy(get_db_path(), path)
        show_info(self, f"تم حفظ النسخة الاحتياطية في: {path}")

    def _on_import(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "اختيار نسخة احتياطية", "", "SQLite (*.db)")
        if not path:
            return
        if not confirm(self, "سيتم استبدال قاعدة البيانات الحالية بالكامل بهذه النسخة. تأكد من أخذ نسخة احتياطية حديثة أولًا. متابعة؟"):
            return
        shutil.copy(path, get_db_path())
        show_info(self, "تم استيراد النسخة الاحتياطية. الرجاء إعادة تشغيل التطبيق الآن لتحميل البيانات المستعادة.")

