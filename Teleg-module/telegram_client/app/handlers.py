from __future__ import annotations

import logging

from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext

from .botlogic_api import BotLogicAPI
from .keyboards import (
    main_menu_kb,
    section_users_kb, section_courses_kb, section_questions_kb,
    section_tests_kb, section_attempt_kb, section_answers_kb, section_auth_kb
)
from .states import InputState

router = Router()
logger = logging.getLogger(__name__)

HELP_TEXT = (
    "👋 Привет! Я — Versal Test Bot.\n\n"
    "Навигация:\n"
    "• /menu — открыть меню\n"
    "• /help — помощь\n"
    "• /me — статус\n"
)

# ========= helpers =========

async def _set_action(state: FSMContext, action: str, prompt: str, extra: dict | None = None):
    data = {"action": action, "prompt": prompt}
    if extra:
        data.update(extra)

    await state.update_data(**data)
    await state.set_state(InputState.waiting_value)


async def _send_botlogic(msg: Message, api: BotLogicAPI, text: str):
    chat_id = msg.chat.id
    try:
        resp = await api.send_text(chat_id, text)

        if not resp:
            await msg.answer("✅ Готово.")
            return

        for line in resp:
            await msg.answer(line)

    except Exception as e:
        logger.exception("BotLogic request failed. chat_id=%s text=%r error=%s", chat_id, text, e)
        await msg.answer("⚠️ Ошибка сервиса. Попробуй ещё раз чуть позже.")


async def _is_authorized(msg: Message, api: BotLogicAPI) -> bool:
    try:
        resp = await api.send_text(msg.chat.id, "/me")
    except Exception:
        return False

    text = "\n".join(resp or []).lower()
    return ("авторизован" in text) and ("не авторизован" not in text)


async def _deny_not_auth(msg: Message):
    await msg.answer(
        "🔒 Ты не авторизован.\n"
        "Открой: 🔐 Авторизация → выбери способ входа."
    )


# ========= MAIN MENU =========

@router.message(Command("start"))
@router.message(Command("menu"))
async def start_menu(m: Message):
    await m.answer("Главное меню:", reply_markup=main_menu_kb())


@router.message(Command("help"))
@router.message(F.text == "ℹ️ Помощь")
async def help_menu(m: Message):
    await m.answer(HELP_TEXT)


@router.message(F.text == "👥 Пользователи")
async def menu_users(m: Message):
    await m.answer("Раздел: Пользователи", reply_markup=section_users_kb())


@router.message(F.text == "📚 Дисциплины")
async def menu_courses(m: Message):
    await m.answer("Раздел: Дисциплины", reply_markup=section_courses_kb())


@router.message(F.text == "❓ Вопросы")
async def menu_questions(m: Message):
    await m.answer("Раздел: Вопросы", reply_markup=section_questions_kb())


@router.message(F.text == "📝 Тесты")
async def menu_tests(m: Message):
    await m.answer("Раздел: Тесты", reply_markup=section_tests_kb())


@router.message(F.text == "🧪 Попытка")
async def menu_attempt(m: Message):
    await m.answer("Раздел: Попытка", reply_markup=section_attempt_kb())


@router.message(F.text == "🧩 Ответы")
async def menu_answers(m: Message):
    await m.answer("Раздел: Ответы", reply_markup=section_answers_kb())


@router.message(F.text == "🔔 Уведомления")
async def menu_notifications(m: Message, api: BotLogicAPI):
    if not await _is_authorized(m, api):
        await _deny_not_auth(m)
        return
    await _send_botlogic(m, api, "/notifications")


@router.message(F.text == "🔐 Авторизация")
async def menu_auth(m: Message):
    await m.answer("Раздел: Авторизация", reply_markup=section_auth_kb())


@router.callback_query(F.data == "back:main")
async def back_main(c: CallbackQuery):
    await c.answer()
    await c.message.answer("Главное меню:", reply_markup=main_menu_kb())


# ========= AUTH buttons =========

@router.callback_query(F.data.startswith("auth:login:"))
async def auth_login(c: CallbackQuery, api: BotLogicAPI):
    await c.answer()
    login_type = c.data.split(":")[2]
    await _send_botlogic(c.message, api, f"/login {login_type}")


@router.callback_query(F.data == "auth:logout")
async def auth_logout(c: CallbackQuery, api: BotLogicAPI):
    await c.answer()
    await _send_botlogic(c.message, api, "/logout")


@router.callback_query(F.data == "auth:logout_all")
async def auth_logout_all(c: CallbackQuery, api: BotLogicAPI):
    await c.answer()
    await _send_botlogic(c.message, api, "/logout all=true")


# ========= USERS callbacks =========

@router.callback_query(F.data == "users:list")
async def users_list(c: CallbackQuery, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _send_botlogic(c.message, api, "/users")


@router.callback_query(F.data == "users:get")
async def users_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "users:get", "Введи ID пользователя:")
    await c.message.answer("Введи ID пользователя:")


