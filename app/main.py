"""نقطة تشغيل التطبيق."""
from __future__ import annotations

import sys

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QDialog

from app.auth.service import AuthService
from app.db.session import get_session, init_db
from app.ui.app_context import AppContext
from app.ui.login_view import LoginDialog
from app.ui.main_window import MainWindow


def main() -> int:
    init_db()

    app = QApplication(sys.argv)
    app.setLayoutDirection(Qt.LayoutDirection.RightToLeft)

    session = get_session()
    auth = AuthService(session)

    login_dialog = LoginDialog(auth)
    if login_dialog.exec() != QDialog.DialogCode.Accepted or login_dialog.authenticated_user is None:
        return 0

    ctx = AppContext(session=session, auth=auth)
    window = MainWindow(ctx)
    window.showMaximized()

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
