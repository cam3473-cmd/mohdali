mkdir -p 'app/reports'
cat > 'app/reports/pdf_export.py' << 'FILEEOF_APP_REPORTS_PDF_EXPORT_PY'
"""توليد محضر اجتماع الجمعية العمومية وبطاقات العضوية بصيغة PDF مع دعم النص العربي (RTL)."""
from __future__ import annotations

import base64
import io
from datetime import date
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.graphics.barcode import code128
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdf_canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.db.models import Assembly, FeeStatus, Member, MemberStatus
from app.services import assembly_service

FONTS_DIR = Path(__file__).resolve().parent.parent / "resources" / "fonts"
IMAGES_DIR = Path(__file__).resolve().parent.parent / "resources" / "images"
FONT_NAME = "Amiri"
FONT_BOLD_NAME = "Amiri-Bold"

ASSOCIATION_NAME = "جمعية البر الخيرية بمحافظة السليل"

DECISION_RESULT_LABELS_AR = {"pending": "لم يُصوَّت بعد", "approved": "معتمد", "rejected": "مرفوض"}
ATTENDANCE_LABELS_AR = {"in_person": "حضور شخصي", "proxy": "بالتوكيل"}

CARD_GREEN = colors.HexColor("#1c5c33")
CARD_GOLD = colors.HexColor("#c8a132")
CARD_RED = colors.HexColor("#b3261e")

_fonts_registered = False


def _find_logo_path() -> Path | None:
    for name in ("logo.png", "logo.jpg", "logo.jpeg"):
        path = IMAGES_DIR / name
        if path.exists():
            return path
    return None


def _load_font_bytes(base_name: str) -> io.BytesIO:
    # الخطوط مخزّنة كنص base64 (.ttf.b64) بدلًا من ملفات ثنائية لتفادي أي تلف
    # قد ينتج عن أدوات نقل تتعامل مع المحتوى كنص (مثل بعض واجهات نظام التحكم بالإصدار).
    encoded = (FONTS_DIR / f"{base_name}.ttf.b64").read_text()
    return io.BytesIO(base64.b64decode(encoded))


def _ensure_fonts_registered() -> None:
    global _fonts_registered
    if _fonts_registered:
        return
    pdfmetrics.registerFont(TTFont(FONT_NAME, _load_font_bytes("Amiri-Regular")))
    pdfmetrics.registerFont(TTFont(FONT_BOLD_NAME, _load_font_bytes("Amiri-Bold")))
    _fonts_registered = True


def ar(text: str | None) -> str:
    """يهيئ النص العربي للعرض الصحيح (تشكيل الحروف واتجاه الكتابة) داخل PDF."""
    if not text:
        return ""
    reshaped = arabic_reshaper.reshape(str(text))
    return get_display(reshaped)


def _logo_flowable(max_height: float = 2 * cm):
    from reportlab.platypus import Image

    logo_path = _find_logo_path()
    if logo_path is None:
        return None
    img = ImageReader(str(logo_path))
    iw, ih = img.getSize()
    scale = max_height / ih
    return Image(str(logo_path), width=iw * scale, height=ih * scale, hAlign="CENTER")


