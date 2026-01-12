from __future__ import annotations

import json
from typing import Optional, Tuple

import redis.asyncio as redis

from .models import UserSession


class RedisRepo:
    def __init__(self, host: str, port: int, ttl_sec: int):
        self.r = redis.Redis(host=host, port=port, decode_responses=True)
        self.ttl = ttl_sec

    def _key(self, chat_id: int) -> str:
        return f"tg:{chat_id}"

    async def get(self, chat_id: int) -> Optional[UserSession]:
        raw = await self.r.get(self._key(chat_id))
        if not raw:
            return None
        return UserSession(**json.loads(raw))

    async def set(self, chat_id: int, session: UserSession) -> None:
        await self.r.set(self._key(chat_id), session.model_dump_json(), ex=self.ttl)

    async def delete(self, chat_id: int) -> None:
        await self.r.delete(self._key(chat_id))

    async def get_all_keys(self) -> list[str]:
        return await self.r.keys("tg:*")

    async def get_by_key(self, key: str) -> Optional[Tuple[int, UserSession]]:
        raw = await self.r.get(key)
        if not raw:
            return None
        try:
            chat_id = int(key.split("tg:")[1])
        except Exception:
            return None
        return chat_id, UserSession(**json.loads(raw))
