"""نماذج إضافة قرار وتسجيل نتيجة التصويت."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QSpinBox,
    QTextEdit,
    QVBoxLayout,
)


class DecisionDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("إضافة قرار للتصويت")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(400)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.decision_text = QTextEdit()
        self.decision_text.setFixedHeight(70)
        self.special_majority = QCheckBox("يتطلب أغلبية خاصة (كتعديل اللائحة الأساسية أو حل الجمعية)")

        form.addRow("نص القرار:*", self.decision_text)
        form.addRow("", self.special_majority)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("إضافة")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_accept(self) -> None:
        text = self.decision_text.toPlainText().strip()
        if not text:
            self.decision_text.setFocus()
            return
        self.values = {"decision_text": text, "requires_special_majority": self.special_majority.isChecked()}
        self.accept()


class VoteDialog(QDialog):
    def __init__(self, parent=None, max_votes: int = 1000):
        super().__init__(parent)
        self.setWindowTitle("تسجيل نتيجة التصويت")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.votes_for = QSpinBox()
        self.votes_for.setRange(0, max_votes)
        self.votes_against = QSpinBox()
        self.votes_against.setRange(0, max_votes)
        self.votes_abstain = QSpinBox()
        self.votes_abstain.setRange(0, max_votes)

        form.addRow("عدد أصوات الموافقة:", self.votes_for)
        form.addRow("عدد أصوات الرفض:", self.votes_against)
        form.addRow("عدد الممتنعين:", self.votes_abstain)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("حفظ النتيجة")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None

    def _on_accept(self) -> None:
        self.values = {
            "votes_for": self.votes_for.value(),
            "votes_against": self.votes_against.value(),
            "votes_abstain": self.votes_abstain.value(),
        }
        self.accept()

