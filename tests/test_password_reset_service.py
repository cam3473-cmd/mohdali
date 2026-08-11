from datetime import datetime, timedelta

import pytest

from app.db.models import PasswordResetCode
from app.services import password_reset_service, smtp_settings_service


def _configure_smtp(db_session):
    smtp_settings_service.update_settings(
        db_session,
        host="smtp.example.com",
        port=587,
        username="assoc@example.com",
        password="app-password",
        use_tls=True,
        from_address="assoc@example.com",
    )


def test_request_reset_fails_without_registered_email(db_session, admin_user):
    _configure_smtp(db_session)
    with pytest.raises(password_reset_service.PasswordResetError, match="بريد إلكتروني"):
        password_reset_service.request_reset(db_session, admin_user.username)


def test_request_reset_fails_when_smtp_not_configured(db_session, admin_user):
    admin_user.email = "admin@example.com"
    db_session.commit()
    with pytest.raises(password_reset_service.PasswordResetError, match="SMTP"):
        password_reset_service.request_reset(db_session, admin_user.username)


def test_request_reset_fails_for_unknown_user(db_session):
    _configure_smtp(db_session)
    with pytest.raises(password_reset_service.PasswordResetError):
        password_reset_service.request_reset(db_session, "لا_يوجد_مستخدم")


def test_request_reset_sends_code_and_confirm_reset_changes_password(db_session, admin_user, monkeypatch):
    admin_user.email = "admin@example.com"
    db_session.commit()
    _configure_smtp(db_session)

    sent = {}

    def fake_send_email(smtp_settings, to_address, subject, body):
        sent["to"] = to_address
        sent["body"] = body

    monkeypatch.setattr(password_reset_service, "_send_email", fake_send_email)

    password_reset_service.request_reset(db_session, admin_user.username)
    assert sent["to"] == "admin@example.com"

    code = db_session.query(PasswordResetCode).filter(PasswordResetCode.user_id == admin_user.id).one()
    assert code.code in sent["body"]

    from app.auth.security import verify_password

    password_reset_service.confirm_reset(db_session, admin_user.username, code.code, "NewPass123")
    db_session.refresh(admin_user)
    assert verify_password("NewPass123", admin_user.password_hash)
    assert admin_user.force_password_change is False


def test_confirm_reset_rejects_wrong_code(db_session, admin_user):
    admin_user.email = "admin@example.com"
    db_session.add(
        PasswordResetCode(
            user_id=admin_user.id, code="111111", created_at=datetime.utcnow(), expires_at=datetime.utcnow() + timedelta(minutes=15)
        )
    )
    db_session.commit()
    with pytest.raises(password_reset_service.PasswordResetError, match="غير صحيح"):
        password_reset_service.confirm_reset(db_session, admin_user.username, "000000", "NewPass123")


def test_confirm_reset_rejects_expired_code(db_session, admin_user):
    admin_user.email = "admin@example.com"
    db_session.add(
        PasswordResetCode(
            user_id=admin_user.id, code="222222", created_at=datetime.utcnow() - timedelta(minutes=30), expires_at=datetime.utcnow() - timedelta(minutes=15)
        )
    )
    db_session.commit()
    with pytest.raises(password_reset_service.PasswordResetError, match="انتهت"):
        password_reset_service.confirm_reset(db_session, admin_user.username, "222222", "NewPass123")
