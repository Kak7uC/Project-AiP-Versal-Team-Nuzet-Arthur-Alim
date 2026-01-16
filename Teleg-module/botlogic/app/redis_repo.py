from __future__ import annotations

import json
import secrets
from typing import Optional, Iterable

import redis.asyncio as redis

from .models import UserSession


class RedisRepo:
    def __init__(self, host: str, port: int, ttl_sec: int):
        self.r = redis.Redis(host=host, port=port, decode_responses=True)
        self.ttl = ttl_sec

    async def set(self, chat_id: int, session: UserSession) -> None:
        await self.r.set(str(chat_id), session.model_dump_json(), ex=self.ttl)

    async def get(self, chat_id: int) -> Optional[UserSession]:
        raw = await self.r.get(str(chat_id))
        if not raw:
            return None
        try:
            return UserSession.model_validate_json(raw)
        except Exception:
            return None

    async def delete(self, chat_id: int) -> None:
        await self.r.delete(str(chat_id))

    async def get_session(self, chat_id: int) -> Optional[dict]:
        s = await self.get(chat_id)
        return s.model_dump() if s else None

    async def save_session(self, chat_id: int, data: dict) -> None:
        await self.set(chat_id, UserSession(**data))

    async def delete_session(self, chat_id: int) -> None:
        await self.delete(chat_id)

    async def new_login_token(self) -> str:
        return secrets.token_urlsafe(24)

    async def save_anon(self, chat_id: int, login_token: str) -> None:
        await self.save_session(chat_id, {"status": "anon", "login_token": login_token})

    async def save_await_code(self, chat_id: int) -> None:
        # Одноразовый код пользователь пришлёт отдельным сообщением
        await self.save_session(chat_id, {"status": "await_code"})

    async def iter_sessions_by_status(self, status: str) -> Iterable[tuple[int, UserSession]]:
        """Ищем по всем ключам (chat_id) в Redis и возвращаем только нужный статус.
        """
        async for key in self.r.scan_iter(match="*"):
            # ключи у нас — chat_id
            try:
                chat_id = int(key)
            except Exception:
                continue
            s = await self.get(chat_id)
            if not s:
                continue
            if s.status == status:
                yield chat_id, s
