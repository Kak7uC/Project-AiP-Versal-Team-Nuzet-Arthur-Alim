from fastapi import FastAPI
from pydantic import BaseModel

from .config import settings
from .redis_repo import RedisRepo
from .auth_client import AuthClient
from .core_client import CoreClient
from .service import BotService

app = FastAPI(title="Versal BotLogic")

repo = RedisRepo(settings.REDIS_HOST, settings.REDIS_PORT, settings.LOGIN_TTL_SEC)
auth = AuthClient(settings.AUTH_BASE_URL, settings.HTTP_TIMEOUT_SEC)
core = CoreClient(
    settings.CORE_BASE_URL,
    settings.HTTP_TIMEOUT_SEC,
    demo_mode=bool(settings.BOTLOGIC_DEMO_MODE),
)

svc = BotService(repo, auth, core)


class MsgIn(BaseModel):
    chat_id: int
    text: str


@app.post("/message")
async def message(inp: MsgIn):
    messages = await svc.handle(inp.chat_id, inp.text)
    return {"messages": messages}


@app.post("/tick/check_login")
async def tick_check_login():
    items = await svc.tick_check_login()
    return {"items": items}


@app.post("/tick/notifications")
async def tick_notifications():
    items = await svc.tick_notifications()
    return {"items": items}