def generate_assembly_minutes(session, assembly: Assembly, output_path: str) -> None:
    _ensure_fonts_registered()

    styles = {
        "title": ParagraphStyle("title", fontName=FONT_BOLD_NAME, fontSize=16, alignment=1, spaceAfter=12),
        "heading": ParagraphStyle("heading", fontName=FONT_BOLD_NAME, fontSize=13, alignment=2, spaceBefore=10, spaceAfter=6),
        "body": ParagraphStyle("body", fontName=FONT_NAME, fontSize=11, alignment=2, leading=16),
    }

    doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm)
    story = []

    logo = _logo_flowable()
    if logo is not None:
        story.append(logo)
        story.append(Spacer(1, 6))
    story.append(Paragraph(ar("جمعية البر الخيرية بمحافظة السليل"), styles["title"]))
    story.append(Paragraph(ar(f"محضر اجتماع: {assembly.title}"), styles["title"]))
    story.append(Spacer(1, 8))

    story.append(
        Paragraph(
            ar(
                f"التاريخ: {assembly.meeting_date.isoformat()} — المكان: {assembly.location or '—'} — "
                f"النوع: {'عادية' if assembly.type.value == 'ordinary' else 'غير عادية'}"
            ),
            styles["body"],
        )
    )

    quorum = assembly_service.compute_quorum(session, assembly)
    story.append(
        Paragraph(
            ar(
                f"عدد الأعضاء المؤهلين: {quorum.eligible_count} — عدد الحاضرين: {quorum.attendee_count} "
                f"({quorum.percent:.1f}%) — النصاب المطلوب: {quorum.required_percent:.1f}% — "
                f"{'اكتمل النصاب' if quorum.met else 'لم يكتمل النصاب'}"
            ),
            styles["body"],
        )
    )

    story.append(Paragraph(ar("جدول الأعمال"), styles["heading"]))
    for item in assembly.agenda_items:
        story.append(Paragraph(ar(f"{item.order + 1}. {item.title}"), styles["body"]))

    story.append(Paragraph(ar("كشف الحضور"), styles["heading"]))
    attendance_rows = [[ar("نوع الحضور"), ar("حامل التوكيل"), ar("اسم العضو")]]
    for att in assembly.attendances:
        attendance_rows.append(
            [
                ar(ATTENDANCE_LABELS_AR.get(att.attendance_type.value, att.attendance_type.value)),
                ar(att.proxy_holder.full_name if att.proxy_holder else "—"),
                ar(att.member.full_name),
            ]
        )
    story.append(_styled_table(attendance_rows))

    story.append(Paragraph(ar("القرارات ونتائج التصويت"), styles["heading"]))
    decision_rows = [[ar("النتيجة"), ar("ممتنع"), ar("معارض"), ar("موافق"), ar("القرار")]]
    for decision in assembly.decisions:
        decision_rows.append(
            [
                ar(DECISION_RESULT_LABELS_AR.get(decision.result.value, decision.result.value)),
                str(decision.votes_abstain),
                str(decision.votes_against),
                str(decision.votes_for),
                ar(decision.decision_text),
            ]
        )
    story.append(_styled_table(decision_rows))

    doc.build(story)


def generate_invitation_list(session, assembly: Assembly, output_path: str) -> None:
    """يولّد كشف الأعضاء المؤهلين لدعوتهم لحضور الاجتماع."""
    _ensure_fonts_registered()

    styles = {
        "title": ParagraphStyle("title", fontName=FONT_BOLD_NAME, fontSize=16, alignment=1, spaceAfter=12),
        "body": ParagraphStyle("body", fontName=FONT_NAME, fontSize=11, alignment=2, leading=16),
    }

    doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm)
    story = []
    logo = _logo_flowable()
    if logo is not None:
        story.append(logo)
        story.append(Spacer(1, 6))
    story.append(Paragraph(ar("جمعية البر الخيرية بمحافظة السليل"), styles["title"]))
    story.append(Paragraph(ar(f"كشف دعوة الأعضاء المؤهلين — {assembly.title} ({assembly.meeting_date.isoformat()})"), styles["title"]))
    story.append(Spacer(1, 8))

    eligible = assembly_service.get_eligible_members(session, assembly)
    rows = [[ar("رقم الجوال"), ar("نوع العضوية"), ar("اسم العضو"), "#"]]
    for i, member in enumerate(eligible, start=1):
        rows.append([ar(member.phone or "—"), ar(member.member_type), ar(member.full_name), str(i)])
    story.append(_styled_table(rows))

    doc.build(story)


