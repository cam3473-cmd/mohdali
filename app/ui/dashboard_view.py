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
        arrears_list = membership_service.list_active_members_with_arrears(session)
        arrears_count = len(arrears_list)
        arrears_total = sum(a.estimated_amount for a in arrears_list)
        upcoming = (
            session.query(Assembly)
            .filter(Assembly.meeting_date >= date.today(), Assembly.status != AssemblyStatus.CANCELLED)
            .order_by(Assembly.meeting_date)
            .all()
        )
        upcoming_lines = "".join(f"<li>{a.title} — {a.meeting_date.isoformat()}</li>" for a in upcoming) or "<li>لا توجد اجتماعات قادمة</li>"

        arrears_color = "#b3261e" if arrears_count else "#1e7d34"
        self.summary_label.setText(
            f"<h2>مرحبًا، {self.ctx.current_user.full_name}</h2>"
            f"<p>إجمالي الأعضاء: <b>{total_members}</b> — الأعضاء النشطون: <b>{active_members}</b> — "
            f"طلبات عضوية معلّقة: <b>{pending_requests}</b></p>"
            f"<p>الأعضاء المؤهلون لحضور/التصويت في الجمعية العمومية اليوم: <b>{eligible_count}</b></p>"
            f"<p>الأعضاء المتأخرون عن سداد الاشتراك (سنة واحدة أو أكثر): "
            f"<b style='color:{arrears_color}'>{arrears_count}</b>"
            + (f" — إجمالي المستحقات التقديرية: <b>{arrears_total:,.0f} ريال</b>" if arrears_count else "")
            + "</p>"
            f"<p>الاجتماعات القادمة:</p><ul>{upcoming_lines}</ul>"
        )

    def _on_show_unpaid(self) -> None:
        arrears_list = membership_service.list_active_members_with_arrears(self.ctx.session)
        if not arrears_list:
            QMessageBox.information(self, "المتأخرون عن السداد", "لا يوجد أعضاء متأخرون عن سداد الاشتراك.")
            return
        lines = [
            f"- {a.member.full_name}: متأخر {a.years_count} سنة ({', '.join(str(y) for y in a.unpaid_years)}) "
            f"— تقديريًا {a.estimated_amount:,.0f} ريال"
            for a in arrears_list
        ]
        total = sum(a.estimated_amount for a in arrears_list)
        message = (
            f"عدد الأعضاء المتأخرين: {len(arrears_list)} — إجمالي المستحقات التقديرية: {total:,.0f} ريال\n\n"
            + "\n".join(lines)
        )
        QMessageBox.information(self, "المتأخرون عن السداد", message)

