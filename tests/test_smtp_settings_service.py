from app.services import smtp_settings_service


def test_get_settings_creates_default_row(db_session):
    settings = smtp_settings_service.get_settings(db_session)
    assert settings.id == 1
    assert settings.port == 587
    assert smtp_settings_service.is_configured(settings) is False


def test_update_settings_persists_values_and_keeps_password_when_blank(db_session):
    smtp_settings_service.update_settings(
        db_session,
        host="smtp.example.com",
        port=465,
        username="assoc@example.com",
        password="secret",
        use_tls=False,
        from_address="assoc@example.com",
    )
    settings = smtp_settings_service.get_settings(db_session)
    assert settings.host == "smtp.example.com"
    assert settings.port == 465
    assert settings.password == "secret"
    assert settings.use_tls is False
    assert smtp_settings_service.is_configured(settings) is True

    # تحديث لاحق دون كلمة مرور يجب ألا يمسح القيمة المحفوظة
    smtp_settings_service.update_settings(
        db_session,
        host="smtp.example.com",
        port=465,
        username="assoc@example.com",
        password="",
        use_tls=False,
        from_address="assoc@example.com",
    )
    settings = smtp_settings_service.get_settings(db_session)
    assert settings.password == "secret"