def _current_fee_paid(session, member: Member, as_of_date: date | None = None) -> bool:
    from app.db.models import MembershipFee

    as_of_date = as_of_date or date.today()
    fee = (
        session.query(MembershipFee)
        .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == as_of_date.year)
        .first()
    )
    return fee is not None and fee.status in (FeeStatus.PAID, FeeStatus.WAIVED)


# أبعاد بطاقة العضوية وشبكة الطباعة (بطاقتان في كل صف)
_CARD_W = 8.8 * cm
_CARD_H = 6.1 * cm
_CARD_GAP_X = 0.4 * cm
_CARD_GAP_Y = 0.4 * cm
_PAGE_MARGIN = 1.3 * cm


def _draw_membership_card(c: pdf_canvas.Canvas, x: float, y: float, session, member: Member, logo_path: Path | None) -> None:
    """يرسم بطاقة عضوية واحدة بزاوية سفلية يسرى عند الإحداثيات (x, y)."""
    c.setStrokeColor(CARD_GREEN)
    c.setLineWidth(1.2)
    c.roundRect(x, y, _CARD_W, _CARD_H, 6, stroke=1, fill=0)

    header_h = 1.15 * cm
    c.setFillColor(CARD_GREEN)
    c.roundRect(x, y + _CARD_H - header_h, _CARD_W, header_h, 6, stroke=0, fill=1)
    c.rect(x, y + _CARD_H - header_h, _CARD_W, header_h / 2, stroke=0, fill=1)  # يربّع الزوايا السفلية للرأس

    if logo_path is not None:
        try:
            c.drawImage(
                ImageReader(str(logo_path)),
                x + _CARD_W - header_h + 0.05 * cm,
                y + _CARD_H - header_h + 0.05 * cm,
                width=header_h - 0.1 * cm,
                height=header_h - 0.1 * cm,
                mask="auto",
                preserveAspectRatio=True,
            )
        except Exception:  # noqa: BLE001 - عدم توقف توليد البطاقات إن تعذّرت قراءة الشعار
            pass

    c.setFillColor(colors.white)
    c.setFont(FONT_BOLD_NAME, 10.5)
    c.drawRightString(x + _CARD_W - header_h - 0.15 * cm, y + _CARD_H - 0.48 * cm, ar(ASSOCIATION_NAME))
    c.setFont(FONT_NAME, 8.5)
    c.drawRightString(x + _CARD_W - header_h - 0.15 * cm, y + _CARD_H - 0.85 * cm, ar("بطاقة عضوية"))

    fee_paid = _current_fee_paid(session, member)
    fields = [
        ("الاسم", member.full_name),
        ("السجل المدني", member.national_id_or_cr or "—"),
        ("رقم العضوية", member.membership_number or str(member.id)),
        ("تاريخ العضوية", member.join_date.isoformat()),
        ("حالة السداد", "منتظم" if fee_paid else "غير منتظم"),
    ]

    row_h = 0.62 * cm
    text_y = y + _CARD_H - header_h - 0.55 * cm
    label_x = x + _CARD_W - 0.35 * cm
    value_x = x + 0.35 * cm

    c.setFont(FONT_BOLD_NAME, 8.5)
    for label, value in fields:
        c.setFillColor(colors.HexColor("#444444"))
        c.drawRightString(label_x, text_y, ar(label))
        c.setFillColor(colors.black)
        c.drawString(value_x, text_y, ar(str(value)))
        text_y -= row_h

    c.setFillColor(colors.HexColor("#444444"))
    c.drawRightString(label_x, text_y, ar("حالة العضو"))
    is_active = member.status == MemberStatus.ACTIVE
    c.setFillColor(colors.HexColor("#1e7d34") if is_active else CARD_RED)
    c.setFont(FONT_BOLD_NAME, 8.5)
    c.drawString(value_x, text_y, ar("فعّال" if is_active else "غير فعّال"))

    if member.national_id_or_cr:
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.black)
        barcode = code128.Code128(member.national_id_or_cr, barHeight=0.85 * cm, barWidth=0.9)
        barcode_x = x + (_CARD_W - barcode.width) / 2
        barcode.drawOn(c, barcode_x, y + 0.15 * cm)


