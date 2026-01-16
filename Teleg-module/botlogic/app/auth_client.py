from __future__ import annotations
from typing import Any, Dict, Optional
import httpx


class AuthClient:
    def __init__(self, base_url: str, timeout_sec: float = 8.0):
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout_sec

    async def safe_start_login(self, login_type: str, login_token: str) -> Optional[str]:
        if not self.base_url:
            return None
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(
                    f"{self.base_url}/api/auth/init",
                    params={"type": login_type, "login_token": login_token},
                )
                r.raise_for_status()
                data = r.json()
                # сейчас у Артура есть только auth_url (github/yandex)
                return data.get("auth_url") or None
        except Exception:
            return None

    async def safe_check_login(self, login_token: str) -> Optional[Dict[str, Any]]:
        if not self.base_url:
            return None
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(f"{self.base_url}/api/auth/check/{login_token}")
                if r.status_code == 410:
                    return {"status": "expired"}
                r.raise_for_status()
                return r.json()
        except Exception:
            return None

    async def safe_logout_all(self, refresh_token: str, all_devices: bool = True) -> bool:
        if not self.base_url:
            return False
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(
                    f"{self.base_url}/api/auth/logout",
                    params={"all": "true" if all_devices else "false"},
                    json={"refresh_token": refresh_token},
                )
                return r.status_code < 400
        except Exception:
            return False
