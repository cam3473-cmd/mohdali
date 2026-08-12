"""استعادة كلمة المرور عبر إرسال رمز تحقق مؤقت إلى البريد الإلكتروني المسجَّل للمستخدم."""
from __future__ import annotations

import random
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from app.auth.security import hash_password
from app.db.models import PasswordResetCode, User
from app.services import smtp_settings_service
from app.services.audit import log_action

CODE_LENGTH = 6
CODE_VALIDITY_MINUTES = 15


class PasswordResetError(Exception):
    pass


def _generate_code() -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(CODE_LENGTH))


def _send_email(smtp_settings, to_address: str, subject: str, body: str) -> None:
    message = MIMEText(body, "plain", "utf-8")
    message["Subject"] = subject
    message["From"] = smtp_settings.from_address
    message["To"] = to_address

    with smtplib.SMTP(smtp_settings.host, smtp_settings.port, timeout=20) as smtp:
        if smtp_settings.use_tls:
            smtp.starttls()
        smtp.login(smtp_settings.username, smtp_settings.password)
        smtp.sendmail(smtp_settings.from_address, [to_address], message.as_string())


def request_reset(session: Session, username: str) -> None:
    """يولّد رمز تحقق ويرسله إلى بريد المستخدم المسجَّل. يرفع PasswordResetError برسالة واضحة عند أي عائق."""
    user = session.query(User).filter(User.username == username.strip()).first()
    if user is None:
        raise PasswordResetError("لا يوجد مستخدم بهذا الاسم")
    if not user.email:
        raise PasswordResetError("لا يوجد بريد إلكتروني مسجَّل لهذا المستخدم. يرجى مراجعة مدير النظام لإضافته.")

    smtp_settings = smtp_settings_service.get_settings(session)
    if not smtp_settings_service.is_configured(smtp_settings):
        raise PasswordResetError("إعدادات البريد الإلكتروني (SMTP) غير مكتملة. راجع الإعدادات ← البريد الإلكتروني.")

    code = _generate_code()
    now = datetime.utcnow()
    session.add(
        PasswordResetCode(user_id=user.id, code=code, created_at=now, expires_at=now + timedelta(minutes=CODE_VALIDITY_MINUTES))
    )
    session.commit()

    body = (
        f"رمز التحقق لاستعادة كلمة المرور في نظام عضوية الجمعية العمومية: {code}\n"
        f"صالح لمدة {CODE_VALIDITY_MINUTES} دقيقة فقط."
    )
    try:
        _send_email(smtp_settings, user.email, "رمز استعادة كلمة المرور", body)
    except Exception as exc:  # noqa: BLE001
        raise PasswordResetError(f"تعذر إرسال البريد الإلكتروني: {exc}") from exc


def confirm_reset(session: Session, username: str, code: str, new_password: str) -> None:
    user = session.query(User).filter(User.username == username.strip()).first()
    if user is None:
        raise PasswordResetError("لا يوجد مستخدم بهذا الاسم")

    reset_code = (
        session.query(PasswordResetCode)
        .filter(PasswordResetCode.user_id == user.id, PasswordResetCode.code == code.strip(), PasswordResetCode.used.is_(False))
        .order_by(PasswordResetCode.created_at.desc())
        .first()
    )
    if reset_code is None:
        raise PasswordResetError("رمز التحقق غير صحيح")
    if reset_code.expires_at < datetime.utcnow():
        raise PasswordResetError("انتهت صلاحية رمز التحقق. اطلب رمزًا جديدًا")

    user.password_hash = hash_password(new_password)
    user.force_password_change = False
    reset_code.used = True
    log_action(session, user, "reset_password_via_email", "user", user.id)
    session.commit()
