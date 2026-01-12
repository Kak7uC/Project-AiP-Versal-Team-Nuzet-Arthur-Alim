from __future__ import annotations
from pydantic import BaseModel
from typing import Optional


class UserSession(BaseModel):
    status: str  # "anonymous" | "authorized"
    login_token: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
