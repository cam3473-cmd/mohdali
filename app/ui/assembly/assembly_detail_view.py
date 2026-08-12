"""شاشة تفاصيل اجتماع الجمعية العمومية: جدول الأعمال، الحضور، النصاب، القرارات."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QFileDialog,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QListWidget,
    QPushButton,
    QScrollArea,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import has_permission
from app.db.models import Assembly, AssemblyDecision, AssemblyStatus, AttendanceType, DecisionResult
from app.services import assembly_service
from app.ui.app_context import AppContext
from app.ui.assembly.check_in_dialog import ATTENDANCE_LABELS, CheckInDialog
from app.ui.assembly.decision_dialog import DecisionDialog, VoteDialog
from app.ui.common import confirm, show_error, show_info

STATUS_LABELS = {
    AssemblyStatus.DRAFT: "مسودة",
    AssemblyStatus.INVITATIONS_SENT: "تم إرسال الدعوات",
    AssemblyStatus.IN_PROGRESS: "قيد الانعقاد",
    AssemblyStatus.CLOSED: "مغلق",
    AssemblyStatus.CANCELLED: "ملغى",
}

DECISION_RESULT_LABELS = {
    DecisionResult.PENDING: "لم يُصوَّت بعد",
    DecisionResult.APPROVED: "معتمد",
    DecisionResult.REJECTED: "مرفوض",
}


class AssemblyDetailView(QScrollArea):
    def __init__(self, ctx: AppContext, assembly_id: int, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.assembly_id = assembly_id
        self._can_manage = has_permission(ctx.current_user, "assembly.manage")

        self.setWidgetResizable(True)
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        container = QWidget()
        self.setWidget(container)
        self.layout_ = QVBoxLayout(container)

        self.header_label = QLabel()
        self.layout_.addWidget(self.header_label)

        header_actions = QHBoxLayout()
        self.open_btn = QPushButton("فتح الاجتماع")
        self.second_round_btn = QPushButton("الانتقال إلى الجولة الثانية")
        self.close_btn = QPushButton("إغلاق الاجتماع")
        self.invitations_btn = QPushButton("طباعة كشف الدعوة (PDF)")
        self.minutes_btn = QPushButton("طباعة محضر الاجتماع (PDF)")
        for btn in (self.open_btn, self.second_round_btn, self.close_btn):
            btn.setEnabled(self._can_manage)
            header_actions.addWidget(btn)
        header_actions.addWidget(self.invitations_btn)
        header_actions.addWidget(self.minutes_btn)
        self.layout_.addLayout(header_actions)

        self.open_btn.clicked.connect(self._on_open)
        self.second_round_btn.clicked.connect(self._on_second_round)
        self.close_btn.clicked.connect(self._on_close)
        self.invitations_btn.clicked.connect(self._on_print_invitations)
        self.minutes_btn.clicked.connect(self._on_print_minutes)

        # جدول الأعمال
        agenda_box = QGroupBox("جدول الأعمال")
        agenda_layout = QVBoxLayout(agenda_box)
        self.agenda_list = QListWidget()
        agenda_layout.addWidget(self.agenda_list)
        add_agenda_btn = QPushButton("إضافة بند")
        add_agenda_btn.setEnabled(self._can_manage)
        add_agenda_btn.clicked.connect(self._on_add_agenda_item)
        agenda_layout.addWidget(add_agenda_btn)
        self.layout_.addWidget(agenda_box)

        # النصاب
        quorum_box = QGroupBox("النصاب")
        quorum_layout = QVBoxLayout(quorum_box)
        self.quorum_label = QLabel()
        quorum_layout.addWidget(self.quorum_label)
        refresh_quorum_btn = QPushButton("تحديث النصاب")
        refresh_quorum_btn.clicked.connect(self.refresh)
        quorum_layout.addWidget(refresh_quorum_btn)
        self.layout_.addWidget(quorum_box)

        # الحضور
        attendance_box = QGroupBox("الحضور")
        attendance_layout = QVBoxLayout(attendance_box)
        self.attendance_table = QTableWidget(0, 3)
        self.attendance_table.setHorizontalHeaderLabels(["العضو", "نوع الحضور", "حامل التوكيل"])
        self.attendance_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        attendance_layout.addWidget(self.attendance_table)
        check_in_btn = QPushButton("تسجيل حضور")
        check_in_btn.setEnabled(self._can_manage)
        check_in_btn.clicked.connect(self._on_check_in)
        attendance_layout.addWidget(check_in_btn)
        self.layout_.addWidget(attendance_box)

        # القرارات
        decisions_box = QGroupBox("القرارات")
        decisions_layout = QVBoxLayout(decisions_box)
        self.decisions_table = QTableWidget(0, 5)
        self.decisions_table.setHorizontalHeaderLabels(["القرار", "أغلبية خاصة", "موافق", "معارض", "النتيجة"])
        self.decisions_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.decisions_table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        decisions_layout.addWidget(self.decisions_table)
        decisions_actions = QHBoxLayout()
        add_decision_btn = QPushButton("إضافة قرار")
        vote_btn = QPushButton("تسجيل نتيجة التصويت")
        add_decision_btn.setEnabled(self._can_manage)
        vote_btn.setEnabled(self._can_manage)
        add_decision_btn.clicked.connect(self._on_add_decision)
        vote_btn.clicked.connect(self._on_record_vote)
        decisions_actions.addWidget(add_decision_btn)
        decisions_actions.addWidget(vote_btn)
        decisions_layout.addLayout(decisions_actions)
        self.layout_.addWidget(decisions_box)

        self.refresh()

    @property
    def assembly(self) -> Assembly:
        return self.ctx.session.get(Assembly, self.assembly_id)

    def refresh(self) -> None:
        assembly = self.assembly
        self.header_label.setText(
            f"<h3>{assembly.title}</h3>"
            f"التاريخ: {assembly.meeting_date.isoformat()} — المكان: {assembly.location or '—'}<br>"
            f"الحالة: {STATUS_LABELS.get(assembly.status, assembly.status.value)} — "
            f"الجولة: {'الأولى' if assembly.round.value == 'first' else 'الثانية'}"
        )

        self.agenda_list.clear()
        for item in assembly.agenda_items:
            self.agenda_list.addItem(f"{item.order + 1}. {item.title}")

        quorum = assembly_service.compute_quorum(self.ctx.session, assembly)
        status_text = "مكتمل ✓" if quorum.met else "غير مكتمل ✗"
        self.quorum_label.setText(
            f"الأعضاء المؤهلون: {quorum.eligible_count} — الحاضرون: {quorum.attendee_count} "
            f"({quorum.percent:.1f}%) — النصاب المطلوب: {quorum.required_percent:.1f}% — الحالة: {status_text}"
        )

        self.attendance_table.setRowCount(0)
        for att in assembly.attendances:
            row = self.attendance_table.rowCount()
            self.attendance_table.insertRow(row)
            self.attendance_table.setItem(row, 0, QTableWidgetItem(att.member.full_name))
            self.attendance_table.setItem(row, 1, QTableWidgetItem(ATTENDANCE_LABELS.get(att.attendance_type, att.attendance_type.value)))
            self.attendance_table.setItem(row, 2, QTableWidgetItem(att.proxy_holder.full_name if att.proxy_holder else ""))

        self.decisions_table.setRowCount(0)
        for decision in assembly.decisions:
            row = self.decisions_table.rowCount()
            self.decisions_table.insertRow(row)
            text_item = QTableWidgetItem(decision.decision_text)
            text_item.setData(Qt.ItemDataRole.UserRole, decision.id)
            self.decisions_table.setItem(row, 0, text_item)
            self.decisions_table.setItem(row, 1, QTableWidgetItem("نعم" if decision.requires_special_majority else "لا"))
            self.decisions_table.setItem(row, 2, QTableWidgetItem(str(decision.votes_for)))
            self.decisions_table.setItem(row, 3, QTableWidgetItem(str(decision.votes_against)))
            self.decisions_table.setItem(row, 4, QTableWidgetItem(DECISION_RESULT_LABELS.get(decision.result, decision.result.value)))

    def _on_open(self) -> None:
        try:
            assembly_service.open_assembly(self.ctx.session, self.ctx.current_user, self.assembly)
            self.refresh()
        except assembly_service.AssemblyError as exc:
            show_error(self, str(exc))

    def _on_second_round(self) -> None:
        if not confirm(self, "هل تريد الانتقال إلى الجولة الثانية لعدم اكتمال نصاب الجولة الأولى؟"):
            return
        assembly_service.move_to_second_round(self.ctx.session, self.ctx.current_user, self.assembly)
        self.refresh()

    def _on_close(self) -> None:
        if not confirm(self, "هل تريد إغلاق هذا الاجتماع؟"):
            return
        assembly_service.close_assembly(self.ctx.session, self.ctx.current_user, self.assembly)
        self.refresh()

    def _on_add_agenda_item(self) -> None:
        title, ok = QInputDialog.getText(self, "إضافة بند", "عنوان البند:")
        if ok and title.strip():
            assembly_service.add_agenda_item(self.ctx.session, self.ctx.current_user, self.assembly, title.strip())
            self.refresh()

    def _on_check_in(self) -> None:
        assembly = self.assembly
        eligible = assembly_service.get_eligible_members(self.ctx.session, assembly)
        already_checked_in_ids = {a.member_id for a in assembly.attendances}
        not_yet = [m for m in eligible if m.id not in already_checked_in_ids]
        if not not_yet:
            show_info(self, "جميع الأعضاء المؤهلين تم تسجيل حضورهم")
            return
        dialog = CheckInDialog(self, eligible, not_yet)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            member = self.ctx.session.get(type(eligible[0]), dialog.values["member_id"])
            proxy_holder = None
            if dialog.values["proxy_holder_id"]:
                proxy_holder = self.ctx.session.get(type(eligible[0]), dialog.values["proxy_holder_id"])
            try:
                assembly_service.check_in_member(
                    self.ctx.session,
                    self.ctx.current_user,
                    assembly,
                    member,
                    attendance_type=dialog.values["attendance_type"],
                    proxy_holder=proxy_holder,
                )
                self.refresh()
            except assembly_service.AssemblyError as exc:
                show_error(self, str(exc))

    def _on_add_decision(self) -> None:
        dialog = DecisionDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            assembly_service.add_decision(self.ctx.session, self.ctx.current_user, self.assembly, **dialog.values)
            self.refresh()

    def _on_record_vote(self) -> None:
        row = self.decisions_table.currentRow()
        if row < 0:
            show_error(self, "الرجاء اختيار قرار من القائمة أولًا")
            return
        decision_id = self.decisions_table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        decision = self.ctx.session.get(AssemblyDecision, decision_id)
        max_votes = max(assembly_service.compute_quorum(self.ctx.session, self.assembly).attendee_count, 1)
        dialog = VoteDialog(self, max_votes=max_votes)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            assembly_service.record_vote(self.ctx.session, self.ctx.current_user, decision, **dialog.values)
            self.refresh()

    def _on_print_minutes(self) -> None:
        from app.reports.pdf_export import generate_assembly_minutes

        path, _ = QFileDialog.getSaveFileName(self, "حفظ محضر الاجتماع", f"محضر-{self.assembly.title}.pdf", "PDF (*.pdf)")
        if not path:
            return
        try:
            generate_assembly_minutes(self.ctx.session, self.assembly, path)
            show_info(self, f"تم حفظ المحضر في: {path}")
        except Exception as exc:  # noqa: BLE001 - عرض أي خطأ توليد للمستخدم مباشرة
            show_error(self, f"تعذر توليد المحضر: {exc}")

    def _on_print_invitations(self) -> None:
        from app.reports.pdf_export import generate_invitation_list

        path, _ = QFileDialog.getSaveFileName(self, "حفظ كشف الدعوة", f"دعوة-{self.assembly.title}.pdf", "PDF (*.pdf)")
        if not path:
            return
        try:
            generate_invitation_list(self.ctx.session, self.assembly, path)
            show_info(self, f"تم حفظ كشف الدعوة في: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر توليد كشف الدعوة: {exc}")

