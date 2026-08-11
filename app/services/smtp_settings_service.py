"""إعدادات خادم البريد الصادر (SMTP) المستخدم لإرسال رموز استعادة كلمة المرور."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import SmtpSettings


def get_settings(session: Session) -> SmtpSettings:
    settings = session.get(SmtpSettings, 1)
    if settings is None:
        settings = SmtpSettings(id=1, port=587, use_tls=True)
        session.add(settings)
        session.commit()
    return settings


def update_settings(
    session: Session,
    host: str | None,
    port: int,
    username: str | None,
    password: str | None,
    use_tls: bool,
    from_address: str | None,
) -> None:
    settings = get_settings(session)
    settings.host = host or None
    settings.port = port
    settings.username = username or None
    if password:  # لا نمسح كلمة المرور المحفوظة إن تُرك الحقل فارغًا عند التعديل
        settings.password = password
    settings.use_tls = use_tls
    settings.from_address = from_address or None
    session.commit()


def is_configured(settings: SmtpSettings) -> bool:
    return bool(settings.host and settings.username and settings.password and settings.from_address)
