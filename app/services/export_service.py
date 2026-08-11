"""تصدير بيانات الأعضاء إلى ملف Excel.

يستخدم نفس عناوين الأعمدة التي تتعرف عليها أداة الاستيراد (import_service)،
بحيث يمكن تعديل الملف الناتج وإعادة استيراده لاحقًا دون أي تحويل إضافي.
"""
from __future__ import annotations

import datetime as dt

import openpyxl
from openpyxl.styles import Font
from sqlalchemy.orm import Session

from app.db.models import BoardPosition, FeeStatus, Member, MemberStatus, MembershipFee

EXPORT_HEADERS = [
    "م",
    "الاسم",
    "رقم عضوية",
    "تاريخ بدء العضوية",
    "نوع العضوية",
    "المنصب الحالي",
    "السداد",
    "قيمة الاشتراك",
    "فعال",
    "رقم السند",
    "السجل",
    "تاريخ الميلاد",
    "الجوال",
    "الجنس",
    "المؤهل",
    "المدينة",
    "العمل",
    "الحالة",
]

STATUS_LABELS_AR = {
    MemberStatus.ACTIVE: "نشط",
    MemberStatus.SUSPENDED: "موقوف",
    MemberStatus.WITHDRAWN: "منسحب",
    MemberStatus.REJECTED: "مرفوض",
    MemberStatus.PENDING: "طلب معلّق",
}


def export_members_to_excel(
    session: Session, members: list[Member], output_path: str, fee_year: int | None = None
) -> None:
    fee_year = fee_year or dt.date.today().year

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "الأعضاء"
    ws.sheet_view.rightToLeft = True
    ws.append(EXPORT_HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True)

    for index, member in enumerate(members, start=1):
        position = (
            session.query(BoardPosition)
            .filter(BoardPosition.member_id == member.id, BoardPosition.end_date.is_(None))
            .first()
        )
        fee = (
            session.query(MembershipFee)
            .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == fee_year)
            .first()
        )
        fee_paid = fee is not None and fee.status in (FeeStatus.PAID, FeeStatus.WAIVED)

        ws.append(
            [
                index,
                member.full_name,
                member.membership_number or "",
                member.join_date.isoformat() if member.join_date else "",
                member.member_type,
                position.title if position else "",
                "منتظم" if fee_paid else "غير منتظم",
                fee.amount if fee else "",
                "نعم" if member.status == MemberStatus.ACTIVE else "لا",
                fee.receipt_number if fee else "",
                member.national_id_or_cr or "",
                member.birth_date.isoformat() if member.birth_date else "",
                member.phone or "",
                member.gender or "",
                member.qualification or "",
                member.city or "",
                member.occupation or "",
                STATUS_LABELS_AR.get(member.status, member.status.value),
            ]
        )

    for column_cells in ws.columns:
        length = max(len(str(cell.value)) if cell.value is not None else 0 for cell in column_cells)
        ws.column_dimensions[column_cells[0].column_letter].width = min(max(length + 2, 10), 40)

    wb.save(output_path)
