"""خدمة المصادقة وإدارة المستخدمين والأدوار."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.auth.security import hash_password, verify_password
from app.db.models import User, UserRole
from app.services.audit import log_action


class AuthError(Exception):
    pass


class InvalidCredentials(AuthError):
    pass


class AccountInactive(AuthError):
    pass


class AuthService:
    """يدير جلسة تسجيل الدخول الحالية للتطبيق (مستخدم واحد نشط في كل نافذة تطبيق)."""

    def __init__(self, session: Session):
        self.session = session
        self.current_user: User | None = None

    def login(self, username: str, password: str) -> User:
        user = self.session.query(User).filter(User.username == username).first()
        if user is None or not verify_password(password, user.password_hash):
            raise InvalidCredentials("اسم المستخدم أو كلمة المرور غير صحيحة")
        if not user.active:
            raise AccountInactive("هذا الحساب موقوف")
        self.current_user = user
        log_action(self.session, user, "login", "user", user.id)
        self.session.commit()
        return user

    def logout(self) -> None:
        if self.current_user:
            log_action(self.session, self.current_user, "logout", "user", self.current_user.id)
            self.session.commit()
        self.current_user = None

    def change_password(self, user: User, new_password: str) -> None:
        user.password_hash = hash_password(new_password)
        user.force_password_change = False
        log_action(self.session, self.current_user, "change_password", "user", user.id)
        self.session.commit()

    def create_user(self, actor: User, username: str, password: str, full_name: str, role: UserRole) -> User:
        if self.session.query(User).filter(User.username == username).first():
            raise AuthError("اسم المستخدم مستخدم بالفعل")
        user = User(
            username=username,
            password_hash=hash_password(password),
            full_name=full_name,
            role=role,
            active=True,
            force_password_change=True,
        )
        self.session.add(user)
        self.session.flush()
        log_action(self.session, actor, "create_user", "user", user.id, details=f"role={role.value}")
        self.session.commit()
        return user

    def set_active(self, actor: User, user: User, active: bool) -> None:
        user.active = active
        log_action(self.session, actor, "set_user_active", "user", user.id, details=str(active))
        self.session.commit()

    def list_users(self) -> list[User]:
        return self.session.query(User).order_by(User.username).all()


# صلاحيات كل دور على وحدات النظام
ROLE_PERMISSIONS: dict[UserRole, set[str]] = {
    UserRole.ADMIN: {"members.manage", "assembly.manage", "settings.manage", "users.manage", "board.manage", "view"},
    UserRole.MEMBERSHIP_OFFICER: {"members.manage", "board.manage", "view"},
    UserRole.ASSEMBLY_MANAGER: {"assembly.manage", "view"},
    UserRole.VIEWER: {"view"},
}


def has_permission(user: User, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(user.role, set())

