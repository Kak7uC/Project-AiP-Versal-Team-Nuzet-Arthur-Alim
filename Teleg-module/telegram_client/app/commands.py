SUPPORTED_PREFIXES = (
    "/start", "/menu", "/help",
    "/login", "/logout", "/me",
    "/users", "/user", "/user_set_name", "/user_data",
    "/user_roles", "/user_set_roles", "/user_block", "/user_block_set",
    "/courses", "/course", "/course_tests", "/course_users",
    "/course_user_add", "/course_user_del", "/course_add", "/course_del", "/course_set",
    "/course_test",
    "/questions", "/question", "/question_add", "/question_update", "/question_del",
    "/test", "/test_add", "/test_del", "/test_active",
    "/test_q_add", "/test_q_del", "/test_q_order",
    "/test_users", "/test_grades", "/test_answers",
    "/attempt_start", "/attempt", "/attempt_finish",
    "/answer", "/answer_set", "/answer_del",
    "/notifications",
)

def is_supported_command(text: str) -> bool:
    t = (text or "").strip()
    if not t.startswith("/"):
        return False
    for p in SUPPORTED_PREFIXES:
        if t == p or t.startswith(p + " "):
            return True
    return False
