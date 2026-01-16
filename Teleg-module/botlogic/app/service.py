from __future__ import annotations

from dataclasses import dataclass
from typing import List, Dict, Any, Optional

from .redis_repo import RedisRepo
from .auth_client import AuthClient
from .core_client import CoreClient


PUBLIC_COMMANDS = {"/help", "/menu", "/start", "/me", "/login", "/logout"}


def _cmd(text: str) -> str:
    t = (text or "").strip()
    if not t.startswith("/"):
        return ""
    return t.split()[0].lower()


def _is_code(text: str) -> bool:
    t = (text or "").strip()
    return t.isdigit() and 4 <= len(t) <= 8


@dataclass
class Session:
    status: str
    login_token: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    user_id: Optional[str] = None


class BotService:
    def __init__(self, redis_repo: RedisRepo, auth_client: AuthClient, core_client: CoreClient):
        self.redis = redis_repo
        self.auth = auth_client
        self.core = core_client

    async def handle(self, chat_id: int, text: str) -> List[str]:
        text = (text or "").strip()
        cmd = _cmd(text)

        session = await self._load_session(chat_id)

        if session and session.status == "await_code" and not cmd:
            if not _is_code(text):
                return ["Введи одноразовый код."]
            res = await self.auth.safe_verify_code(text)
            if not res or not res.get("success"):
                return ["❌ Код неверный или устарел. Попробуй ещё раз или /login code"]
            at = res.get("access_token")
            rt = res.get("refresh_token")
            uid = res.get("user_id")
            if not at or not rt or not uid:
                return ["⚠️ Ошибка сервиса авторизации. Попробуй ещё раз."]
            session.status = "auth"
            session.access_token = at
            session.refresh_token = rt
            session.user_id = uid
            session.login_token = None
            await self._save_session(chat_id, session)
            return ["✅ Вы авторизованы!", "Команды: /me, /logout, /help"]

        # Неизвестный пользователь
        if not session:
            if cmd == "/login" and len(text.split()) >= 2:
                login_type = text.split()[1].lower()
                if login_type == "code":
                    await self.redis.save_await_code(chat_id)
                    return [
                        "Вход по коду:",
                        "1) Получи одноразовый код на устройстве, где ты уже авторизован.",
                        "2) Отправь этот код сюда сообщением.",
                    ]
                if login_type not in ("github", "yandex"):
                    return ["Выбери: /login github | /login yandex | /login code"]
                login_token = await self.redis.new_login_token()
                await self.redis.save_anon(chat_id, login_token)
                url = await self.auth.safe_start_login(login_type, login_token)
                if not url:
                    return ["⚠️ Сервис авторизации сейчас недоступен. Попробуй позже."]
                return ["Перейди по ссылке для входа:", url, "После подтверждения я сообщу результат."]
            return [
                "Ты не авторизован.",
                "Варианты входа:",
                "/login github",
                "/login yandex",
                "/login code",
            ]

        # Команды доступные всегда
        if cmd in ("/start", "/menu", "/help"):
            return [
                "Доступные команды:",
                "/login github | /login yandex | /login code",
                "/me — статус",
                "/logout [all=true]",
            ]

        if cmd == "/logout":
            if "all=true" in text.lower() and session.refresh_token:
                await self.auth.safe_logout_all(session.refresh_token, all_devices=True)
            await self.redis.delete_session(chat_id)
            return ["Сеанс завершён."]

        if cmd == "/login":
            if session.status == "auth":
                return ["Вы уже авторизованы ✅"]
            parts = text.split()
            if len(parts) == 1:
                return ["Выбери: /login github | /login yandex | /login code"]
            login_type = parts[1].lower()
            if login_type == "code":
                session.status = "await_code"
                session.login_token = None
                await self._save_session(chat_id, session)
                return [
                    "Вход по коду:",
                    "Отправь сюда одноразовый код.",
                    "Если хочешь авторизоваться другим способом: /login github или /login yandex",
                ]
            if login_type not in ("github", "yandex"):
                return ["Выбери: /login github | /login yandex | /login code"]
            login_token = await self.redis.new_login_token()
            session.status = "anon"
            session.login_token = login_token
            session.access_token = None
            session.refresh_token = None
            session.user_id = None
            await self._save_session(chat_id, session)
            url = await self.auth.safe_start_login(login_type, login_token)
            if not url:
                return ["⚠️ Сервис авторизации сейчас недоступен. Попробуй позже."]
            return ["Перейди по ссылке для входа:", url, "После подтверждения я сообщу результат."]

        # /me
        if cmd == "/me":
            if session.status != "auth" or not session.access_token:
                if session.status == "anon":
                    return ["Статус: Вход начат (ожидаю подтверждение)."]
                if session.status == "await_code":
                    return ["Статус: Жду одноразовый код."]
                return ["Статус: Не авторизован."]
            if session.user_id:
                code, body = await self.core.view_own_name(session.user_id, session.access_token)
                if code < 400:
                    return ["Статус: Авторизован ✅", f"Имя: {body}"]
            return ["Статус: Авторизован ✅"]

        # Остальные команды требуют авторизации
        if session.status != "auth":
            return ["Сначала авторизуйся: /login github | /login yandex | /login code"]

        return ["Временно не работает.", "Доступно: /me, /logout, /help"]

    async def tick_check_login(self) -> List[Dict[str, Any]]:
        # Периодическая проверка входа для пользователей
        items: List[Dict[str, Any]] = []
        async for chat_id, s in self.redis.iter_sessions_by_status("anon"):
            if not s.login_token:
                continue
            check = await self.auth.safe_check_login(s.login_token)
            if not check:
                continue
            st = (check.get("status") or "").lower()

            if st in ("expired", "gone"):
                await self.redis.delete_session(chat_id)
                items.append({"chat_id": chat_id, "message": "⏳ Сессия входа устарела. Начни заново: /login github | /login yandex"})
                continue

            if st == "denied":
                await self.redis.delete_session(chat_id)
                items.append({"chat_id": chat_id, "message": "❌ В доступе отказано. Попробуй ещё раз: /login github | /login yandex"})
                continue

            if st == "granted":
                at = check.get("access_token")
                rt = check.get("refresh_token")
                uid = check.get("user_id")
                if at and rt:
                    new_s = Session(status="auth", access_token=at, refresh_token=rt, user_id=uid)
                    await self._save_session(chat_id, new_s)
                    items.append({"chat_id": chat_id, "message": "✅ Авторизация успешна!"})
        return items

    async def tick_notifications(self) -> List[Dict[str, Any]]:
        return []

    async def _load_session(self, chat_id: int) -> Optional[Session]:
        raw = await self.redis.get_session(chat_id)
        if not raw:
            return None
        return Session(
            status=raw.get("status", "unknown"),
            login_token=raw.get("login_token"),
            access_token=raw.get("access_token"),
            refresh_token=raw.get("refresh_token"),
            user_id=raw.get("user_id"),
        )

    async def _save_session(self, chat_id: int, s: Session) -> None:
        await self.redis.save_session(
            chat_id,
            {
                "status": s.status,
                "login_token": s.login_token,
                "access_token": s.access_token,
                "refresh_token": s.refresh_token,
                "user_id": s.user_id,
            },
        )
