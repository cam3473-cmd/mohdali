"""شاشة الإعدادات: اللائحة الأساسية، المستخدمون، البريد الإلكتروني، النسخ الاحتياطي."""
from __future__ import annotations

from datetime import datetime

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QLineEdit,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import AuthService, has_permission
from app.db.models import User
from app.db.session import get_db_path
from app.paths import default_backups_dir, ensure_default_backups_dir
from app.services import backup_service, bylaw_settings_service, smtp_settings_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.settings.audit_log_tab import AuditLogTab
from app.ui.settings.user_form_dialog import ROLE_LABELS, UserFormDialog


class SettingsView(QTabWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        self.addTab(BylawSettingsTab(ctx), "اللائحة الأساسية")
        if has_permission(ctx.current_user, "users.manage"):
            self.addTab(UsersTab(ctx), "المستخدمون")
            self.addTab(SmtpSettingsTab(ctx), "البريد الإلكتروني")
            self.addTab(AuditLogTab(ctx), "سجل التدقيق")
        self.addTab(BackupTab(ctx), "النسخ الاحتياطي")

        self.currentChanged.connect(self._on_tab_changed)

    def _on_tab_changed(self, index: int) -> None:
        # يحدّث محتوى التبويب فور فتحه لتفادي حفظ بيانات قديمة كانت معروضة قبل تغييرها من مكان آخر
        widget = self.widget(index)
        if hasattr(widget, "refresh"):
            widget.refresh()


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
        # يُستثنى "board_term_end_date" من هذا الجدول العام لأن له حقلًا مخصصًا في شاشة مجلس الإدارة؛
        # تحريره من هنا أيضًا قد يؤدي لمسحه بالخطأ إذا بقيت هذه الشاشة مفتوحة بقيمة قديمة ثم حُفظت.
        settings = [s for s in bylaw_settings_service.list_settings(self.ctx.session) if s.key != "board_term_end_date"]
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

        self.table = QTableWidget(0, 5)
        self.table.setHorizontalHeaderLabels(["اسم المستخدم", "الاسم الكامل", "البريد الإلكتروني", "الدور", "نشط"])
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        toggle_btn = QPushButton("تفعيل/إيقاف المستخدم المحدد")
        toggle_btn.clicked.connect(self._on_toggle_active)
        actions.addWidget(toggle_btn)
        email_btn = QPushButton("تعديل البريد الإلكتروني")
        email_btn.clicked.connect(self._on_edit_email)
        actions.addWidget(email_btn)
        layout.addLayout(actions)

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
            self.table.setItem(row, 2, QTableWidgetItem(user.email or "—"))
            self.table.setItem(row, 3, QTableWidgetItem(ROLE_LABELS.get(user.role, user.role.value)))
            self.table.setItem(row, 4, QTableWidgetItem("نعم" if user.active else "لا"))

    def _selected_user(self) -> User | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        user_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(User, user_id)

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
        user = self._selected_user()
        if user is None:
            return
        if user.id == self.ctx.current_user.id:
            show_error(self, "لا يمكنك إيقاف حسابك الحالي")
            return
        auth = AuthService(self.ctx.session)
        auth.set_active(self.ctx.current_user, user, not user.active)
        self.refresh()

    def _on_edit_email(self) -> None:
        user = self._selected_user()
        if user is None:
            return
        email, ok = QInputDialog.getText(self, "تعديل البريد الإلكتروني", f"البريد الإلكتروني لـ {user.username}:", text=user.email or "")
        if not ok:
            return
        auth = AuthService(self.ctx.session)
        auth.set_email(self.ctx.current_user, user, email.strip())
        self.refresh()


class SmtpSettingsTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "<b>ملاحظة:</b> تُستخدم هذه الإعدادات لإرسال رمز استعادة كلمة المرور عبر البريد. "
                "لحسابات Gmail يلزم استخدام «كلمة مرور تطبيق» (App Password) وليس كلمة المرور العادية."
            )
        )

        form = QFormLayout()
        self.host = QLineEdit()
        self.host.setPlaceholderText("مثال: smtp.gmail.com")
        self.port = QSpinBox()
        self.port.setRange(1, 65535)
        self.port.setValue(587)
        self.username = QLineEdit()
        self.username.setPlaceholderText("عنوان البريد المستخدم للإرسال")
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.EchoMode.Password)
        self.password.setPlaceholderText("اتركه فارغًا للإبقاء على القيمة الحالية")
        self.use_tls = QCheckBox("استخدام TLS")
        self.use_tls.setChecked(True)
        self.from_address = QLineEdit()
        self.from_address.setPlaceholderText("عنوان المرسِل الظاهر للمستلم")

        form.addRow("الخادم (Host):", self.host)
        form.addRow("المنفذ (Port):", self.port)
        form.addRow("اسم المستخدم:", self.username)
        form.addRow("كلمة المرور:", self.password)
        form.addRow("", self.use_tls)
        form.addRow("عنوان المرسِل:", self.from_address)
        layout.addLayout(form)

        save_btn = QPushButton("حفظ إعدادات البريد")
        save_btn.clicked.connect(self._on_save)
        layout.addWidget(save_btn)
        layout.addStretch()

        self.refresh()

    def refresh(self) -> None:
        settings = smtp_settings_service.get_settings(self.ctx.session)
        self.host.setText(settings.host or "")
        self.port.setValue(settings.port or 587)
        self.username.setText(settings.username or "")
        self.use_tls.setChecked(bool(settings.use_tls))
        self.from_address.setText(settings.from_address or "")

    def _on_save(self) -> None:
        smtp_settings_service.update_settings(
            self.ctx.session,
            host=self.host.text().strip(),
            port=self.port.value(),
            username=self.username.text().strip(),
            password=self.password.text(),
            use_tls=self.use_tls.isChecked(),
            from_address=self.from_address.text().strip(),
        )
        self.password.clear()
        show_info(self, "تم حفظ إعدادات البريد الإلكتروني")


