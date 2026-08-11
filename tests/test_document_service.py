from pathlib import Path

from app.services import document_service


def test_add_list_delete_document(db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))

    source = tmp_path / "خطاب.pdf"
    source.write_bytes(b"%PDF-1.4 fake content")

    document = document_service.add_document(
        db_session, admin_user, category="شهادة الجمعية", title="شهادة تسجيل الجمعية", source_file_path=str(source)
    )

    stored_path = document_service.document_path(document)
    assert stored_path.exists()
    assert stored_path.read_bytes() == b"%PDF-1.4 fake content"

    documents = document_service.list_documents(db_session)
    assert len(documents) == 1
    assert documents[0].title == "شهادة تسجيل الجمعية"

    filtered = document_service.list_documents(db_session, category="خطاب اعتماد برنامج")
    assert filtered == []

    document_service.delete_document(db_session, admin_user, document)
    assert document_service.list_documents(db_session) == []
    assert not stored_path.exists()


def test_add_document_missing_source_raises(db_session, admin_user, tmp_path, monkeypatch):
    monkeypatch.setenv("MOHDALI_DATA_DIR", str(tmp_path))
    try:
        document_service.add_document(
            db_session, admin_user, category="أخرى", title="ملف مفقود", source_file_path=str(tmp_path / "missing.pdf")
        )
        assert False, "expected FileNotFoundError"
    except FileNotFoundError:
        pass
