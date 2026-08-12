mkdir -p app/reports app/services app/ui/members tests

cat > app/reports/pdf_export.py << 'MOHDALI_EOF'
"""توليد محضر اجتماع الجمعية العمومية وبطاقات العضوية بصيغة PDF مع دعم النص العربي (RTL)."""
from __future__ import annotations

import base64
import io
from datetime import date
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import code128, qr
from reportlab.graphics.shapes import Drawing
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
from app.services import assembly_service, board_service

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


def generate_board_report(positions: list, output_path: str, term_end_date: str | None = None) -> None:
    """يولّد تقرير مناصب مجلس الإدارة الحالية بصيغة PDF."""
    _ensure_fonts_registered()

    styles = {
        "title": ParagraphStyle("title", fontName=FONT_BOLD_NAME, fontSize=16, alignment=1, spaceAfter=12),
        "sub": ParagraphStyle("sub", fontName=FONT_NAME, fontSize=11, alignment=1, spaceAfter=10),
    }

    doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm)
    story = []
    logo = _logo_flowable()
    if logo is not None:
        story.append(logo)
        story.append(Spacer(1, 6))
    story.append(Paragraph(ar(ASSOCIATION_NAME), styles["title"]))
    story.append(Paragraph(ar("مجلس الإدارة — المناصب الحالية"), styles["title"]))
    status_text = board_service.term_status_text(term_end_date) if term_end_date else None
    if status_text:
        story.append(Paragraph(ar(status_text), styles["sub"]))
    story.append(Spacer(1, 8))

    rows = [[ar("تاريخ التعيين"), ar("المنصب"), ar("العضو"), "#"]]
    for i, pos in enumerate(positions, start=1):
        rows.append([ar(pos.start_date.isoformat() if pos.start_date else "—"), ar(pos.title), ar(pos.member.full_name), str(i)])
    story.append(_styled_table(rows, h_align="CENTER"))
    story.append(Spacer(1, 16))

    qr_data = "|".join(
        [ASSOCIATION_NAME, "مجلس الإدارة", f"سارٍ حتى: {term_end_date}" if term_end_date else "", date.today().isoformat()]
    )
    qr_size = 2.4 * cm
    qr_widget = qr.QrCodeWidget(qr_data)
    qr_x0, qr_y0, qr_x1, qr_y1 = qr_widget.getBounds()
    qr_drawing = Drawing(qr_size, qr_size, transform=[qr_size / (qr_x1 - qr_x0), 0, 0, qr_size / (qr_y1 - qr_y0), 0, 0])
    qr_drawing.add(qr_widget)
    qr_drawing.hAlign = "CENTER"
    story.append(qr_drawing)
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            ar("مرجع داخلي للتحقق من هذا التقرير — لا يغني عن خطاب اعتماد المركز الوطني لتنمية القطاع غير الربحي"),
            ParagraphStyle("qr_note", fontName=FONT_NAME, fontSize=8, alignment=1, textColor=colors.HexColor("#666666")),
        )
    )

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

    # نعتمد السجل المدني إن وُجد، وإلا رقم العضوية كبديل، حتى تظهر البطاقة برمز قابل للمسح
    # حتى لأعضاء لم يُسجَّل سجلهم المدني بعد.
    code_identifier = member.national_id_or_cr or member.membership_number
    if code_identifier:
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.black)

        qr_size = 1.05 * cm
        qr_x = x + 0.35 * cm
        qr_y = y + 0.12 * cm
        qr_data = "|".join(
            [ASSOCIATION_NAME, member.full_name, code_identifier, str(member.membership_number or member.id)]
        )
        qr_widget = qr.QrCodeWidget(qr_data)
        qr_x0, qr_y0, qr_x1, qr_y1 = qr_widget.getBounds()
        qr_drawing = Drawing(
            qr_size, qr_size, transform=[qr_size / (qr_x1 - qr_x0), 0, 0, qr_size / (qr_y1 - qr_y0), 0, 0]
        )
        qr_drawing.add(qr_widget)
        renderPDF.draw(qr_drawing, c, qr_x, qr_y)

        barcode = code128.Code128(code_identifier, barHeight=0.85 * cm, barWidth=0.72)
        barcode_area_x = qr_x + qr_size + 0.25 * cm
        barcode_area_w = (x + _CARD_W - 0.35 * cm) - barcode_area_x
        barcode_x = barcode_area_x + max(0.0, (barcode_area_w - barcode.width) / 2)
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.black)
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


