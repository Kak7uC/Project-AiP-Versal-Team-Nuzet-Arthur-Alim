from aiogram.fsm.state import StatesGroup, State


class InputState(StatesGroup):
    waiting_value = State()
