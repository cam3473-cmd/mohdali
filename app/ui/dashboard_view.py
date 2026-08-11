"""لوحة رئيسية: ملخص سريع لحالة العضوية والاجتماعات."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QMessageBox, QPushButton, QVBoxLayout, QWidget

from app.db.models import Assembly, AssemblyStatus, Member, MemberStatus
from app.services import membership_service
from app.services.eligibility_service import list_eligible_members
from app.ui.app_context import AppContext


class DashboardView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        layout = QVBoxLayout(self)
        self.summary_label = QLabel()
        self.summary_label.setStyleSheet("font-size: 14pt;")
        layout.addWidget(self.summary_label)

        refresh_btn = QPushButton("تحديث")
        refresh_btn.clicked.connect(self.refresh)
        layout.addWidget(refresh_btn)

        self.unpaid_btn = QPushButton("عرض الأعضاء المتأخرين عن السداد")
        self.unpaid_btn.clicked.connect(self._on_show_unpaid)
        layout.addWidget(self.unpaid_btn)

        layout.addStretch()

        self.refresh()

    def refresh(self) -> None:
        session = self.ctx.session
        total_members = session.query(Member).count()
        active_members = session.query(Member).filter(Member.status == MemberStatus.ACTIVE).count()
        pending_requests = session.query(Member).filter(Member.status == MemberStatus.PENDING).count()
        eligible_count = len(list_eligible_members(session, as_of_date=date.today()))
        unpaid_count = len(membership_service.list_unpaid_active_members(session))
        upcoming = (
            session.query(Assembly)
            .filter(Assembly.meeting_date >= date.today(), Assembly.status != AssemblyStatus.CANCELLED)
            .order_by(Assembly.meeting_date)
            .all()
        )
        upcoming_lines = "".join(f"<li>{a.title} — {a.meeting_date.isoformat()}</li>" for a in upcoming) or "<li>لا توجد اجتماعات قادمة</li>"

        unpaid_color = "#b3261e" if unpaid_count else "#1e7d34"
        self.summary_label.setText(
            f"<h2>مرحبًا، {self.ctx.current_user.full_name}</h2>"
            f"<p>إجمالي الأعضاء: <b>{total_members}</b> — الأعضاء النشطون: <b>{active_members}</b> — "
            f"طلبات عضوية معلّقة: <b>{pending_requests}</b></p>"
            f"<p>الأعضاء المؤهلون لحضور/التصويت في الجمعية العمومية اليوم: <b>{eligible_count}</b></p>"
            f"<p>الأعضاء المتأخرون عن سداد اشتراك {date.today().year}: "
            f"<b style='color:{unpaid_color}'>{unpaid_count}</b></p>"
            f"<p>الاجتماعات القادمة:</p><ul>{upcoming_lines}</ul>"
        )

    def _on_show_unpaid(self) -> None:
        unpaid = membership_service.list_unpaid_active_members(self.ctx.session)
        if not unpaid:
            QMessageBox.information(self, "المتأخرون عن السداد", "لا يوجد أعضاء متأخرون عن سداد الاشتراك لهذا العام.")
            return
        names = "\n".join(f"- {m.full_name}" for m in unpaid)
        QMessageBox.information(self, "المتأخرون عن السداد", f"عدد الأعضاء المتأخرين: {len(unpaid)}\n\n{names}")