def generate_membership_cards(session, members: list[Member], output_path: str) -> None:
    """يولّد بطاقات عضوية قابلة للطباعة (بطاقتان في كل صف) لقائمة أعضاء."""
    _ensure_fonts_registered()
    logo_path = _find_logo_path()

    c = pdf_canvas.Canvas(output_path, pagesize=A4)
    page_w, page_h = A4

    cols = 2
    rows_per_page = max(1, int((page_h - 2 * _PAGE_MARGIN + _CARD_GAP_Y) // (_CARD_H + _CARD_GAP_Y)))
    per_page = cols * rows_per_page

    for index, member in enumerate(members):
        pos_in_page = index % per_page
        if index > 0 and pos_in_page == 0:
            c.showPage()
        col = pos_in_page % cols
        row = pos_in_page // cols

        x = _PAGE_MARGIN + col * (_CARD_W + _CARD_GAP_X)
        y = page_h - _PAGE_MARGIN - _CARD_H - row * (_CARD_H + _CARD_GAP_Y)
        _draw_membership_card(c, x, y, session, member, logo_path)

    c.save()


def _styled_table(rows: list[list[str]]) -> Table:
    table = Table(rows, hAlign="RIGHT")
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
                ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD_NAME),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2f4f4f")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


FILEEOF_APP_REPORTS_PDF_EXPORT_PY
mkdir -p 'app/ui'
cat > 'app/ui/common.py' << 'FILEEOF_APP_UI_COMMON_PY'
"""عناصر واجهة مشتركة."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QDialog, QFormLayout, QLineEdit, QMessageBox, QPushButton, QVBoxLayout

IMAGES_DIR = Path(__file__).resolve().parent.parent / "resources" / "images"


def load_logo_pixmap(max_height: int = 80) -> QPixmap | None:
    """يحمّل شعار الجمعية إن وُجد ملفه في app/resources/images/logo.(png|jpg|jpeg)."""
    for name in ("logo.png", "logo.jpg", "logo.jpeg"):
        path = IMAGES_DIR / name
        if path.exists():
            pixmap = QPixmap(str(path))
            if not pixmap.isNull():
                return pixmap.scaledToHeight(max_height, Qt.TransformationMode.SmoothTransformation)
    return None


def show_error(parent, message: str, title: str = "خطأ") -> None:
    QMessageBox.critical(parent, title, message)


def show_info(parent, message: str, title: str = "تنبيه") -> None:
    QMessageBox.information(parent, title, message)


def confirm(parent, message: str, title: str = "تأكيد") -> bool:
    return QMessageBox.question(parent, title, message) == QMessageBox.StandardButton.Yes


class ChangePasswordDialog(QDialog):
    def __init__(self, parent=None, mandatory: bool = False):
        super().__init__(parent)
        self.setWindowTitle("تغيير كلمة المرور")
        self.setModal(True)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.new_password = QLineEdit()
        self.new_password.setEchoMode(QLineEdit.EchoMode.Password)
        self.confirm_password = QLineEdit()
        self.confirm_password.setEchoMode(QLineEdit.EchoMode.Password)

        form.addRow("كلمة المرور الجديدة:", self.new_password)
        form.addRow("تأكيد كلمة المرور:", self.confirm_password)
        layout.addLayout(form)

        if mandatory:
            layout.addWidget(QPushButton("تغيير", clicked=self._on_submit))
        else:
            save_btn = QPushButton("حفظ")
            cancel_btn = QPushButton("إلغاء")
            save_btn.clicked.connect(self._on_submit)
            cancel_btn.clicked.connect(self.reject)
            layout.addWidget(save_btn)
            layout.addWidget(cancel_btn)

        self.result_password: str | None = None

    def _on_submit(self) -> None:
        pw1 = self.new_password.text()
        pw2 = self.confirm_password.text()
        if len(pw1) < 6:
            show_error(self, "يجب ألا تقل كلمة المرور عن 6 أحرف")
            return
        if pw1 != pw2:
            show_error(self, "كلمتا المرور غير متطابقتين")
            return
        self.result_password = pw1
        self.accept()


FILEEOF_APP_UI_COMMON_PY
mkdir -p 'app/ui'
cat > 'app/ui/login_view.py' << 'FILEEOF_APP_UI_LOGIN_VIEW_PY'
"""شاشة تسجيل الدخول."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QDialog, QFormLayout, QLabel, QLineEdit, QPushButton, QVBoxLayout

from app.auth.service import AccountInactive, AuthService, InvalidCredentials
from app.db.models import User
from app.ui.common import ChangePasswordDialog, load_logo_pixmap, show_error


class LoginDialog(QDialog):
    def __init__(self, auth: AuthService, parent=None):
        super().__init__(parent)
        self.auth = auth
        self.setWindowTitle("تسجيل الدخول — نظام عضوية الجمعية العمومية")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setModal(True)
        self.setMinimumWidth(360)

        layout = QVBoxLayout(self)

        logo_pixmap = load_logo_pixmap(max_height=90)
        if logo_pixmap is not None:
            logo_label = QLabel()
            logo_label.setPixmap(logo_pixmap)
            logo_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            layout.addWidget(logo_label)

        title_label = QLabel("<h2>جمعية البر الخيرية بمحافظة السليل</h2>")
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(title_label)

        form = QFormLayout()
        self.username_input = QLineEdit()
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.EchoMode.Password)
        form.addRow("اسم المستخدم:", self.username_input)
        form.addRow("كلمة المرور:", self.password_input)
        layout.addLayout(form)

        login_btn = QPushButton("دخول")
        login_btn.setDefault(True)
        login_btn.clicked.connect(self._on_login)
        layout.addWidget(login_btn)
        self.password_input.returnPressed.connect(self._on_login)

        self.authenticated_user: User | None = None

    def _on_login(self) -> None:
        username = self.username_input.text().strip()
        password = self.password_input.text()
        if not username or not password:
            show_error(self, "الرجاء إدخال اسم المستخدم وكلمة المرور")
            return
        try:
            user = self.auth.login(username, password)
        except InvalidCredentials as exc:
            show_error(self, str(exc))
            return
        except AccountInactive as exc:
            show_error(self, str(exc))
            return

        if user.force_password_change:
            dialog = ChangePasswordDialog(self, mandatory=True)
            if dialog.exec() == QDialog.DialogCode.Accepted and dialog.result_password:
                self.auth.change_password(user, dialog.result_password)
            else:
                show_error(self, "يجب تغيير كلمة المرور للمتابعة")
                return

        self.authenticated_user = user
        self.accept()