@router.callback_query(F.data == "users:set_name")
async def users_set_name(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "users:set_name", "Введи: <id> <ФИО>")
    await c.message.answer("Введи: <id> <ФИО>")


@router.callback_query(F.data == "users:data")
async def users_data(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "users:data", "Введи ID пользователя:")
    await c.message.answer("Введи ID пользователя:")


@router.callback_query(F.data == "users:roles_get")
async def users_roles_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "users:roles_get", "Введи ID пользователя:")
    await c.message.answer("Введи ID пользователя:")


@router.callback_query(F.data == "users:roles_set")
async def users_roles_set(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "users:roles_set", "Введи: <id> <role1,role2,...>")
    await c.message.answer("Введи: <id> <role1,role2,...>")


@router.callback_query(F.data == "users:block_get")
async def users_block_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "users:block_get", "Введи ID пользователя:")
    await c.message.answer("Введи ID пользователя:")


@router.callback_query(F.data == "users:block_set")
async def users_block_set(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "users:block_set", "Введи: <id> on/off")
    await c.message.answer("Введи: <id> on/off")


# ========= COURSES callbacks =========

@router.callback_query(F.data == "courses:list")
async def courses_list(c: CallbackQuery, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _send_botlogic(c.message, api, "/courses")


@router.callback_query(F.data == "courses:get")
async def courses_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:get", "Введи ID дисциплины:")
    await c.message.answer("Введи ID дисциплины:")


@router.callback_query(F.data == "courses:set")
async def courses_set(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:set", "Введи: <id> name=<...> desc=<...>")
    await c.message.answer("Введи: <id> name=<...> desc=<...>")


@router.callback_query(F.data == "courses:tests")
async def courses_tests(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:tests", "Введи ID дисциплины:")
    await c.message.answer("Введи ID дисциплины:")


@router.callback_query(F.data == "courses:users")
async def courses_users(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:users", "Введи ID дисциплины:")
    await c.message.answer("Введи ID дисциплины:")


@router.callback_query(F.data == "courses:user_add")
async def courses_user_add(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:user_add", "Введи: <course_id> <user_id>")
    await c.message.answer("Введи: <course_id> <user_id>")


@router.callback_query(F.data == "courses:user_del")
async def courses_user_del(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:user_del", "Введи: <course_id> <user_id>")
    await c.message.answer("Введи: <course_id> <user_id>")


@router.callback_query(F.data == "courses:add")
async def courses_add(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:add", "Введи: <name> | <desc> | <teacher_id>")
    await c.message.answer("Введи: <name> | <desc> | <teacher_id>")


@router.callback_query(F.data == "courses:del")
async def courses_del(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:del", "Введи ID дисциплины:")
    await c.message.answer("Введи ID дисциплины:")


@router.callback_query(F.data == "courses:test_status")
async def courses_test_status(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "courses:test_status", "Введи: <course_id> <test_id>")
    await c.message.answer("Введи: <course_id> <test_id>")


# ========= QUESTIONS callbacks =========

@router.callback_query(F.data == "q:list")
async def q_list(c: CallbackQuery, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _send_botlogic(c.message, api, "/questions")


@router.callback_query(F.data == "q:get")
async def q_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "q:get", "Введи: <question_id> [version]")
    await c.message.answer("Введи: <question_id> [version]")


@router.callback_query(F.data == "q:add")
async def q_add(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "q:add", "Введи: <title> | <text> | <opt1;opt2;...> | <correct_index>")
    await c.message.answer("Введи: <title> | <text> | <opt1;opt2;...> | <correct_index>")


@router.callback_query(F.data == "q:update")
async def q_update(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "q:update", "Введи: <id> | <title> | <text> | <opt1;opt2;...> | <correct_index>")
    await c.message.answer("Введи: <id> | <title> | <text> | <opt1;opt2;...> | <correct_index>")


@router.callback_query(F.data == "q:del")
async def q_del(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "q:del", "Введи ID вопроса:")
    await c.message.answer("Введи ID вопроса:")


# ========= TESTS callbacks =========

@router.callback_query(F.data == "t:get")
async def t_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:get", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


@router.callback_query(F.data == "t:add")
async def t_add(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:add", "Введи: <course_id> <name>")
    await c.message.answer("Введи: <course_id> <name>")


@router.callback_query(F.data == "t:del")
async def t_del(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:del", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


@router.callback_query(F.data == "t:active")
async def t_active(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:active", "Введи: <test_id> on/off")
    await c.message.answer("Введи: <test_id> on/off")


@router.callback_query(F.data == "t:q_add")
async def t_q_add(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:q_add", "Введи: <test_id> <question_id>")
    await c.message.answer("Введи: <test_id> <question_id>")


@router.callback_query(F.data == "t:q_del")
async def t_q_del(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:q_del", "Введи: <test_id> <question_id>")
    await c.message.answer("Введи: <test_id> <question_id>")


@router.callback_query(F.data == "t:q_order")
async def t_q_order(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:q_order", "Введи: <test_id> q1,q2,q3")
    await c.message.answer("Введи: <test_id> q1,q2,q3")


@router.callback_query(F.data == "t:users")
async def t_users(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:users", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


@router.callback_query(F.data == "t:grades")
async def t_grades(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:grades", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


@router.callback_query(F.data == "t:answers")
async def t_answers(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "t:answers", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


# ========= ATTEMPT callbacks =========

@router.callback_query(F.data == "a:start")
async def a_start(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "a:start", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


@router.callback_query(F.data == "a:get")
async def a_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "a:get", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


@router.callback_query(F.data == "a:finish")
async def a_finish(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "a:finish", "Введи ID теста:")
    await c.message.answer("Введи ID теста:")


# ========= ANSWERS callbacks =========

@router.callback_query(F.data == "ans:get")
async def ans_get(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "ans:get", "Введи ID ответа:")
    await c.message.answer("Введи ID ответа:")


@router.callback_query(F.data == "ans:set")
async def ans_set(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "ans:set", "Введи: <answer_id> <variant_index>")
    await c.message.answer("Введи: <answer_id> <variant_index>")


@router.callback_query(F.data == "ans:del")
async def ans_del(c: CallbackQuery, state: FSMContext, api: BotLogicAPI):
    await c.answer()
    if not await _is_authorized(c.message, api):
        await _deny_not_auth(c.message)
        return
    await _set_action(state, "ans:del", "Введи ID ответа:")
    await c.message.answer("Введи ID ответа:")


# ========= FSM input handler =========

@router.message(InputState.waiting_value)
async def on_value(m: Message, state: FSMContext, api: BotLogicAPI):
    if not await _is_authorized(m, api):
        await state.clear()
        await _deny_not_auth(m)
        return

    data = await state.get_data()
    action = data.get("action")
    raw = (m.text or "").strip()

    cmd = None

    if action == "users:get":
        cmd = f"/user {raw}"
    elif action == "users:set_name":
        cmd = f"/user_set_name {raw}"
    elif action == "users:data":
        cmd = f"/user_data {raw}"
    elif action == "users:roles_get":
        cmd = f"/user_roles {raw}"
    elif action == "users:roles_set":
        cmd = f"/user_set_roles {raw}"
    elif action == "users:block_get":
        cmd = f"/user_block {raw}"
    elif action == "users:block_set":
        cmd = f"/user_block_set {raw}"

    elif action == "courses:get":
        cmd = f"/course {raw}"
    elif action == "courses:set":
        cmd = f"/course_set {raw}"
    elif action == "courses:tests":
        cmd = f"/course_tests {raw}"
    elif action == "courses:users":
        cmd = f"/course_users {raw}"
    elif action == "courses:user_add":
        cmd = f"/course_user_add {raw}"
    elif action == "courses:user_del":
        cmd = f"/course_user_del {raw}"
    elif action == "courses:add":
        cmd = f"/course_add {raw}"
    elif action == "courses:del":
        cmd = f"/course_del {raw}"
    elif action == "courses:test_status":
        cmd = f"/course_test {raw}"

    elif action == "q:get":
        cmd = f"/question {raw}"
    elif action == "q:add":
        cmd = f"/question_add {raw}"
    elif action == "q:update":
        cmd = f"/question_update {raw}"
    elif action == "q:del":
        cmd = f"/question_del {raw}"

    elif action == "t:get":
        cmd = f"/test {raw}"
    elif action == "t:add":
        cmd = f"/test_add {raw}"
    elif action == "t:del":
        cmd = f"/test_del {raw}"
    elif action == "t:active":
        cmd = f"/test_active {raw}"
    elif action == "t:q_add":
        cmd = f"/test_q_add {raw}"
    elif action == "t:q_del":
        cmd = f"/test_q_del {raw}"
    elif action == "t:q_order":
        cmd = f"/test_q_order {raw}"
    elif action == "t:users":
        cmd = f"/test_users {raw}"
    elif action == "t:grades":
        cmd = f"/test_grades {raw}"
    elif action == "t:answers":
        cmd = f"/test_answers {raw}"

    elif action == "a:start":
        cmd = f"/attempt_start {raw}"
    elif action == "a:get":
        cmd = f"/attempt {raw}"
    elif action == "a:finish":
        cmd = f"/attempt_finish {raw}"

    elif action == "ans:get":
        cmd = f"/answer {raw}"
    elif action == "ans:set":
        cmd = f"/answer_set {raw}"
    elif action == "ans:del":
        cmd = f"/answer_del {raw}"

    else:
        cmd = raw

    await state.clear()
    await _send_botlogic(m, api, cmd)


# ========= fallback =========

@router.message(F.text.startswith("/"))
async def manual_command(m: Message, api: BotLogicAPI):
    await _send_botlogic(m, api, m.text)


@router.message()
async def any_text_fallback(m: Message):
    await m.answer("Я понимаю только команды и кнопки меню 🙂\nОткрой /menu")
