"""توليد محضر اجتماع الجمعية العمومية بصيغة PDF مع دعم النص العربي (RTL)."""
from __future__ import annotations

import base64
import io
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.db.models import Assembly
from app.services import assembly_service

FONTS_DIR = Path(__file__).resolve().parent.parent / "resources" / "fonts"
FONT_NAME = "Amiri"
FONT_BOLD_NAME = "Amiri-Bold"

DECISION_RESULT_LABELS_AR = {"pending": "لم يُصوَّت بعد", "approved": "معتمد", "rejected": "مرفوض"}
ATTENDANCE_LABELS_AR = {"in_person": "حضور شخصي", "proxy": "بالتوكيل"}

_fonts_registered = False


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


def generate_assembly_minutes(session, assembly: Assembly, output_path: str) -> None:
    _ensure_fonts_registered()

    styles = {
        "title": ParagraphStyle("title", fontName=FONT_BOLD_NAME, fontSize=16, alignment=1, spaceAfter=12),
        "heading": ParagraphStyle("heading", fontName=FONT_BOLD_NAME, fontSize=13, alignment=2, spaceBefore=10, spaceAfter=6),
        "body": ParagraphStyle("body", fontName=FONT_NAME, fontSize=11, alignment=2, leading=16),
    }

    doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm, topMargin=2 * cm, bottomMargin=2 * cm)
    story = []

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
    story = [
        Paragraph(ar("جمعية البر الخيرية بمحافظة السليل"), styles["title"]),
        Paragraph(ar(f"كشف دعوة الأعضاء المؤهلين — {assembly.title} ({assembly.meeting_date.isoformat()})"), styles["title"]),
        Spacer(1, 8),
    ]

    eligible = assembly_service.get_eligible_members(session, assembly)
    rows = [[ar("رقم الجوال"), ar("نوع العضوية"), ar("اسم العضو"), "#"]]
    for i, member in enumerate(eligible, start=1):
        rows.append([ar(member.phone or "—"), ar(member.member_type), ar(member.full_name), str(i)])
    story.append(_styled_table(rows))

    doc.build(story)


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