FILEEOF_APP_UI_LOGIN_VIEW_PY
mkdir -p 'app/ui'
cat > 'app/ui/main_window.py' << 'FILEEOF_APP_UI_MAIN_WINDOW_PY'
"""النافذة الرئيسية للتطبيق."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QHBoxLayout, QLabel, QMainWindow, QMessageBox, QTabWidget, QVBoxLayout, QWidget

from app.auth.service import has_permission
from app.ui.app_context import AppContext
from app.ui.assembly.assembly_list_view import AssemblyListView
from app.ui.board.board_view import BoardView
from app.ui.common import load_logo_pixmap
from app.ui.dashboard_view import DashboardView
from app.ui.members.members_view import MembersView
from app.ui.settings.settings_view import SettingsView


class MainWindow(QMainWindow):
    def __init__(self, ctx: AppContext):
        super().__init__()
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setWindowTitle("نظام عضوية الجمعية العمومية — جمعية البر الخيرية بمحافظة السليل")
        self.resize(1000, 700)

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
        if has_permission(ctx.current_user, "settings.manage") or has_permission(ctx.current_user, "users.manage"):
            tabs.addTab(SettingsView(ctx), "الإعدادات")
        central_layout.addWidget(tabs)

        self.setCentralWidget(central)

        self.statusBar().showMessage(f"المستخدم الحالي: {ctx.current_user.full_name}")
        logout_action = self.menuBar().addAction("تسجيل الخروج")
        logout_action.triggered.connect(self._on_logout)

    def _on_logout(self) -> None:
        self.ctx.auth.logout()
        QMessageBox.information(self, "تسجيل الخروج", "تم تسجيل الخروج. الرجاء إعادة تشغيل التطبيق لتسجيل الدخول مجددًا.")
        self.close()


FILEEOF_APP_UI_MAIN_WINDOW_PY
mkdir -p 'app/ui/members'
cat > 'app/ui/members/members_view.py' << 'FILEEOF_APP_UI_MEMBERS_MEMBERS_VIEW_PY'
"""شاشة إدارة الأعضاء."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from app.auth.service import has_permission
from app.db.models import Member, MemberStatus
from app.services import import_service, membership_service
from app.ui.app_context import AppContext
from app.ui.common import confirm, show_error, show_info
from app.ui.members.fee_payment_dialog import FeePaymentDialog
from app.ui.members.import_dialog import ImportDialog
from app.ui.members.member_form_dialog import MemberFormDialog

