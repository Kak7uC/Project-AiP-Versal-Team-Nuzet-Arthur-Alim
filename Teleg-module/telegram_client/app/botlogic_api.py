from __future__ import annotations
import httpx


class BotLogicAPI:
    def __init__(self, base_url: str, timeout_sec: float = 8.0):
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout_sec

    async def send_text(self, chat_id: int, text: str) -> list[str]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/message", json={"chat_id": chat_id, "text": text})
            r.raise_for_status()
            data = r.json()
            return data.get("messages", ["(пустой ответ)"])

    async def tick_check_login(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/tick/check_login")
            r.raise_for_status()
            return r.json().get("items", [])

    async def tick_notifications(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(f"{self.base_url}/tick/notifications")
            r.raise_for_status()
            return r.json().get("items", [])
