"""نموذج تسجيل حضور عضو في اجتماع الجمعية العمومية."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QComboBox, QDialog, QDialogButtonBox, QFormLayout, QVBoxLayout

from app.db.models import AttendanceType, Member

ATTENDANCE_LABELS = {AttendanceType.IN_PERSON: "حضور شخصي", AttendanceType.PROXY: "بالتوكيل"}


class CheckInDialog(QDialog):
    def __init__(self, parent, eligible_members: list[Member], not_yet_checked_in: list[Member]):
        super().__init__(parent)
        self.setWindowTitle("تسجيل حضور")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.member_combo = QComboBox()
        for m in not_yet_checked_in:
            self.member_combo.addItem(m.full_name, m.id)

        self.attendance_type = QComboBox()
        for t, label in ATTENDANCE_LABELS.items():
            self.attendance_type.addItem(label, t)
        self.attendance_type.currentIndexChanged.connect(self._on_type_changed)

        self.proxy_holder_combo = QComboBox()
        for m in eligible_members:
            self.proxy_holder_combo.addItem(m.full_name, m.id)
        self.proxy_holder_combo.setEnabled(False)

        form.addRow("العضو:*", self.member_combo)
        form.addRow("نوع الحضور:", self.attendance_type)
        form.addRow("حامل التوكيل:", self.proxy_holder_combo)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("تسجيل")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_type_changed(self) -> None:
        is_proxy = self.attendance_type.currentData() == AttendanceType.PROXY
        self.proxy_holder_combo.setEnabled(is_proxy)

    def _on_accept(self) -> None:
        if self.member_combo.count() == 0:
            self.reject()
            return
        is_proxy = self.attendance_type.currentData() == AttendanceType.PROXY
        self.values = {
            "member_id": self.member_combo.currentData(),
            "attendance_type": self.attendance_type.currentData(),
            "proxy_holder_id": self.proxy_holder_combo.currentData() if is_proxy else None,
        }
        self.accept()