def _styled_table(rows: list[list[str]], h_align: str = "RIGHT") -> Table:
    table = Table(rows, hAlign=h_align)
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

MOHDALI_EOF

cat > app/services/membership_service.py << 'MOHDALI_EOF'
"""إدارة طلبات العضوية والأعضاء والاشتراكات."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.db.models import AssemblyAttendance, FeeStatus, Member, MemberStatus, MembershipFee, User
from app.services.audit import log_action


class MembershipError(Exception):
    pass


def _check_unique_fields(
    session: Session,
    member_id: int | None,
    membership_number: str | None,
    national_id_or_cr: str | None,
) -> None:
    """يتحقق أن رقم العضوية والسجل المدني غير مستخدمين لعضو آخر، ويرفع رسالة عربية واضحة عند التعارض
    بدلًا من ترك خطأ قاعدة البيانات الخام يصل للواجهة ويُعطّل الجلسة."""
    if membership_number:
        query = session.query(Member).filter(Member.membership_number == membership_number)
        if member_id is not None:
            query = query.filter(Member.id != member_id)
        conflict = query.first()
        if conflict is not None:
            raise MembershipError(f"رقم العضوية \"{membership_number}\" مستخدم بالفعل للعضو: {conflict.full_name}")
    if national_id_or_cr:
        query = session.query(Member).filter(Member.national_id_or_cr == national_id_or_cr)
        if member_id is not None:
            query = query.filter(Member.id != member_id)
        conflict = query.first()
        if conflict is not None:
            raise MembershipError(f"رقم الهوية/السجل \"{national_id_or_cr}\" مستخدم بالفعل للعضو: {conflict.full_name}")


def submit_membership_request(
    session: Session,
    actor: User,
    *,
    full_name: str,
    member_type: str,
    membership_number: str | None = None,
    national_id_or_cr: str | None = None,
    gender: str | None = None,
    birth_date: date | None = None,
    phone: str | None = None,
    email: str | None = None,
    address: str | None = None,
    qualification: str | None = None,
    city: str | None = None,
    occupation: str | None = None,
    join_date: date | None = None,
    is_founder: bool = False,
    notes: str | None = None,
) -> Member:
    _check_unique_fields(session, None, membership_number, national_id_or_cr)
    member = Member(
        full_name=full_name,
        membership_number=membership_number,
        member_type=member_type,
        national_id_or_cr=national_id_or_cr,
        gender=gender,
        birth_date=birth_date,
        phone=phone,
        email=email,
        address=address,
        qualification=qualification,
        city=city,
        occupation=occupation,
        join_date=join_date or date.today(),
        is_founder=is_founder,
        status=MemberStatus.PENDING,
        notes=notes,
    )
    session.add(member)
    session.flush()
    log_action(session, actor, "submit_membership_request", "member", member.id)
    session.commit()
    return member


def approve_membership(session: Session, actor: User, member: Member) -> None:
    if member.status not in (MemberStatus.PENDING, MemberStatus.SUSPENDED):
        raise MembershipError("لا يمكن قبول عضو ليس في حالة طلب معلّق أو موقوف")
    member.status = MemberStatus.ACTIVE
    log_action(session, actor, "approve_membership", "member", member.id)
    session.commit()


def reject_membership(session: Session, actor: User, member: Member, reason: str) -> None:
    if member.status != MemberStatus.PENDING:
        raise MembershipError("لا يمكن رفض عضو ليس في حالة طلب معلّق")
    member.status = MemberStatus.REJECTED
    member.notes = ((member.notes or "") + f"\nسبب الرفض: {reason}").strip()
    log_action(session, actor, "reject_membership", "member", member.id, details=reason)
    session.commit()


def suspend_membership(session: Session, actor: User, member: Member, reason: str) -> None:
    member.status = MemberStatus.SUSPENDED
    member.notes = ((member.notes or "") + f"\nسبب الإيقاف: {reason}").strip()
    log_action(session, actor, "suspend_membership", "member", member.id, details=reason)
    session.commit()


def withdraw_membership(session: Session, actor: User, member: Member) -> None:
    member.status = MemberStatus.WITHDRAWN
    log_action(session, actor, "withdraw_membership", "member", member.id)
    session.commit()


def delete_member(session: Session, actor: User, member: Member) -> None:
    """حذف عضو نهائيًا (لتصحيح تكرار ناتج عن استيراد، مثلًا). يُرفض الحذف إن كان للعضو سجل حضور/توكيل
    في اجتماع سابق للجمعية العمومية — استخدم إيقاف العضوية أو تسجيل الانسحاب في هذه الحالة بدلًا من الحذف."""
    has_history = (
        session.query(AssemblyAttendance)
        .filter(
            (AssemblyAttendance.member_id == member.id) | (AssemblyAttendance.proxy_holder_member_id == member.id)
        )
        .first()
    )
    if has_history is not None:
        raise MembershipError(
            "لا يمكن حذف هذا العضو لوجود سجل حضور/توكيل مرتبط به في اجتماع سابق للجمعية العمومية. "
            "استخدم \"إيقاف العضوية\" أو \"تسجيل انسحاب\" بدلًا من الحذف."
        )
    member_id = member.id
    details = f"{member.full_name} ({member.membership_number or '—'})"
    session.delete(member)
    log_action(session, actor, "delete_member", "member", member_id, details=details)
    session.commit()


def update_member(session: Session, actor: User, member: Member, **fields) -> Member:
    for key in fields:
        if not hasattr(member, key):
            raise MembershipError(f"حقل غير معروف: {key}")
    _check_unique_fields(
        session,
        member.id,
        fields.get("membership_number", member.membership_number),
        fields.get("national_id_or_cr", member.national_id_or_cr),
    )
    for key, value in fields.items():
        setattr(member, key, value)
    log_action(session, actor, "update_member", "member", member.id)
    session.commit()
    return member


def record_fee_payment(
    session: Session,
    actor: User,
    member: Member,
    *,
    fee_year: int,
    amount: float,
    paid_date: date | None = None,
    payment_method: str | None = None,
    receipt_number: str | None = None,
) -> MembershipFee:
    fee = (
        session.query(MembershipFee)
        .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == fee_year)
        .first()
    )
    if fee is None:
        fee = MembershipFee(member_id=member.id, fee_year=fee_year)
        session.add(fee)
    fee.amount = amount
    fee.paid_date = paid_date or date.today()
    fee.payment_method = payment_method
    fee.receipt_number = receipt_number
    fee.status = FeeStatus.PAID
    session.flush()
    log_action(session, actor, "record_fee_payment", "membership_fee", fee.id, details=f"year={fee_year}")
    session.commit()
    return fee


def list_members(
    session: Session, status: MemberStatus | None = None, search: str | None = None
) -> list[Member]:
    query = session.query(Member)
    if status is not None:
        query = query.filter(Member.status == status)
    if search:
        like = f"%{search}%"
        query = query.filter(Member.full_name.ilike(like))
    return query.order_by(Member.full_name).all()


def list_unpaid_active_members(session: Session, fee_year: int | None = None) -> list[Member]:
    """الأعضاء النشطون الذين لم يُسجَّل لهم سداد اشتراك (مقبول أو معفى) عن السنة المحددة."""
    fee_year = fee_year or date.today().year
    paid_member_ids = session.query(MembershipFee.member_id).filter(
        MembershipFee.fee_year == fee_year, MembershipFee.status.in_([FeeStatus.PAID, FeeStatus.WAIVED])
    )
    return (
        session.query(Member)
        .filter(Member.status == MemberStatus.ACTIVE, ~Member.id.in_(paid_member_ids))
        .order_by(Member.full_name)
        .all()
    )

MOHDALI_EOF

cat > app/ui/members/member_form_dialog.py << 'MOHDALI_EOF'
"""نموذج إضافة/تعديل عضو."""
from __future__ import annotations

from datetime import date

from PySide6.QtCore import QDate, Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDateEdit,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLineEdit,
    QScrollArea,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.db.models import Member

QUALIFICATIONS = ["تعليم عام", "الابتدائية", "المتوسطة", "الثانوية", "دبلوم متوسط", "جامعي", "دراسات عليا"]


class MemberFormDialog(QDialog):
    def __init__(self, parent=None, member: Member | None = None, member_types: list[str] | None = None):
        super().__init__(parent)
        self.member = member
        self.setWindowTitle("تعديل بيانات عضو" if member else "إضافة عضو جديد")
        self.setLayoutDirection(Qt.LayoutDirection.RightToLeft)
        self.setMinimumWidth(420)

        layout = QVBoxLayout(self)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        form_container = QWidget()
        form = QFormLayout(form_container)

        self.full_name = QLineEdit(member.full_name if member else "")
        self.membership_number = QLineEdit(member.membership_number or "" if member else "")
        self.member_type = QComboBox()
        self.member_type.setEditable(True)
        for t in member_types or ["مؤسس", "عامل", "منتسب", "شرف"]:
            self.member_type.addItem(t)
        if member:
            self.member_type.setCurrentText(member.member_type)

        self.national_id = QLineEdit(member.national_id_or_cr or "" if member else "")
        self.gender = QComboBox()
        self.gender.addItems(["ذكر", "أنثى"])
        if member and member.gender:
            self.gender.setCurrentText(member.gender)

        self.birth_date = QDateEdit(calendarPopup=True)
        self.birth_date.setDisplayFormat("yyyy-MM-dd")
        self.birth_date.setDate(
            QDate(member.birth_date.year, member.birth_date.month, member.birth_date.day)
            if member and member.birth_date
            else QDate(1980, 1, 1)
        )

        self.phone = QLineEdit(member.phone or "" if member else "")
        self.email = QLineEdit(member.email or "" if member else "")
        self.address = QLineEdit(member.address or "" if member else "")

        self.qualification = QComboBox()
        self.qualification.setEditable(True)
        self.qualification.addItems(QUALIFICATIONS)
        if member and member.qualification:
            self.qualification.setCurrentText(member.qualification)
        else:
            self.qualification.setCurrentText("")

        self.city = QLineEdit(member.city or "" if member else "")
        self.occupation = QLineEdit(member.occupation or "" if member else "")

        self.join_date = QDateEdit(calendarPopup=True)
        self.join_date.setDisplayFormat("yyyy-MM-dd")
        today = date.today()
        jd = member.join_date if member else today
        self.join_date.setDate(QDate(jd.year, jd.month, jd.day))

        self.is_founder = QCheckBox("عضو مؤسس")
        if member:
            self.is_founder.setChecked(member.is_founder)

        self.notes = QTextEdit(member.notes or "" if member else "")
        self.notes.setFixedHeight(70)

        form.addRow("الاسم الكامل:*", self.full_name)
        form.addRow("رقم العضوية:", self.membership_number)
        form.addRow("نوع العضوية:*", self.member_type)
        form.addRow("رقم الهوية/السجل:", self.national_id)
        form.addRow("الجنس:", self.gender)
        form.addRow("تاريخ الميلاد:", self.birth_date)
        form.addRow("الجوال:", self.phone)
        form.addRow("البريد الإلكتروني:", self.email)
        form.addRow("العنوان:", self.address)
        form.addRow("المؤهل العلمي:", self.qualification)
        form.addRow("المدينة:", self.city)
        form.addRow("العمل/المهنة:", self.occupation)
        form.addRow("تاريخ الانضمام:*", self.join_date)
        form.addRow("", self.is_founder)
        form.addRow("ملاحظات:", self.notes)

        scroll.setWidget(form_container)
        layout.addWidget(scroll)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("حفظ")
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("إلغاء")
        buttons.accepted.connect(self._on_accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self.values: dict | None = None
        self._size_to_screen()

    def _size_to_screen(self) -> None:
        """يحدّ ارتفاع نافذة الإضافة/التعديل بحجم الشاشة المتاحة، مع محتوى قابل للتمرير،
        حتى يبقى زرا الحفظ/الإلغاء ظاهرين دائمًا حتى على الشاشات الصغيرة."""
        screen = QGuiApplication.primaryScreen()
        if screen is None:
            self.resize(460, 640)
            return
        available = screen.availableGeometry()
        width = min(480, int(available.width() * 0.55))
        height = min(700, int(available.height() * 0.88))
        self.resize(width, height)

    def _on_accept(self) -> None:
        if not self.full_name.text().strip():
            self.full_name.setFocus()
            return
        qd_birth = self.birth_date.date()
        qd_join = self.join_date.date()
        self.values = {
            "full_name": self.full_name.text().strip(),
            "membership_number": self.membership_number.text().strip() or None,
            "member_type": self.member_type.currentText().strip(),
            "national_id_or_cr": self.national_id.text().strip() or None,
            "gender": self.gender.currentText(),
            "birth_date": date(qd_birth.year(), qd_birth.month(), qd_birth.day()),
            "phone": self.phone.text().strip() or None,
            "email": self.email.text().strip() or None,
            "address": self.address.text().strip() or None,
            "qualification": self.qualification.currentText().strip() or None,
            "city": self.city.text().strip() or None,
            "occupation": self.occupation.text().strip() or None,
            "join_date": date(qd_join.year(), qd_join.month(), qd_join.day()),
            "is_founder": self.is_founder.isChecked(),
            "notes": self.notes.toPlainText().strip() or None,
        }
        self.accept()

MOHDALI_EOF

cat > app/ui/members/members_view.py << 'MOHDALI_EOF'
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
from app.services import export_service, import_service, membership_service
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
STANDARD_MEMBER_TYPES = ["مؤسس", "عامل", "منتسب", "شرف", "داعم"]


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

        export_btn = QPushButton("تصدير إلى Excel")
        export_btn.clicked.connect(self._on_export)

        toolbar.addWidget(self.search_input)
        toolbar.addWidget(self.status_filter)
        toolbar.addStretch()
        toolbar.addWidget(export_btn)
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
        self.delete_btn = QPushButton("حذف")
        for btn in (
            self.edit_btn,
            self.approve_btn,
            self.reject_btn,
            self.suspend_btn,
            self.withdraw_btn,
            self.fee_btn,
            self.delete_btn,
        ):
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
        self.delete_btn.clicked.connect(self._on_delete)
        self.cards_btn.clicked.connect(self._on_print_cards)

        self.refresh()

    def _selected_member(self) -> Member | None:
        row = self.table.currentRow()
        if row < 0:
            return None
        member_id = self.table.item(row, 0).data(Qt.ItemDataRole.UserRole)
        return self.ctx.session.get(Member, member_id)

    def _filtered_members(self) -> list[Member]:
        status_label = self.status_filter.currentText()
        status = None
        if status_label != "الكل":
            status = next(s for s, label in STATUS_LABELS.items() if label == status_label)
        return membership_service.list_members(self.ctx.session, status=status, search=self.search_input.text().strip() or None)

    def refresh(self) -> None:
        members = self._filtered_members()

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
        return sorted(types | set(STANDARD_MEMBER_TYPES))

    def _on_add(self) -> None:
        dialog = MemberFormDialog(self, member_types=self._existing_member_types())
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            try:
                membership_service.submit_membership_request(self.ctx.session, self.ctx.current_user, **dialog.values)
                self.refresh()
            except membership_service.MembershipError as exc:
                self.ctx.session.rollback()
                show_error(self, str(exc))
            except Exception as exc:  # noqa: BLE001
                self.ctx.session.rollback()
                show_error(self, f"تعذر حفظ العضو: {exc}")

    def _on_edit(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        dialog = MemberFormDialog(self, member=member, member_types=self._existing_member_types())
        if dialog.exec() == QDialog.DialogCode.Accepted and dialog.values:
            try:
                membership_service.update_member(self.ctx.session, self.ctx.current_user, member, **dialog.values)
                self.refresh()
            except membership_service.MembershipError as exc:
                self.ctx.session.rollback()
                show_error(self, str(exc))
            except Exception as exc:  # noqa: BLE001
                self.ctx.session.rollback()
                show_error(self, f"تعذر حفظ التعديلات: {exc}")

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

    def _on_delete(self) -> None:
        member = self._selected_member()
        if member is None:
            return
        if not confirm(
            self,
            f"هل تريد حذف العضو \"{member.full_name}\" نهائيًا من النظام؟\n"
            "هذا الإجراء لا يمكن التراجع عنه. يُستخدم لتصحيح تكرار ناتج عن استيراد بيانات، وليس لعضو له سجل حضور فعلي.",
        ):
            return
        try:
            membership_service.delete_member(self.ctx.session, self.ctx.current_user, member)
            self.refresh()
        except membership_service.MembershipError as exc:
            show_error(self, str(exc))

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

    def _on_export(self) -> None:
        members = self._filtered_members()
        if not members:
            show_error(self, "لا يوجد أعضاء لتصديرهم وفق الفلتر الحالي")
            return
        path, _ = QFileDialog.getSaveFileName(self, "تصدير بيانات الأعضاء", "بيانات-الأعضاء.xlsx", "Excel (*.xlsx)")
        if not path:
            return
        try:
            export_service.export_members_to_excel(self.ctx.session, members, path)
            show_info(self, f"تم تصدير {len(members)} عضوًا إلى: {path}")
        except Exception as exc:  # noqa: BLE001
            show_error(self, f"تعذر تصدير البيانات: {exc}")

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

MOHDALI_EOF

cat > tests/test_card_export.py << 'MOHDALI_EOF'
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


def test_generate_membership_cards_uses_membership_number_when_no_national_id(db_session, admin_user, tmp_path):
    """يجب أن يظهر باركود/QR بالاعتماد على رقم العضوية عند غياب السجل المدني، بدلًا من إخفائهما."""
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="رقم عضوية فقط", member_type="عادية", membership_number="99", join_date=date(2020, 1, 1)
    )
    membership_service.approve_membership(db_session, admin_user, member)

    output_path = str(tmp_path / "cards_membership_number_only.pdf")
    generate_membership_cards(db_session, [member], output_path)

    with open(output_path, "rb") as f:
        content = f.read()
    assert content.startswith(b"%PDF")
    assert len(content) > 1000
MOHDALI_EOF

cat > tests/test_membership_service.py << 'MOHDALI_EOF'
from datetime import date

import pytest

from app.db.models import AssemblyType, MemberStatus
from app.services import assembly_service, membership_service


def test_submit_and_approve_membership(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="أحمد علي", member_type="عامل", join_date=date.today()
    )
    assert member.status == MemberStatus.PENDING

    membership_service.approve_membership(db_session, admin_user, member)
    assert member.status == MemberStatus.ACTIVE


def test_cannot_approve_already_active_member(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="سعيد محمد", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    with pytest.raises(membership_service.MembershipError):
        membership_service.approve_membership(db_session, admin_user, member)


def test_reject_membership_records_reason(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="خالد سالم", member_type="عامل", join_date=date.today()
    )
    membership_service.reject_membership(db_session, admin_user, member, reason="عدم استيفاء الشروط")
    assert member.status == MemberStatus.REJECTED
    assert "عدم استيفاء الشروط" in member.notes


def test_record_fee_payment_updates_status(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="منى فهد", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    fee = membership_service.record_fee_payment(
        db_session, admin_user, member, fee_year=date.today().year, amount=150
    )
    assert fee.status.value == "paid"
    assert fee.amount == 150


def test_delete_member_removes_duplicate_without_history(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="نسخة مكررة", member_type="عامل", join_date=date.today()
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)
    member_id = member.id

    membership_service.delete_member(db_session, admin_user, member)

    assert db_session.get(type(member), member_id) is None


def test_delete_member_blocked_when_has_assembly_attendance(db_session, admin_user):
    join_date = date.today().replace(year=date.today().year - 1)
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو له سجل حضور", member_type="عامل", join_date=join_date
    )
    membership_service.approve_membership(db_session, admin_user, member)
    membership_service.record_fee_payment(db_session, admin_user, member, fee_year=date.today().year, amount=100)

    assembly = assembly_service.create_assembly(
        db_session, admin_user, title="اجتماع اختبار الحذف", type=AssemblyType.ORDINARY, meeting_date=date.today()
    )
    assembly_service.open_assembly(db_session, admin_user, assembly)
    assembly_service.check_in_member(db_session, admin_user, assembly, member)

    with pytest.raises(membership_service.MembershipError, match="سجل حضور"):
        membership_service.delete_member(db_session, admin_user, member)


def test_submit_rejects_duplicate_membership_number(db_session, admin_user):
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو أول", member_type="عامل", membership_number="55", join_date=date.today()
    )
    with pytest.raises(membership_service.MembershipError, match="رقم العضوية"):
        membership_service.submit_membership_request(
            db_session, admin_user, full_name="عضو ثانٍ", member_type="عامل", membership_number="55", join_date=date.today()
        )


def test_submit_rejects_duplicate_national_id(db_session, admin_user):
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو أول", member_type="عامل", national_id_or_cr="1000000001", join_date=date.today()
    )
    with pytest.raises(membership_service.MembershipError, match="السجل"):
        membership_service.submit_membership_request(
            db_session, admin_user, full_name="عضو ثانٍ", member_type="عامل", national_id_or_cr="1000000001", join_date=date.today()
        )


def test_update_member_rejects_conflicting_membership_number(db_session, admin_user):
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو أول", member_type="عامل", membership_number="60", join_date=date.today()
    )
    other = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو ثانٍ", member_type="عامل", membership_number="61", join_date=date.today()
    )
    with pytest.raises(membership_service.MembershipError, match="رقم العضوية"):
        membership_service.update_member(db_session, admin_user, other, membership_number="60")


def test_update_member_allows_keeping_its_own_membership_number(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو", member_type="عامل", membership_number="70", join_date=date.today()
    )
    membership_service.update_member(db_session, admin_user, member, phone="0500000000", membership_number="70")
    assert member.phone == "0500000000"
    assert member.membership_number == "70"


def test_update_member_saves_phone_field(db_session, admin_user):
    member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو للتحديث", member_type="عامل", join_date=date.today()
    )
    membership_service.update_member(db_session, admin_user, member, phone="0512345678")
    assert member.phone == "0512345678"

MOHDALI_EOF

cat > tests/test_ui_smoke.py << 'MOHDALI_EOF'
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
    # اللائحة الأساسية + المستخدمون + البريد الإلكتروني + سجل التدقيق + النسخ الاحتياطي
    assert view.count() >= 5


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


def test_audit_log_tab_builds_and_lists_entries(qapp, db_session, admin_user):
    ctx = _make_ctx(db_session, admin_user)
    _seed_sample_data(db_session, admin_user)
    from app.ui.settings.audit_log_tab import AuditLogTab

    view = AuditLogTab(ctx)
    assert view.table.rowCount() > 0


def test_members_view_add_shows_error_and_keeps_session_usable_on_duplicate(qapp, db_session, admin_user, monkeypatch):
    """يحمي من علة سابقة: خطأ عدم قبول الحفظ (تعارض رقم عضوية/سجل مدني) كان يمر بصمت ويعطّل الجلسة للاستخدام لاحقًا."""
    from app.ui.common import show_error as show_error_fn

    ctx = _make_ctx(db_session, admin_user)
    membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو موجود", member_type="عامل", membership_number="200", join_date=date.today()
    )

    view = MembersView(ctx)

    errors = []
    import app.ui.members.members_view as members_view_module

    monkeypatch.setattr(members_view_module, "show_error", lambda parent, msg: errors.append(msg))

    class _FakeDialog:
        DialogCode = None
        values = {
            "full_name": "عضو جديد",
            "member_type": "عامل",
            "membership_number": "200",  # تعارض متعمد
            "national_id_or_cr": None,
            "gender": "ذكر",
            "birth_date": date(1990, 1, 1),
            "phone": None,
            "email": None,
            "address": None,
            "qualification": None,
            "city": None,
            "occupation": None,
            "join_date": date.today(),
            "is_founder": False,
            "notes": None,
        }

        def exec(self):
            from PySide6.QtWidgets import QDialog

            return QDialog.DialogCode.Accepted

    monkeypatch.setattr(members_view_module, "MemberFormDialog", lambda *a, **k: _FakeDialog())

    view._on_add()

    assert len(errors) == 1
    assert "200" in errors[0]

    # الجلسة يجب أن تبقى صالحة للاستخدام بعد الخطأ (لا يوجد PendingRollbackError متبقٍ)
    fresh_member = membership_service.submit_membership_request(
        db_session, admin_user, full_name="عضو بعد الخطأ", member_type="عامل", join_date=date.today()
    )
    assert fresh_member.id is not None


def test_bylaw_settings_tab_does_not_overwrite_board_term_end_date(qapp, db_session, admin_user, monkeypatch):
    """يحمي من علة سابقة: تبويب اللائحة الأساسية المفتوح بقيمة قديمة كان يمسح تاريخ نهاية المجلس عند الحفظ."""
    from app.services import bylaw_settings_service
    from app.ui.settings import settings_view
    from app.ui.settings.settings_view import BylawSettingsTab

    monkeypatch.setattr(settings_view, "show_info", lambda *args, **kwargs: None)

    ctx = _make_ctx(db_session, admin_user)
    stale_tab = BylawSettingsTab(ctx)  # يُبنى بينما board_term_end_date ما زال فارغًا

    bylaw_settings_service.update_setting(db_session, admin_user, "board_term_end_date", "2030-04-17")

    stale_tab._on_save()  # حفظ من التبويب القديم يجب ألا يمسح القيمة المحفوظة حديثًا
    assert bylaw_settings_service.get_settings(db_session).board_term_end_date == "2030-04-17"

MOHDALI_EOF

echo "تم تحديث الملفات بنجاح"