class BackupTab(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx

        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(f"مسار قاعدة البيانات الحالية:\n{get_db_path()}"))
        layout.addWidget(QLabel(f"مجلد النسخ الاحتياطية الافتراضي:\n{default_backups_dir()}"))

        export_btn = QPushButton("تصدير نسخة احتياطية (تشمل قاعدة البيانات والمستندات)")
        export_btn.clicked.connect(self._on_export)
        layout.addWidget(export_btn)

        import_btn = QPushButton("استعادة نسخة احتياطية")
        import_btn.clicked.connect(self._on_import)
        layout.addWidget(import_btn)

        layout.addStretch()

    def _on_export(self) -> None:
        default_name = f"نسخة-احتياطية-{datetime.now().strftime('%Y-%m-%d_%H%M')}.zip"
        default_path = str(ensure_default_backups_dir() / default_name)
        path, _ = QFileDialog.getSaveFileName(self, "حفظ نسخة احتياطية", default_path, "Zip (*.zip)")
        if not path:
            return
        self.ctx.session.commit()
        try:
            backup_service.create_backup(path)
            show_info(self, f"تم حفظ النسخة الاحتياطية في: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر إنشاء النسخة الاحتياطية: {exc}")

    def _on_import(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "اختيار نسخة احتياطية", str(default_backups_dir()), "نسخة احتياطية (*.zip *.db)")
        if not path:
            return
        if not confirm(self, "سيتم استبدال قاعدة البيانات الحالية بالكامل بهذه النسخة. تأكد من أخذ نسخة احتياطية حديثة أولًا. متابعة؟"):
            return
        try:
            backup_service.restore_backup(path)
            show_info(self, "تم استيراد النسخة الاحتياطية. الرجاء إعادة تشغيل التطبيق الآن لتحميل البيانات المستعادة.")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر استعادة النسخة الاحتياطية: {exc}")
