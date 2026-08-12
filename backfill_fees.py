"""سكربت لمرة واحدة: تعبئة سجل سداد الاشتراك السنوي لكل الأعضاء (النشطين والموقوفين) من سنة
انضمامهم حتى سنة 2026، باعتبار أنهم سددوا كل سنة — باستثناء الأعضاء الأربعة أدناه الذين يتوقف
سدادهم فعليًا عند السنة المحددة لكل منهم (فيبقون متأخرين لما بعدها).

الاستخدام (من مجلد المشروع، بعد تفعيل البيئة الافتراضية):
    source .venv/Scripts/activate
    python backfill_fees.py

آمن لإعادة التشغيل أكثر من مرة: لا يُنشئ سندًا لسنة لها سند سداد مسجَّل مسبقًا (لن يكرر أو يستبدل شيئًا).

⚠️ يُنصح بأخذ نسخة احتياطية أولًا من الإعدادات ← النسخ الاحتياطي قبل التشغيل.
"""
from __future__ import annotations

from app.db.models import FeeStatus, Member, MemberStatus, MembershipFee
from app.db.session import get_session_factory, init_db
from app.services.bylaw_settings_service import get_settings

CURRENT_YEAR = 2026

# استثناءات: اسم العضو (كما هو مسجَّل بالضبط في النظام) -> آخر سنة سُدِّد عنها الاشتراك فعليًا
EXCEPTIONS: dict[str, int] = {
    "شايع ناصر مرضي آل سويد": 2024,
    "مبارك علي مبارك الدوسري": 2026,
    "مبارك مطيع علي محمد الدوسري": 2024,
    "محمد مرضي بخيت آل عشوان": 2026,
}

# الحالات المؤهلة لتعبئة تاريخ سداد (يُستثنى الطلبات المعلّقة والمرفوضة لأنها لم تكن عضوية فعلية)
ELIGIBLE_STATUSES = {MemberStatus.ACTIVE, MemberStatus.SUSPENDED, MemberStatus.WITHDRAWN}


def main() -> None:
    init_db()
    session = get_session_factory()()

    annual_fee = get_settings(session).annual_membership_fee
    members = session.query(Member).filter(Member.status.in_(ELIGIBLE_STATUSES)).all()

    created = 0
    for member in members:
        paid_through_year = EXCEPTIONS.get(member.full_name, CURRENT_YEAR)
        start_year = member.join_date.year
        if start_year > paid_through_year:
            continue
        for year in range(start_year, paid_through_year + 1):
            existing = (
                session.query(MembershipFee)
                .filter(MembershipFee.member_id == member.id, MembershipFee.fee_year == year)
                .first()
            )
            if existing is not None:
                continue
            session.add(
                MembershipFee(
                    member_id=member.id,
                    fee_year=year,
                    amount=annual_fee,
                    status=FeeStatus.PAID,
                )
            )
            created += 1

    session.commit()
    print(f"تم إنشاء {created} سند سداد جديد.")

    found_names = {m.full_name for m in members}
    missing = set(EXCEPTIONS) - found_names
    if missing:
        print("\nتنبيه: لم يُعثر على الأعضاء التالية بالاسم بالضبط (تحقق من التطابق الحرفي في النظام):")
        for name in sorted(missing):
            print(f"  - {name}")


if __name__ == "__main__":
    main()
