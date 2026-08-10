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


