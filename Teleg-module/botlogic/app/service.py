from __future__ import annotations

from dataclasses import dataclass
from typing import List, Dict, Any, Optional

import json

from .redis_repo import RedisRepo
from .auth_client import AuthClient
from .core_client import CoreClient


PUBLIC_COMMANDS = {"/help", "/menu", "/start", "/me", "/login", "/logout"}


def _cmd(text: str) -> str:
    t = (text or "").strip()
    if not t.startswith("/"):
        return ""
    return t.split()[0].lower()


def _is_code(text: str) -> bool:
    t = (text or "").strip()
    return t.isdigit() and 4 <= len(t) <= 8


@dataclass
class Session:
    status: str
    login_token: Optional[str] = None
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    user_id: Optional[str] = None


class BotService:
    def __init__(self, redis_repo: RedisRepo, auth_client: AuthClient, core_client: CoreClient):
        self.redis = redis_repo
        self.auth = auth_client
        self.core = core_client

    async def handle(self, chat_id: int, text: str) -> List[str]:
        text = (text or "").strip()
        cmd = _cmd(text)

        session = await self._load_session(chat_id)

        # ввод одноразового кода
        if session and session.status == "await_code" and not cmd:
            if not _is_code(text):
                return ["Введи одноразовый код."]
            res = await self.auth.safe_verify_code(text)
            if not res or not res.get("success"):
                return ["❌ Код неверный или устарел. Попробуй ещё раз или /login code"]
            at = res.get("access_token")
            rt = res.get("refresh_token")
            uid = res.get("user_id")
            if not at or not rt or not uid:
                return ["⚠️ Ошибка сервиса авторизации. Попробуй ещё раз."]
            session.status = "auth"
            session.access_token = at
            session.refresh_token = rt
            session.user_id = uid
            session.login_token = None
            await self._save_session(chat_id, session)
            return ["✅ Вы авторизованы!", "Команды: /me, /logout, /help"]

        # Неизвестный пользователь
        if not session:
            if cmd == "/login" and len(text.split()) >= 2:
                login_type = text.split()[1].lower()
                if login_type == "code":
                    await self.redis.save_await_code(chat_id)
                    return [
                        "Вход по коду:",
                        "1) Получи одноразовый код на устройстве, где ты уже авторизован.",
                        "2) Отправь этот код сюда сообщением.",
                    ]
                if login_type not in ("github", "yandex"):
                    return ["Выбери: /login github | /login yandex | /login code"]
                login_token = await self.redis.new_login_token()
                await self.redis.save_anon(chat_id, login_token)
                url = await self.auth.safe_start_login(login_type, login_token)
                if not url:
                    return ["⚠️ Сервис авторизации сейчас недоступен. Попробуй позже."]
                return ["Перейди по ссылке для входа:", url, "После подтверждения я сообщу результат."]
            return [
                "Ты не авторизован.",
                "Варианты входа:",
                "/login github",
                "/login yandex",
                "/login code",
            ]

        # Команды доступные всегда
        if cmd in ("/start", "/menu", "/help"):
            return [
                "Доступные команды:",
                "/login github | /login yandex | /login code",
                "/me — статус",
                "/logout [all=true]",
            ]

        if cmd == "/logout":
            if "all=true" in text.lower() and session.refresh_token:
                await self.auth.safe_logout_all(session.refresh_token, all_devices=True)
            await self.redis.delete_session(chat_id)
            return ["Сеанс завершён."]

        if cmd == "/login":
            if session.status == "auth":
                return ["Вы уже авторизованы ✅"]
            parts = text.split()
            if len(parts) == 1:
                return ["Выбери: /login github | /login yandex | /login code"]
            login_type = parts[1].lower()
            if login_type == "code":
                session.status = "await_code"
                session.login_token = None
                await self._save_session(chat_id, session)
                return [
                    "Вход по коду:",
                    "Отправь сюда одноразовый код.",
                    "Если хочешь авторизоваться другим способом: /login github или /login yandex",
                ]
            if login_type not in ("github", "yandex"):
                return ["Выбери: /login github | /login yandex | /login code"]
            login_token = await self.redis.new_login_token()
            session.status = "anon"
            session.login_token = login_token
            session.access_token = None
            session.refresh_token = None
            session.user_id = None
            await self._save_session(chat_id, session)
            url = await self.auth.safe_start_login(login_type, login_token)
            if not url:
                return ["⚠️ Сервис авторизации сейчас недоступен. Попробуй позже."]
            return ["Перейди по ссылке для входа:", url, "После подтверждения я сообщу результат."]

        # /me
        if cmd == "/me":
            if session.status != "auth" or not session.access_token:
                if session.status == "anon":
                    return ["Статус: Вход начат (ожидаю подтверждение)."]
                if session.status == "await_code":
                    return ["Статус: Жду одноразовый код."]
                return ["Статус: Не авторизован."]
            if session.user_id:
                code, body = await self.core.view_own_name(session.user_id, session.access_token)
                if code < 400:
                    return ["Статус: Авторизован ✅", f"Имя: {body}"]
            return ["Статус: Авторизован ✅"]

        # Остальные команды требуют авторизации
        if session.status != "auth":
            return ["Сначала авторизуйся: /login github | /login yandex | /login code"]

        parts = text.split()

        # нет в логике
        stubbed = {
            "/question_update",
            "/test",
            "/test_q_order",
            "/answer",
            "/answer_del",
        }
        if cmd in stubbed:
            return ["Временно недоступно ⚠️"]

        # /notifications — тоже заглушка
        if cmd == "/notifications":
            code, body = await self.core.get_notifications(session.access_token or "")
            if code in (404, 405):
                return ["Временно недоступно ⚠️"]
            if code == 401:
                ok = await self._refresh_tokens(chat_id, session)
                if not ok:
                    return ["Сессия истекла. Авторизуйся заново: /login github | /login yandex | /login code"]
                code, body = await self.core.get_notifications(session.access_token or "")
            notes = self._extract_notifications(body)
            if not notes:
                return ["Уведомлений нет."]
            await self.core.clear_notifications(session.access_token or "")
            return ["🔔 Уведомления:"] + [f"• {n}" for n in notes]

        if not session.user_id or not session.access_token:
            return ["⚠️ Ошибка сессии. Сделай /logout и войди заново."]

        # Пользователи
        if cmd == "/users":
            return await self._core_action(chat_id, session, "VIEW_ALL_USERS")

        if cmd == "/user":
            if len(parts) < 2:
                return ["Формат: /user <user_id>"]
            return await self._core_action(chat_id, session, "VIEW_OTHER_NAME", {"Target_ID": parts[1]})

        if cmd == "/user_set_name":
            if len(parts) < 4:
                return ["Формат: /user_set_name <user_id> <имя> <фамилия>"]
            return await self._core_action(
                chat_id,
                session,
                "EDIT_OTHER_NAME",
                {"Target_ID": parts[1], "New_name": parts[2], "New_lastname": " ".join(parts[3:])},
            )

        if cmd == "/user_data":
            if len(parts) == 1 or parts[1] == session.user_id:
                return await self._core_action(chat_id, session, "VIEW_OWN_DATA")
            return await self._core_action(chat_id, session, "VIEW_OTHER_DATA", {"Target_ID": parts[1]})

        if cmd == "/user_roles":
            if len(parts) < 2:
                return ["Формат: /user_roles <user_id>"]
            return await self._core_action(chat_id, session, "VIEW_OTHER_ROLES", {"Target_ID": parts[1]})

        if cmd == "/user_set_roles":
            if len(parts) < 3:
                return ["Формат: /user_set_roles <user_id> <roles>"]
            return await self._core_action(
                chat_id,
                session,
                "EDIT_OTHER_ROLES",
                {"Target_ID": parts[1], "Target_ROLE": " ".join(parts[2:])},
            )

        if cmd == "/user_block":
            if len(parts) < 2:
                return ["Формат: /user_block <user_id>"]
            return await self._core_action(chat_id, session, "VIEW_BLOCKED", {"Target_ID": parts[1]})

        if cmd == "/user_block_set":
            if len(parts) < 2:
                return ["Формат: /user_block_set <user_id>"]
            return await self._core_action(chat_id, session, "EDIT_BLOCKED", {"Target_ID": parts[1]})

        # Курсы
        if cmd == "/courses":
            return await self._core_action(chat_id, session, "VIEW_ALL_COURSES")

        if cmd == "/course":
            if len(parts) < 2:
                return ["Формат: /course <course_id>"]
            return await self._core_action(chat_id, session, "VIEW_COURSE_INFO", {"Course_ID": parts[1]})

        if cmd == "/course_set":
            if len(parts) < 4:
                return ["Формат: /course_set <course_id> <название> <описание>"]
            return await self._core_action(
                chat_id,
                session,
                "EDIT_COURSE_INFO",
                {"Course_ID": parts[1], "Course_NAME": parts[2], "Description": " ".join(parts[3:])},
            )

        if cmd == "/course_tests":
            if len(parts) < 2:
                return ["Формат: /course_tests <course_id>"]
            return await self._core_action(chat_id, session, "VIEW_COURSE_TESTS", {"Course_ID": parts[1]})

        if cmd == "/course_test":
            if len(parts) < 3:
                return ["Формат: /course_test <course_id> <test_id>"]
            return await self._core_action(chat_id, session, "CHECK_TEST_ACTIVE", {"Course_ID": parts[1], "Test_ID": parts[2]})

        if cmd == "/course_users":
            if len(parts) < 2:
                return ["Формат: /course_users <course_id>"]
            return await self._core_action(chat_id, session, "VIEW_COURSE_STUDENTS", {"Course_ID": parts[1]})

        if cmd == "/course_user_add":
            if len(parts) < 3:
                return ["Формат: /course_user_add <course_id> <user_id>"]
            return await self._core_action(chat_id, session, "ENROLL_STUDENT", {"Course_ID": parts[1], "Target_ID": parts[2]})

        if cmd == "/course_user_del":
            if len(parts) < 3:
                return ["Формат: /course_user_del <course_id> <user_id>"]
            return await self._core_action(chat_id, session, "UNENROLL_STUDENT", {"Course_ID": parts[1], "Target_ID": parts[2]})

        if cmd == "/course_add":
            raw = text[len("/course_add"):].strip()
            seg = [s.strip() for s in raw.split("|")]
            if len(seg) != 3:
                return ["Формат: /course_add <название> | <описание> | <teacher_id>"]
            return await self._core_action(
                chat_id,
                session,
                "CREATE_COURSE",
                {"Course_NAME": seg[0], "Description": seg[1], "Target_ID": seg[2]},
            )

        if cmd == "/course_del":
            if len(parts) < 2:
                return ["Формат: /course_del <course_id>"]
            return await self._core_action(chat_id, session, "DELETE_COURSE", {"Course_ID": parts[1]})

        # Вопросы
        if cmd == "/questions":
            return await self._core_action(chat_id, session, "VIEW_QUESTIONS")

        if cmd == "/question":
            if len(parts) < 2:
                return ["Формат: /question <question_id> [version]"]
            extra = {"Question_ID": parts[1]}
            if len(parts) >= 3:
                extra["Version"] = parts[2]
            return await self._core_action(chat_id, session, "VIEW_QUESTION_DETAIL", extra)

        if cmd == "/question_add":
            raw = text[len("/question_add"):].strip()
            seg = [s.strip() for s in raw.split("|")]
            if len(seg) < 4:
                return ["Формат: /question_add <title> | <text> | <opt1;opt2;...> | <correct_index>"]
            title, qtext, opts, correct = seg[0], seg[1], seg[2], seg[3]
            options = [o.strip() for o in opts.split(";") if o.strip()]
            try:
                correct_i = int(correct)
            except ValueError:
                return ["correct_index должен быть числом (0..N-1)"]
            return await self._core_action(
                chat_id,
                session,
                "CREATE_QUESTION",
                {
                    "Title": title,
                    "Text": qtext,
                    "Options": json.dumps(options, ensure_ascii=False),
                    "Answer_Index": str(correct_i),
                },
            )

        if cmd == "/question_del":
            if len(parts) < 2:
                return ["Формат: /question_del <question_id>"]
            return await self._core_action(chat_id, session, "DELETE_QUESTION", {"Question_ID": parts[1]})

        # Тесты
        if cmd == "/test_add":
            if len(parts) < 3:
                return ["Формат: /test_add <course_id> <название>"]
            return await self._core_action(chat_id, session, "CREATE_TEST", {"Course_ID": parts[1], "Title": " ".join(parts[2:])})

        if cmd == "/test_del":
            if len(parts) < 3:
                return ["Формат: /test_del <course_id> <test_id>"]
            return await self._core_action(chat_id, session, "DELETE_TEST", {"Course_ID": parts[1], "Test_ID": parts[2]})

        if cmd == "/test_active":
            if len(parts) < 4:
                return ["Формат: /test_active <course_id> <test_id> on/off"]
            val = parts[3].lower()
            activate = "true" if val in ("on", "true", "1", "yes") else "false"
            return await self._core_action(chat_id, session, "TOGGLE_TEST_ACTIVE", {"Course_ID": parts[1], "Test_ID": parts[2], "Activate": activate})

        if cmd == "/test_q_add":
            if len(parts) < 3:
                return ["Формат: /test_q_add <test_id> <question_id>"]
            return await self._core_action(chat_id, session, "ADD_QUESTION_TO_TEST", {"Test_ID": parts[1], "Question_ID": parts[2]})

        if cmd == "/test_q_del":
            if len(parts) < 3:
                return ["Формат: /test_q_del <test_id> <question_id>"]
            return await self._core_action(chat_id, session, "REMOVE_QUESTION_FROM_TEST", {"Test_ID": parts[1], "Question_ID": parts[2]})

        if cmd in ("/test_users", "/test_grades", "/test_answers"):
            if len(parts) < 2:
                return ["Формат: /test_grades <test_id>"]
            return await self._core_action(chat_id, session, "VIEW_TEST_ATTEMPTS", {"Test_ID": parts[1]})

        # Попытки
        if cmd == "/attempt_start":
            if len(parts) < 2:
                return ["Формат: /attempt_start <test_id>"]
            return await self._core_action(chat_id, session, "CREATE_ATTEMPT", {"Test_ID": parts[1]})

        if cmd == "/attempt":
            if len(parts) < 2:
                return ["Формат: /attempt <test_id>"]
            return await self._core_action(chat_id, session, "VIEW_ATTEMPT", {"Test_ID": parts[1]})

        if cmd == "/attempt_finish":
            if len(parts) < 2:
                return ["Формат: /attempt_finish <attempt_id>"]
            return await self._core_action(chat_id, session, "COMPLETE_ATTEMPT", {"Attempt_ID": parts[1]})

        # Ответы
        if cmd == "/answer_set":
            if len(parts) < 4:
                return ["Формат: /answer_set <attempt_id> <question_id> <variant_index>"]
            return await self._core_action(
                chat_id,
                session,
                "UPDATE_ANSWER",
                {"Attempt_ID": parts[1], "Question_ID": parts[2], "Answer_Index": parts[3]},
            )

        return ["Команда не найдена."]

    async def tick_check_login(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for chat_id, s in self.redis.iter_sessions_by_status("anon"):
            if not s.login_token:
                continue
            check = await self.auth.safe_check_login(s.login_token)
            if not check:
                continue
            st = (check.get("status") or "").lower()

            if st in ("expired", "gone"):
                await self.redis.delete_session(chat_id)
                items.append({"chat_id": chat_id, "message": "⏳ Сессия входа устарела. Начни заново: /login github | /login yandex"})
                continue

            if st == "denied":
                await self.redis.delete_session(chat_id)
                items.append({"chat_id": chat_id, "message": "❌ В доступе отказано. Попробуй ещё раз: /login github | /login yandex"})
                continue

            if st == "granted":
                at = check.get("access_token")
                rt = check.get("refresh_token")
                uid = check.get("user_id")
                if at and rt:
                    new_s = Session(status="auth", access_token=at, refresh_token=rt, user_id=uid)
                    await self._save_session(chat_id, new_s)
                    items.append({"chat_id": chat_id, "message": "✅ Авторизация успешна!"})
        return items

    async def tick_notifications(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        async for chat_id, s in self.redis.iter_sessions_by_status("auth"):
            if not s.access_token:
                continue
            code, body = await self.core.get_notifications(s.access_token)
            if code in (404, 405):
                continue
            if code == 401:
                ok = await self._refresh_tokens(chat_id, s)
                if not ok:
                    await self.redis.delete_session(chat_id)
                    items.append({"chat_id": chat_id, "message": "Сессия истекла. Войди заново: /login github | /login yandex | /login code"})
                    continue
                code, body = await self.core.get_notifications(s.access_token or "")
            notes = self._extract_notifications(body)
            if not notes:
                continue
            await self.core.clear_notifications(s.access_token or "")
            for n in notes:
                items.append({"chat_id": chat_id, "message": str(n)})
        return items

    async def _core_action(self, chat_id: int, session: Session, action: str, extra: Optional[Dict[str, Any]] = None) -> List[str]:
        code, body = await self.core.task(session.user_id or "", session.access_token or "", action, extra)

        # токен доступа мог устареть — пробуем рефреш и повтор
        if code == 401 or (body or "").startswith("ERROR 401"):
            ok = await self._refresh_tokens(chat_id, session)
            if not ok:
                return ["Сессия истекла. Авторизуйся заново: /login github | /login yandex | /login code"]
            code, body = await self.core.task(session.user_id or "", session.access_token or "", action, extra)

        return self._format_core_response(code, body)

    async def _refresh_tokens(self, chat_id: int, session: Session) -> bool:
        if not session.refresh_token:
            return False
        data = await self.auth.safe_refresh(session.refresh_token)
        if not data:
            return False
        at = data.get("access_token")
        rt = data.get("refresh_token")
        if not at or not rt:
            return False
        session.access_token = at
        session.refresh_token = rt
        await self._save_session(chat_id, session)
        return True

    def _format_core_response(self, http_code: int, body: str) -> List[str]:
        txt = (body or "").strip()

        if txt.startswith("ERROR"):
            if "418" in txt:
                return ["⛔️ Вы заблокированы."]
            if "401" in txt:
                return ["⛔️ Доступ запрещён: войди заново (/logout → /login)."]
            if "403" in txt:
                return ["⛔️ Недостаточно прав для этого действия."]
            if "400" in txt:
                return [f"⚠️ Неверные параметры: {txt}"]
            return [f"⚠️ Ошибка: {txt}"]

        # красиво выводим JSON
        try:
            data = json.loads(txt)
            pretty = json.dumps(data, ensure_ascii=False, indent=2)
            return [pretty]
        except Exception:
            pass

        if http_code >= 400:
            return [f"⚠️ Ошибка сервиса (HTTP {http_code}).", txt or "Пустой ответ"]

        return [txt or "✅ Готово"]

    def _extract_notifications(self, body: str) -> List[str]:
        txt = (body or "").strip()
        try:
            data = json.loads(txt)
            if isinstance(data, dict) and isinstance(data.get("notifications"), list):
                return [str(x) for x in data.get("notifications") if str(x).strip()]
        except Exception:
            pass
        return []

    async def _load_session(self, chat_id: int) -> Optional[Session]:
        raw = await self.redis.get_session(chat_id)
        if not raw:
            return None
        return Session(
            status=raw.get("status", "unknown"),
            login_token=raw.get("login_token"),
            access_token=raw.get("access_token"),
            refresh_token=raw.get("refresh_token"),
            user_id=raw.get("user_id"),
        )

    async def _save_session(self, chat_id: int, s: Session) -> None:
        await self.redis.save_session(
            chat_id,
            {
                "status": s.status,
                "login_token": s.login_token,
                "access_token": s.access_token,
                "refresh_token": s.refresh_token,
                "user_id": s.user_id,
            },
        )
