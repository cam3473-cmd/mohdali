"""حفظ المستندات الرسمية للجمعية (خطاب تشكيل المجلس، شهادة الجمعية، خطابات اعتماد البرامج) بصيغة PDF."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from app.db.models import Document, User
from app.db.session import get_data_dir
from app.services.audit import log_action

DOCUMENT_CATEGORIES = [
    "خطاب تشكيل مجلس الإدارة",
    "شهادة الجمعية",
    "خطاب اعتماد برنامج",
    "أخرى",
]


def documents_dir() -> Path:
    d = get_data_dir() / "documents"
    d.mkdir(parents=True, exist_ok=True)
    return d


def document_path(document: Document) -> Path:
    return documents_dir() / document.file_name


def add_document(
    session: Session, actor: User, category: str, title: str, source_file_path: str, notes: str | None = None
) -> Document:
    source = Path(source_file_path)
    if not source.exists():
        raise FileNotFoundError(f"الملف غير موجود: {source_file_path}")

    stored_name = f"{uuid.uuid4().hex}_{source.name}"
    shutil.copy(source, documents_dir() / stored_name)

    document = Document(
        category=category, title=title, file_name=stored_name, uploaded_by_id=actor.id if actor else None, notes=notes
    )
    session.add(document)
    session.flush()
    log_action(session, actor, "add_document", "document", document.id, details=f"{category}: {title}")
    session.commit()
    return document


def list_documents(session: Session, category: str | None = None) -> list[Document]:
    query = session.query(Document)
    if category:
        query = query.filter(Document.category == category)
    return query.order_by(Document.uploaded_at.desc()).all()


def delete_document(session: Session, actor: User, document: Document) -> None:
    document_id = document.id
    details = f"{document.category}: {document.title}"
    path = document_path(document)
    session.delete(document)
    log_action(session, actor, "delete_document", "document", document_id, details=details)
    session.commit()
    if path.exists():
        path.unlink()
