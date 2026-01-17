from __future__ import annotations

from typing import Any, Optional, Tuple, Dict
import httpx


class CoreClient:

    def __init__(self, base_url: str, timeout_sec: float = 8.0, demo_mode: bool = False):
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout_sec
        self.demo_mode = demo_mode

    async def task(self, user_id: str, jwt_token: str, action: str, extra: Optional[Dict[str, Any]] = None) -> Tuple[int, str]:
        if self.demo_mode or not self.base_url:
            return 200, "demo"
        params: Dict[str, Any] = {"ID": user_id, "JWT": jwt_token, "Action": action}
        if extra:
            params.update(extra)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(f"{self.base_url}/task", params=params)
            return r.status_code, r.text

    async def view_own_name(self, user_id: str, jwt_token: str) -> Tuple[int, str]:
        return await self.task(user_id, jwt_token, "VIEW_OWN_NAME")

    async def get_notifications(self, jwt_token: str) -> Tuple[int, str]:
        if self.demo_mode or not self.base_url:
            return 200, "{}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.get(
                f"{self.base_url}/notification",
                headers={"Authorization": f"Bearer {jwt_token}"},
            )
            return r.status_code, r.text

    async def clear_notifications(self, jwt_token: str) -> Tuple[int, str]:
        if self.demo_mode or not self.base_url:
            return 200, "{}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.post(
                f"{self.base_url}/notification/clear",
                headers={"Authorization": f"Bearer {jwt_token}"},
            )
            return r.status_code, r.text
