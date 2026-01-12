from __future__ import annotations
from typing import Any, Dict
import httpx


class AuthClient:
    def __init__(self, base_url: str, timeout_sec: float = 8.0):
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout_sec

    async def request_login(self, login_type: str, login_token: str) -> str:
        if not self.base_url:
            return f"(demo) /login {login_type} state={login_token}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base_url}/login", params={"type": login_type, "state": login_token})
            r.raise_for_status()
            return r.text

    async def check_login_token(self, login_token: str) -> Dict[str, Any]:
        if not self.base_url:
            return {"status": "pending"}

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base_url}/check", params={"state": login_token})
            r.raise_for_status()
            return r.json()

    async def logout_all(self, refresh_token: str) -> None:
        if not self.base_url:
            return
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            await client.post(f"{self.base_url}/logout", json={"refresh_token": refresh_token})
