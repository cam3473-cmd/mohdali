mkdir -p app/services tests

cat > app/services/import_service.py << 'MOHDALI_EOF'
"""استيراد بيانات الأعضاء من ملف Excel (سجل الجمعية الحالي) إلى النظام.

يتعامل مع خصوصيات السجلات الورقية/الجدولية الشائعة لدى الجمعيات الأهلية:
تواريخ هجرية أو ميلادية مختلطة (أحيانًا سنة فقط)، وأعمدة قد تختلف تسميتها
قليلًا بين نسخ الملف (مثل "حالة السداد" مقابل "السداد").
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import openpyxl
from hijridate import Hijri
from sqlalchemy.orm import Session

from app.db.models import BoardPosition, FeeStatus, Member, MemberStatus, MembershipFee, User
from app.services.audit import log_action
from app.services.bylaw_settings_service import get_settings

# تسميات محتملة لكل عمود (يُطابَق النص بعد إزالة التطويل والمسافات الزائدة)
CANONICAL_HEADERS: dict[str, list[str]] = {
    "full_name": ["الاسم", "الاسم الكامل", "اسم العضو"],
    "membership_number": ["رقم عضوية", "رقم العضوية"],
    "join_date_raw": ["تاريخ بدء العضوية", "تاريخ الانضمام"],
    "member_type": ["نوع العضوية"],
    "position": ["المنصب الحالي", "المنصب"],
    "payment_status": ["حالة السداد", "السداد"],
    "fee_amount": ["قيمة الاشتراك"],
    "active_flag": ["فعال"],
    "receipt_number": ["رقم القيد", "رقم السند"],
    "national_id": ["السجل", "رقم الهوية", "رقم الهوية/السجل"],
    "birth_date_raw": ["تاريخ الميلاد"],
    "phone": ["الجوال", "رقم الجوال"],
    "gender": ["الجنس"],
    "qualification": ["المؤهل"],
    "city": ["المدينة"],
    "occupation": ["العمل"],
}

# مناصب لا تُعتبر منصبًا فعليًا في مجلس الإدارة (تعني عضوًا عاملاً عاديًا فقط)
NON_BOARD_POSITION_VALUES = {"", "عضو عامل", "عضو", "-", "—"}

TRUTHY_ACTIVE_VALUES = {"þ", "true", "1", "نعم", "✓", "yes", "فعال"}
FALSY_ACTIVE_VALUES = {"ý", "false", "0", "لا", "✗", "no", "غير فعال"}

PAID_STATUS_VALUES = {"منتظم", "سدد", "سدد بالوقت", "paid"}


@dataclass
class ImportReport:
    created: int = 0
    updated: int = 0
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _normalize_header(value) -> str:
    if value is None:
        return ""
    text = str(value).replace("ـ", "")  # إزالة حرف التطويل
    return " ".join(text.split()).strip()


def list_sheet_names(file_path: str) -> list[str]:
    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    return wb.sheetnames


def _find_header_row(ws) -> tuple[int, dict[str, int]]:
    max_scan = min(ws.max_row, 10)
    for row_idx in range(1, max_scan + 1):
        col_map: dict[str, int] = {}
        for col_idx, cell in enumerate(ws[row_idx], start=1):
            normalized = _normalize_header(cell.value)
            for field_name, variants in CANONICAL_HEADERS.items():
                if normalized in variants and field_name not in col_map:
                    col_map[field_name] = col_idx
        if "full_name" in col_map:
            return row_idx, col_map
    raise ValueError("تعذر العثور على صف العناوين في الملف (لم يتم التعرف على عمود الاسم)")


def _parse_year_only(value) -> dt.date | None:
    """يحوّل قيمة سنة فقط (هجرية إن كانت صغيرة، وإلا ميلادية) إلى تاريخ تقريبي (1/1)."""
    try:
        year = int(float(value))
    except (TypeError, ValueError):
        return None
    if year <= 0:
        return None
    if year <= 1500:  # سنة هجرية غالبًا
        try:
            g = Hijri(year, 1, 1).to_gregorian()
            return dt.date(g.year, g.month, g.day)
        except Exception:
            return None
    return dt.date(year, 1, 1)


def _parse_flexible_date(value) -> dt.date | None:
    """يحوّل تاريخًا قد يكون: كائن تاريخ ميلادي جاهز، نص هجري (فواصل /)، أو سنة فقط."""
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, (int, float)):
        return _parse_year_only(value)

    text = str(value).strip()
    if not text:
        return None
    if "/" in text or "-" in text:
        sep = "/" if "/" in text else "-"
        parts = [p for p in text.split(sep) if p.strip()]
        try:
            nums = [int(p) for p in parts]
        except ValueError:
            return None
        if len(nums) != 3:
            return None
        # حدد الرقم الذي يمثل السنة (القيمة الكبيرة > 31، لأن اليوم/الشهر لا يتجاوزان ذلك)
        year_idx = max(range(3), key=lambda i: nums[i])
        year = nums[year_idx]
        remaining = [n for i, n in enumerate(nums) if i != year_idx]
        month, day = (remaining[0], remaining[1]) if year_idx == 0 else (remaining[1], remaining[0])
        month = max(1, min(month, 12))
        day = max(1, min(day, 28))
        try:
            g = Hijri(year, month, day).to_gregorian()
            return dt.date(g.year, g.month, g.day)
        except Exception:
            return None
    return _parse_year_only(text)


def _interpret_active_flag(value) -> bool:
    text = _normalize_header(value).lower()
    if text in FALSY_ACTIVE_VALUES:
        return False
    if text in TRUTHY_ACTIVE_VALUES:
        return True
    return True  # افتراضيًا نعتبر العضو فعالًا ما لم يُذكر صراحة أنه غير ذلك


def import_members_from_excel(
    session: Session,
    actor: User,
    file_path: str,
    sheet_name: str | None = None,
    fee_year: int | None = None,
) -> ImportReport:
    report = ImportReport()
    fee_year = fee_year or dt.date.today().year

    wb = openpyxl.load_workbook(file_path, data_only=True)
    ws = wb[sheet_name] if sheet_name else wb.active
    header_row, col_map = _find_header_row(ws)

    settings = get_settings(session)
    imported_member_types: set[str] = set()

    for row_idx in range(header_row + 1, ws.max_row + 1):
        row_cells = ws[row_idx]

        def get(field_name: str):
            col = col_map.get(field_name)
            return row_cells[col - 1].value if col else None

        full_name = _normalize_header(get("full_name"))
        if not full_name:
            continue

        membership_number = _normalize_header(get("membership_number")) or None
        national_id = _normalize_header(get("national_id")) or None

        existing = None
        if national_id:
            existing = session.query(Member).filter(Member.national_id_or_cr == national_id).first()
        if existing is None and membership_number:
            existing = session.query(Member).filter(Member.membership_number == membership_number).first()
        if existing is None:
            # مطابقة أخيرة بالاسم الكامل لتفادي إنشاء عضو مكرر عند غياب/اختلاف السجل المدني ورقم العضوية
            existing = session.query(Member).filter(Member.full_name == full_name).first()

        member_type = _normalize_header(get("member_type")) or "عادية"
        imported_member_types.add(member_type)

        join_date = _parse_flexible_date(get("join_date_raw")) or dt.date.today()
        birth_date = _parse_flexible_date(get("birth_date_raw"))
        phone_raw = get("phone")
        phone = str(int(phone_raw)) if isinstance(phone_raw, float) else (str(phone_raw).strip() if phone_raw else None)
        gender = _normalize_header(get("gender")) or None
        qualification = _normalize_header(get("qualification")) or None
        city = _normalize_header(get("city")) or None
        occupation = _normalize_header(get("occupation")) or None
        is_active = _interpret_active_flag(get("active_flag"))

        if existing is None:
            member = Member(
                membership_number=membership_number,
                national_id_or_cr=national_id,
                full_name=full_name,
                member_type=member_type,
                join_date=join_date,
                birth_date=birth_date,
                phone=phone,
                gender=gender,
                qualification=qualification,
                city=city,
                occupation=occupation,
                status=MemberStatus.ACTIVE if is_active else MemberStatus.SUSPENDED,
            )
            session.add(member)
            session.flush()
            log_action(session, actor, "import_member_created", "member", member.id, details=f"row={row_idx}")
            report.created += 1
        else:
            # عضو موجود مسبقًا: نُكمل الحقول الفارغة فقط، ولا نستبدل أي بيانات مُدخَلة سلفًا
            member = existing
            member.full_name = member.full_name or full_name
            member.member_type = member.member_type or member_type
            member.membership_number = member.membership_number or membership_number
            member.national_id_or_cr = member.national_id_or_cr or national_id
            member.birth_date = member.birth_date or birth_date
            member.phone = member.phone or phone
            member.gender = member.gender or gender
            member.qualification = member.qualification or qualification
            member.city = member.city or city
            member.occupation = member.occupation or occupation
            log_action(session, actor, "import_member_updated", "member", member.id, details=f"row={row_idx}")
            report.updated += 1

        payment_status = _normalize_header(get("payment_status"))
        fee_amount = get("fee_amount") or 0
        if payment_status in PAID_STATUS_VALUES and fee_amount:
            fee = (
                session.query(MembershipFee)
                .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == fee_year)
                .first()
            )
            if fee is None:
                fee = MembershipFee(member_id=member.id, fee_year=fee_year)
                session.add(fee)
            fee.amount = float(fee_amount)
            fee.status = FeeStatus.PAID
            receipt = get("receipt_number")
            fee.receipt_number = str(int(receipt)) if isinstance(receipt, float) else (str(receipt) if receipt else None)

        position_title = _normalize_header(get("position"))
        if position_title and position_title not in NON_BOARD_POSITION_VALUES:
            has_current = (
                session.query(BoardPosition)
                .filter(
                    BoardPosition.member_id == member.id,
                    BoardPosition.title == position_title,
                    BoardPosition.end_date.is_(None),
                )
                .first()
            )
            if not has_current:
                session.add(BoardPosition(member_id=member.id, title=position_title, start_date=None))

        if not birth_date and get("birth_date_raw"):
            report.warnings.append(f"سطر {row_idx} ({full_name}): تعذر تفسير تاريخ الميلاد '{get('birth_date_raw')}'")

    session.commit()

    missing_voting_types = imported_member_types - set(settings.voting_member_types)
    if missing_voting_types:
        report.warnings.append(
            "أنواع عضوية مستوردة غير مدرجة ضمن 'أنواع العضوية المصوّتة' الحالية في الإعدادات: "
            + "، ".join(sorted(missing_voting_types))
            + " — راجع شاشة الإعدادات إذا كان يجب أن تمنح هذه الأنواع حق التصويت."
        )

    return report

MOHDALI_EOF

cat > tests/test_import_service.py << 'MOHDALI_EOF'
import datetime as dt

import openpyxl
import pytest

from app.db.models import BoardPosition, Member, MemberStatus, MembershipFee
from app.services import import_service


HEADERS = [
    "م",
    "الاسم",
    "رقم عضوية",
    "تاريخ بدء العضوية",
    "نوع العضوية",
    "المنصب الحالي",
    "حالة السداد",
    "قيمة الاشتراك",
    "فعال",
    "رقم القيد",
    "السجل",
    "تاريخ الميلاد",
    "الجوال",
    "الجنس",
    "المؤهل",
    "المدينة",
    "العمل",
]


def _build_workbook(rows: list[list], tmp_path) -> str:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["بيانات أعضاء تجريبية"])
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    path = str(tmp_path / "sample.xlsx")
    wb.save(path)
    return path


def test_import_creates_members_with_hijri_year_join_date(db_session, admin_user, tmp_path):
    rows = [
        [1, "سالم تجريبي", "101", 1415, "عادية", "عضو عامل", "منتظم", 300, "þ", 2001, "1011111111",
         "1369/07/01", 500000001, "ذكر", "جامعي", "السليل", "متقاعد"],
    ]
    path = _build_workbook(rows, tmp_path)

    report = import_service.import_members_from_excel(db_session, admin_user, path, fee_year=2026)

    assert report.created == 1
    member = db_session.query(Member).filter(Member.membership_number == "101").first()
    assert member is not None
    assert member.full_name == "سالم تجريبي"
    assert member.status == MemberStatus.ACTIVE
    assert member.join_date.year < 2000  # سنة 1415 هجرية تقع في التسعينات ميلاديًا
    assert member.birth_date is not None
    assert member.birth_date.year == 1950  # 1369/07/01 هـ يوافق تقريبًا 1950 م


def test_import_gregorian_datetime_birth_date_and_year_only_join(db_session, admin_user, tmp_path):
    rows = [
        [1, "فهد تجريبي", "102", 2021, "عادية", "عضو مجلس الإدارة", "منتظم", 300, "þ", 2002, "1022222222",
         dt.datetime(1985, 1, 30), 500000002, "ذكر", "جامعي", "السليل", "موظف حكومي"],
    ]
    path = _build_workbook(rows, tmp_path)

    report = import_service.import_members_from_excel(db_session, admin_user, path, fee_year=2026)

    assert report.created == 1
    member = db_session.query(Member).filter(Member.membership_number == "102").first()
    assert member.join_date == dt.date(2021, 1, 1)
    assert member.birth_date == dt.date(1985, 1, 30)

    position = (
        db_session.query(BoardPosition)
        .filter(BoardPosition.member_id == member.id, BoardPosition.end_date.is_(None))
        .first()
    )
    assert position is not None
    assert position.title == "عضو مجلس الإدارة"


def test_import_inactive_member_from_wingding_flag_and_no_fee_recorded(db_session, admin_user, tmp_path):
    rows = [
        [1, "غير منتظم تجريبي", "103", 1416, "عادية", "عضو عامل", "غير منتظم", 0, "ý", 0, "1033333333",
         None, None, "ذكر", None, "السليل", None],
    ]
    path = _build_workbook(rows, tmp_path)

    report = import_service.import_members_from_excel(db_session, admin_user, path, fee_year=2026)

    assert report.created == 1
    member = db_session.query(Member).filter(Member.membership_number == "103").first()
    assert member.status == MemberStatus.SUSPENDED
    fee = db_session.query(MembershipFee).filter(MembershipFee.member_id == member.id).first()
    assert fee is None


def test_reimport_matches_by_national_id_and_only_fills_missing_fields(db_session, admin_user, tmp_path):
    rows = [
        [1, "محدث تجريبي", "104", 1420, "عادية", "عضو عامل", "منتظم", 300, "þ", 2004, "1044444444",
         None, 500000004, "ذكر", "جامعي", "السليل", "متقاعد"],
    ]
    path = _build_workbook(rows, tmp_path)
    report1 = import_service.import_members_from_excel(db_session, admin_user, path, fee_year=2026)
    assert report1.created == 1

    # إعادة استيراد بنفس رقم الهوية (من ملف آخر باسم مختلف قليلًا ومؤهل فارغ) يجب أن يحدّث
    # نفس السجل لا أن ينشئ سجلًا جديدًا، مع إبقاء الاسم والمؤهل الأصليين دون استبدال (نُكمل الفراغات فقط)
    rows[0][1] = "اسم مختلف من ملف آخر"
    rows[0][14] = None  # المؤهل فارغ في الملف الثاني
    path2 = _build_workbook(rows, tmp_path)
    report2 = import_service.import_members_from_excel(db_session, admin_user, path2, fee_year=2026)

    assert report2.created == 0
    assert report2.updated == 1
    members = db_session.query(Member).filter(Member.national_id_or_cr == "1044444444").all()
    assert len(members) == 1
    assert members[0].full_name == "محدث تجريبي"  # لم يُستبدَل
    assert members[0].qualification == "جامعي"  # لم يُمسح رغم فراغه في الملف الثاني


def test_reimport_matches_by_full_name_when_no_national_id(db_session, admin_user, tmp_path):
    rows = [
        [1, "بلا سجل مدني", "", 1420, "عادية", "عضو عامل", "منتظم", 300, "þ", 0, "",
         None, "", "ذكر", "", "", ""],
    ]
    path = _build_workbook(rows, tmp_path)
    report1 = import_service.import_members_from_excel(db_session, admin_user, path, fee_year=2026)
    assert report1.created == 1

    # إعادة استيراد بنفس الاسم ولكن بدون رقم عضوية أو سجل مدني في كلا الملفين — يجب المطابقة بالاسم
    # وإكمال الحقول الفارغة (المؤهل) دون إنشاء عضو مكرر
    rows[0][14] = "جامعي"
    path2 = _build_workbook(rows, tmp_path)
    report2 = import_service.import_members_from_excel(db_session, admin_user, path2, fee_year=2026)

    assert report2.created == 0
    assert report2.updated == 1
    members = db_session.query(Member).filter(Member.full_name == "بلا سجل مدني").all()
    assert len(members) == 1
    assert members[0].qualification == "جامعي"


def test_missing_voting_member_type_produces_warning(db_session, admin_user, tmp_path):
    rows = [
        [1, "نوع غير معروف", "105", 2020, "عادية", "عضو عامل", "منتظم", 300, "þ", 2005, "1055555555",
         None, None, "ذكر", None, "السليل", None],
    ]
    path = _build_workbook(rows, tmp_path)
    report = import_service.import_members_from_excel(db_session, admin_user, path, fee_year=2026)
    assert any("عادية" in w for w in report.warnings)

MOHDALI_EOF

echo "تم تحديث الملفات بنجاح"
