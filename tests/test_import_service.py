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

