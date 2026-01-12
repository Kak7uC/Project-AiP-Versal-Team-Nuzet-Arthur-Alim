from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder


def main_menu_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="👥 Пользователи"), KeyboardButton(text="📚 Дисциплины")],
            [KeyboardButton(text="❓ Вопросы"), KeyboardButton(text="📝 Тесты")],
            [KeyboardButton(text="🧪 Попытка"), KeyboardButton(text="🧩 Ответы")],
            [KeyboardButton(text="🔔 Уведомления"), KeyboardButton(text="🔐 Авторизация")],
            [KeyboardButton(text="ℹ️ Помощь")],
        ],
        resize_keyboard=True,
    )


def section_users_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Список пользователей", callback_data="users:list")
    b.button(text="ФИО по ID", callback_data="users:get")
    b.button(text="Изменить ФИО", callback_data="users:set_name")
    b.button(text="Данные (курсы/оценки/тесты)", callback_data="users:data")
    b.button(text="Роли по ID", callback_data="users:roles_get")
    b.button(text="Изменить роли", callback_data="users:roles_set")
    b.button(text="Статус блокировки", callback_data="users:block_get")
    b.button(text="Блок/разблок", callback_data="users:block_set")
    b.button(text="⬅️ Назад", callback_data="back:main")
    b.adjust(1)
    return b.as_markup()


def section_courses_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Список дисциплин", callback_data="courses:list")
    b.button(text="Инфо о дисциплине", callback_data="courses:get")
    b.button(text="Изменить дисциплину", callback_data="courses:set")
    b.button(text="Список тестов дисциплины", callback_data="courses:tests")
    b.button(text="Список студентов дисциплины", callback_data="courses:users")
    b.button(text="Записать студента", callback_data="courses:user_add")
    b.button(text="Отчислить студента", callback_data="courses:user_del")
    b.button(text="Создать дисциплину", callback_data="courses:add")
    b.button(text="Удалить дисциплину", callback_data="courses:del")
    b.button(text="Статус теста в дисциплине", callback_data="courses:test_status")
    b.button(text="⬅️ Назад", callback_data="back:main")
    b.adjust(1)
    return b.as_markup()


def section_questions_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Список вопросов", callback_data="q:list")
    b.button(text="Инфо (ID + версия)", callback_data="q:get")
    b.button(text="Создать вопрос", callback_data="q:add")
    b.button(text="Обновить вопрос (новая версия)", callback_data="q:update")
    b.button(text="Удалить вопрос", callback_data="q:del")
    b.button(text="⬅️ Назад", callback_data="back:main")
    b.adjust(1)
    return b.as_markup()


def section_tests_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Инфо о тесте", callback_data="t:get")
    b.button(text="Добавить тест в дисциплину", callback_data="t:add")
    b.button(text="Удалить тест", callback_data="t:del")
    b.button(text="Активировать/деактивировать", callback_data="t:active")
    b.button(text="Добавить вопрос в тест", callback_data="t:q_add")
    b.button(text="Удалить вопрос из теста", callback_data="t:q_del")
    b.button(text="Порядок вопросов", callback_data="t:q_order")
    b.button(text="Прошедшие тест", callback_data="t:users")
    b.button(text="Оценки", callback_data="t:grades")
    b.button(text="Ответы пользователей", callback_data="t:answers")
    b.button(text="⬅️ Назад", callback_data="back:main")
    b.adjust(1)
    return b.as_markup()


def section_attempt_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Начать попытку", callback_data="a:start")
    b.button(text="Посмотреть попытку", callback_data="a:get")
    b.button(text="Завершить попытку", callback_data="a:finish")
    b.button(text="⬅️ Назад", callback_data="back:main")
    b.adjust(1)
    return b.as_markup()


def section_answers_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Посмотреть ответ", callback_data="ans:get")
    b.button(text="Изменить ответ", callback_data="ans:set")
    b.button(text="Сбросить ответ (-1)", callback_data="ans:del")
    b.button(text="⬅️ Назад", callback_data="back:main")
    b.adjust(1)
    return b.as_markup()


def section_auth_kb() -> InlineKeyboardMarkup:
    b = InlineKeyboardBuilder()
    b.button(text="Войти через GitHub", callback_data="auth:login:github")
    b.button(text="Войти через Yandex", callback_data="auth:login:yandex")
    b.button(text="Войти по одноразовому коду", callback_data="auth:login:code")
    b.button(text="Выйти", callback_data="auth:logout")
    b.button(text="Выйти везде", callback_data="auth:logout_all")
    b.button(text="⬅️ Назад", callback_data="back:main")
    b.adjust(1)
    return b.as_markup()
