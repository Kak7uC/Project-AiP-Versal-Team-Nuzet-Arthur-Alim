from __future__ import annotations

from dataclasses import dataclass
from typing import List

from .redis_repo import RedisRepo
from .auth_client import AuthClient
from .core_client import CoreClient


PUBLIC_COMMANDS = {"/help", "/menu", "/start", "/me", "/login", "/logout"}


def _cmd(text: str) -> str:
    t = (text or "").strip()
    if not t.startswith("/"):
        return ""
    return t.split()[0].lower()


@dataclass
class Session:
    status: str  # unknown/anon/auth
    login_token: str | None = None
    access_token: str | None = None
    refresh_token: str | None = None


class BotService:
    def __init__(self, redis: RedisRepo, auth: AuthClient, core: CoreClient):
        self.redis = redis
        self.auth = auth
        self.core = core

    async def handle(self, chat_id: int, text: str) -> List[str]:
        print("INCOMING:", chat_id, repr(text))
        text = (text or "").strip()
        cmd = _cmd(text)

        session = await self._load_session(chat_id)

        if cmd in PUBLIC_COMMANDS:
            return await self._handle_public(chat_id, text, session)

        if session is None:
            return [
                "Ты не авторизован.",
                "Доступные варианты входа: /login github | /login yandex | /login code",
            ]

        if session.status == "anon":
            check = await self.auth.safe_check_login(session.login_token or "")
            if check is None:
                return ["⚠️ Сервис авторизации сейчас недоступен.", "Попробуй позже."]

            st = (check.get("status") or "").lower()

            if st in ("expired", "gone"):
                await self.redis.delete_session(chat_id)
                return [
                    "Сессия входа устарела. Попробуй ещё раз:",
                    "/login github | /login yandex",
                ]

            if st == "denied":
                await self.redis.delete_session(chat_id)
                return ["Неудачная авторизация. Попробуй ещё раз: /login github | /login yandex"]

            if st == "pending":
                return ["Ожидаю подтверждение входа…"]

            if st == "granted":
                at = check.get("access_token")
                rt = check.get("refresh_token")
                if not at or not rt:
                    return ["⚠️ Ошибка: AUTH вернул неполные токены."]
                session.status = "auth"
                session.access_token = at
                session.refresh_token = rt
                session.login_token = None
                await self._save_session(chat_id, session)


        if session.status != "auth":
            return ["⚠️ Неожиданный статус сессии."]

        return await self._handle_authed(chat_id, text, session)

    # ================= internal =================

    async def _handle_public(self, chat_id: int, text: str, session: Session | None) -> List[str]:
        cmd = _cmd(text)

        if cmd in ("/help", "/menu", "/start"):
            return [
                "👋 Привет! Я — Versal Test Bot.",
                "",
                "Команды:",
                "/login github | /login yandex | /login code — вход",
                "/logout [all=true] — выход",
                "/me — статус",
                "",
                "Открой /menu и пользуйся кнопками 🙂",
            ]

        if cmd == "/me":
            if session is None:
                return ["Статус: Не авторизован."]
            if session.status == "anon":
                return ["Статус: Вход начат (ожидаю подтверждение)."]
            if session.status == "auth":
                return ["Статус: Авторизован ✅"]
            return ["Статус: Неизвестно."]

        if cmd == "/logout":
            await self.redis.delete_session(chat_id)
            if "all=true" in text.lower() and session and session.refresh_token:
                await self.auth.safe_logout_all(session.refresh_token)
            return ["Сеанс завершён."]

        if cmd == "/login":
            parts = text.split()
            if len(parts) == 1:
                return ["Выбери: /login github | /login yandex | /login code"]

            login_type = parts[1].lower()

            login_token = await self.redis.new_login_token()
            await self.redis.save_anon(chat_id, login_token)

            link_or_code = await self.auth.safe_start_login(login_type, login_token)
            if link_or_code is None:
                return [
                    "⚠️ Сервис авторизации сейчас недоступен.",
                    f"Но login_token уже создан: {login_token}",
                ]

            return [
                "Ок, начинаем вход.",
                f"{link_or_code}",
                "После подтверждения я сообщу результат автоматически.",
            ]

        return ["Неизвестная команда. /help"]

    async def _handle_authed(self, chat_id: int, text: str, session: Session) -> List[str]:

        # Если команда неизвестна:
        if not text.startswith("/"):
            return ["Нет такой команды. Используй /help"]

        try:
            return await self.core.send(text, access_token=session.access_token or "")
        except Exception:
            return ["⚠️ Центральный модуль сейчас недоступен или произошла ошибка."]

    async def _load_session(self, chat_id: int) -> Session | None:
        raw = await self.redis.get_session(chat_id)
        if not raw:
            return None
        return Session(
            status=raw.get("status", "unknown"),
            login_token=raw.get("login_token"),
            access_token=raw.get("access_token"),
            refresh_token=raw.get("refresh_token"),
        )

    async def _save_session(self, chat_id: int, s: Session) -> None:
        await self.redis.save_session(chat_id, {
            "status": s.status,
            "login_token": s.login_token,
            "access_token": s.access_token,
            "refresh_token": s.refresh_token,
        })
    async def tick_check_login(self):
        return {}
    async def tick_notifications(self):
        return {}
