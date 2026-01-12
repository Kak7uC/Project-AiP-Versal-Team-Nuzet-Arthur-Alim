import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage

from .handlers import router
from .botlogic_api import BotLogicAPI


logging.basicConfig(level=logging.INFO)


async def tick_loop(bot: Bot, api: BotLogicAPI):
    """
    По сценарию Telegram Client периодически:
    - проверяет завершение логина (tick_check_login)
    - проверяет уведомления (tick_notifications)
    """
    while True:
        try:
            # 1) check_login
            items = await api.tick_check_login()
            for it in items:
                chat_id = it.get("chat_id")
                msg = it.get("message")
                if chat_id and msg:
                    await bot.send_message(chat_id, msg)

            # 2) notifications
            items = await api.tick_notifications()
            for it in items:
                chat_id = it.get("chat_id")
                messages = it.get("messages") or []
                if chat_id and messages:
                    for m in messages:
                        await bot.send_message(chat_id, str(m))

        except Exception as e:
            logging.warning(f"tick error: {e}")

        await asyncio.sleep(5)


async def main():
    from .config import settings

    bot = Bot(token=settings.BOT_TOKEN)
    dp = Dispatcher(storage=MemoryStorage())

    api = BotLogicAPI(settings.BOTLOGIC_BASE_URL, settings.HTTP_TIMEOUT_SEC)

    dp["api"] = api

    dp.include_router(router)

    asyncio.create_task(tick_loop(bot, api))

    await dp.start_polling(bot, api=api)


if __name__ == "__main__":
    asyncio.run(main())