STATUS_LABELS = {
    MemberStatus.ACTIVE: "نشط",
    MemberStatus.SUSPENDED: "موقوف",
    MemberStatus.WITHDRAWN: "منسحب",
    MemberStatus.REJECTED: "مرفوض",
    MemberStatus.PENDING: "طلب معلّق",
}
STATUS_FILTERS = ["الكل"] + list(STATUS_LABELS.values())


class MembersView(QWidget):
    def __init__(self, ctx: AppContext, parent=None):
        super().__init__(parent)
        self.ctx = ctx
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

        self._can_manage = has_permission(ctx.current_user, "members.manage")

        layout = QVBoxLayout(self)

        toolbar = QHBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("بحث بالاسم...")
        self.search_input.textChanged.connect(self.refresh)
        self.status_filter = QComboBox()
        self.status_filter.addItems(STATUS_FILTERS)
        self.status_filter.currentIndexChanged.connect(self.refresh)
        add_btn = QPushButton("إضافة عضو")
        add_btn.setEnabled(self._can_manage)
        add_btn.clicked.connect(self._on_add)

        import_btn = QPushButton("استيراد من Excel")
        import_btn.setEnabled(self._can_manage)
        import_btn.clicked.connect(self._on_import)

        toolbar.addWidget(self.search_input)
        toolbar.addWidget(self.status_filter)
        toolbar.addStretch()
        toolbar.addWidget(import_btn)
        toolbar.addWidget(add_btn)
        layout.addLayout(toolbar)

        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(["الاسم", "نوع العضوية", "الحالة", "تاريخ الانضمام", "الجوال", "مؤسس"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table)

        actions = QHBoxLayout()
        self.edit_btn = QPushButton("تعديل")
        self.approve_btn = QPushButton("قبول الطلب")
        self.reject_btn = QPushButton("رفض الطلب")
        self.suspend_btn = QPushButton("إيقاف العضوية")
        self.withdraw_btn = QPushButton("تسجيل انسحاب")
        self.fee_btn = QPushButton("تسجيل سداد اشتراك")
        for btn in (self.edit_btn, self.approve_btn, self.reject_btn, self.suspend_btn, self.withdraw_btn, self.fee_btn):
            btn.setEnabled(self._can_manage)
            actions.addWidget(btn)
        self.cards_btn = QPushButton("طباعة بطاقة العضوية")
        actions.addWidget(self.cards_btn)
        layout.addLayout(actions)

        self.edit_btn.clicked.connect(self._on_edit)
        self.approve_btn.clicked.connect(self._on_approve)
        self.reject_btn.clicked.connect(self._on_reject)
        self.suspend_btn.clicked.connect(self._on_suspend)
        self.withdraw_btn.clicked.connect(self._on_withdraw)
        self.fee_btn.clicked.connect(self._on_record_fee)
        self.cards_btn.clicked.connect(self._on_print_cards)

        self.refresh()

    def _selected_member(self) -> Member | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        member_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(Member, member_id)

    def refresh(self) -> None:
        status_label = self.status_filter.currentText()
        status = None
        if status_label != "الكل":
            status = next(s for s, label in STATUS_LABELS.items() if label == status_label)
        members = membership_service.list_members(self.ctx.session, status=status, search=self.search_input.text().strip() or None)

        self.table.setRowCount(0)
        for member in members:
            row = self.table.rowCount()
            self.table.insertRow(row)
            name_item = QTableWidgetItem(member.full_name)
            name_item.setData(Qt.ItemDataRole.UserRole, member.id)
            self.table.setItem(row, 0, name_item)
            self.table.setItem(row, 1, QTableWidgetItem(member.member_type))
            self.table.setItem(row, 2, QTableWidgetItem(STATUS_LABELS.get(member.status, member.status.value)))
            self.table.setItem(row, 3, QTableWidgetItem(member.join_date.isoformat()))
            self.table.setItem(row, 4, QTableWidgetItem(member.phone or ""))
            self.table.setItem(row, 5, QTableWidgetItem("نعم" if member.is_founder else "لا"))

    def _existing_member_types(self) -> list[str]:
        types = {m.member_type for m in membership_service.list_members(self.ctx.session)}
        return sorted(types) or ["مؤسس", "عامل", "منتسب", "شرف"]

    def _on_add(self) -> None:
        dialog = MemberFormDialog(self, member_types=self._existing_member_types())
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            membership_service.submit_membership_request(self.ctx.session, self.ctx.current_user, **dialog.values)
            self.refresh()

    def _on_edit(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        dialog = MemberFormDialog(self, member=member, member_types=self._existing_member_types())
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            membership_service.update_member(self.ctx.session, self.ctx.current_user, member, **dialog.values)
            self.refresh()

    def _on_approve(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        try:
            membership_service.approve_membership(self.ctx.session, self.ctx.current_user, member)
            self.refresh()
        except membership_service.MembershipError as exc:
            show_error(self, str(exc))

    def _on_reject(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(self, f"هل تريد رفض طلب عضوية {member.full_name}؟"):
            return
        try:
            membership_service.reject_membership(self.ctx.session, self.ctx.current_user, member, reason="قرار إداري")
            self.refresh()
        except membership_service.MembershipError as exc:
            show_error(self, str(exc))

    def _on_suspend(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(self, f"هل تريد إيقاف عضوية {member.full_name}؟"):
            return
        membership_service.suspend_membership(self.ctx.session, self.ctx.current_user, member, reason="قرار إداري")
        self.refresh()

    def _on_withdraw(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(self, f"هل تريد تسجيل انسحاب {member.full_name}؟"):
            return
        membership_service.withdraw_membership(self.ctx.session, self.ctx.current_user, member)
        self.refresh()

    def _on_record_fee(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        dialog = FeePaymentDialog(self)
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            membership_service.record_fee_payment(self.ctx.session, self.ctx.current_user, member, **dialog.values)
            show_info(self, "تم تسجيل السداد بنجاح")

    def _on_import(self) -> None:
        dialog = ImportDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted or not dialog.values:
            return
        try:
            report = import_service.import_members_from_excel(self.ctx.session, self.ctx.current_user, **dialog.values)
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر الاستيراد: {exc}")
            return

        message = f"تم الاستيراد: {report.created} عضو جديد، {report.updated} عضو محدَّث."
        if report.warnings:
            message += "\n\nتنبيهات:\n" + "\n".join(f"- {w}" for w in report.warnings)
        if report.skipped:
            message += "\n\nسطور تم تجاوزها:\n" + "\n".join(f"- {s}" for s in report.skipped)
        show_info(self, message, title="نتيجة الاستيراد")
        self.refresh()

    def _on_print_cards(self) -> None:
        from app.reports.pdf_export import generate_membership_cards

        member = self._selected_member()
        if member is not None:
            members = [member]
            default_name = f"بطاقة-عضوية-{member.full_name}.pdf"
        else:
            members = membership_service.list_members(self.ctx.session, status=MemberStatus.ACTIVE)
            if not members:
                show_error(self, "لا يوجد أعضاء نشطون لطباعة بطاقاتهم")
                return
            default_name = "بطاقات-العضوية.pdf"

        path, _ = QFileDialog.getSaveFileName(self, "حفظ بطاقة/بطاقات العضوية", default_name, "PDF (*.pdf)")
        if not path:
            return
        try:
            generate_membership_cards(self.ctx.session, members, path)
            show_info(self, f"تم حفظ البطاقات في: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر توليد البطاقات: {exc}")


FILEEOF_APP_UI_MEMBERS_MEMBERS_VIEW_PY
mkdir -p 'app/resources/images'
cat > 'app/resources/images/README.txt' << 'FILEEOF_APP_RESOURCES_IMAGES_README_TXT'
ضع ملف شعار الجمعية هنا باسم أحد التالي بالضبط:
  logo.png
  logo.jpg
  logo.jpeg

سيتم عرضه تلقائيًا في شاشة تسجيل الدخول، شريط عنوان النافذة الرئيسية،
وأعلى تقارير PDF (المحضر، كشف الدعوة، بطاقات العضوية) بمجرد وضعه هنا.

FILEEOF_APP_RESOURCES_IMAGES_README_TXT
mkdir -p 'tests'
cat > 'tests/test_card_export.py' << 'FILEEOF_TESTS_TEST_CARD_EXPORT_PY'
from datetime import date

from app.services import membership_service
from app.reports.pdf_export import generate_membership_cards


def test_generate_membership_cards_for_active_and_suspended_members(db_session, admin_user, tmp_path):
    active = membership_service.submit_membership_request(
        db_session,
        admin_user,
        full_name="عضو فعال",
        member_type="عادية",
        membership_number="1",
        national_id_or_cr="1046952857",
        join_date=date(2020, 1, 1),
    )
    membership_service.approve_membership(db_session, admin_user, active)
    membership_service.record_fee_payment(db_session, admin_user, active, fee_year=date.today().year, amount=300)

    suspended = membership_service.submit_membership_request(
        db_session,
        admin_user,
        full_name="عضو موقوف",
        member_type="عادية",
        membership_number="27",
        national_id_or_cr="1019145984",
        join_date=date(2020, 1, 1),
    )
    membership_service.approve_membership(db_session, admin_user, suspended)
    membership_service.suspend_membership(db_session, admin_user, suspended, reason="اختبار")

    output_path = str(tmp_path / "cards.pdf")
    generate_membership_cards(db_session, [active, suspended], output_path)

    with open(output_path, "rb") as f:
        content = f.read()
    assert content.startswith(b"%PDF")
    assert len(content) > 1000


def test_generate_membership_cards_handles_member_without_national_id(db_session, admin_user, tmp_path):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="بدون هوية", member_type="عادية", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)

    output_path = str(tmp_path / "cards_no_id.pdf")
    generate_membership_cards(db_session, [member], output_path)

    with open(output_path, "rb") as f:
        assert f.read().startswith(b"%PDF")

FILEEOF_TESTS_TEST_CARD_EXPORT_PY
