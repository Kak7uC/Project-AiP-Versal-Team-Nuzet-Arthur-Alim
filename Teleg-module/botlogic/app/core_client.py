from __future__ import annotations
from typing import Any, Optional
import httpx


class CoreClient:
    def __init__(self, base_url: str, timeout_sec: float = 8.0, demo_mode: bool = False):
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout_sec
        self.demo_mode = demo_mode

    def _headers(self, access: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {access}"}

    async def _request(self, method: str, path: str, access: str, params: Optional[dict] = None, json: Optional[dict] = None):
        if self.demo_mode or not self.base_url:
            return 200, {"demo": True, "method": method, "path": path, "params": params, "json": json}

        url = f"{self.base_url}{path}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            r = await client.request(method, url, headers=self._headers(access), params=params, json=json)

        try:
            data = r.json()
        except Exception:
            data = r.text
        return r.status_code, data

    # USERS
    async def users_list(self, a): return await self._request("GET", "/users", a)
    async def user_get(self, a, uid): return await self._request("GET", f"/users/{uid}", a)
    async def user_update_name(self, a, uid, full_name): return await self._request("PUT", f"/users/{uid}", a, json={"fullName": full_name})
    async def user_details(self, a, uid): return await self._request("GET", f"/users/{uid}/details", a)
    async def user_roles_get(self, a, uid): return await self._request("GET", f"/users/{uid}/roles", a)
    async def user_roles_set(self, a, uid, roles): return await self._request("PUT", f"/users/{uid}/roles", a, json={"roles": roles})
    async def user_block_get(self, a, uid): return await self._request("GET", f"/users/{uid}/block", a)
    async def user_block_set(self, a, uid, blocked: bool): return await self._request("PUT", f"/users/{uid}/block", a, json={"blocked": blocked})

    # COURSES
    async def courses_list(self, a): return await self._request("GET", "/courses", a)
    async def course_get(self, a, cid): return await self._request("GET", f"/courses/{cid}", a)
    async def course_update(self, a, cid, name, desc):
        payload: dict[str, Any] = {}
        if name is not None: payload["name"] = name
        if desc is not None: payload["description"] = desc
        return await self._request("PUT", f"/courses/{cid}", a, json=payload)

    async def course_tests(self, a, cid): return await self._request("GET", f"/courses/{cid}/tests", a)
    async def course_users(self, a, cid): return await self._request("GET", f"/courses/{cid}/users", a)
    async def course_user_add(self, a, cid, uid): return await self._request("POST", f"/courses/{cid}/users", a, json={"userId": uid})
    async def course_user_del(self, a, cid, uid): return await self._request("DELETE", f"/courses/{cid}/users/{uid}", a)

    async def course_add(self, a, name, desc, teacher_id):
        return await self._request("POST", "/courses", a, json={"name": name, "description": desc, "teacherId": teacher_id})

    async def course_del(self, a, cid): return await self._request("DELETE", f"/courses/{cid}", a)

    async def course_test_status(self, a, course_id: str, test_id: str):
        return await self._request("GET", f"/courses/{course_id}/tests/{test_id}", a)

    # TESTS 
    async def test_get(self, a, tid): return await self._request("GET", f"/tests/{tid}", a)
    async def test_active_set(self, a, tid, active: bool): return await self._request("PUT", f"/tests/{tid}/active", a, json={"active": active})
    async def test_add(self, a, course_id, name): return await self._request("POST", f"/courses/{course_id}/tests", a, json={"name": name})
    async def test_del(self, a, tid): return await self._request("DELETE", f"/tests/{tid}", a)

    async def test_q_add(self, a, tid, qid): return await self._request("POST", f"/tests/{tid}/questions", a, json={"questionId": qid})
    async def test_q_del(self, a, tid, qid): return await self._request("DELETE", f"/tests/{tid}/questions/{qid}", a)
    async def test_q_order(self, a, tid, order): return await self._request("PUT", f"/tests/{tid}/questions/order", a, json={"order": order})

    async def test_users_done(self, a, tid): return await self._request("GET", f"/tests/{tid}/users", a)
    async def test_grades(self, a, tid): return await self._request("GET", f"/tests/{tid}/grades", a)
    async def test_answers_all(self, a, tid): return await self._request("GET", f"/tests/{tid}/answers", a)

    # QUESTIONS
    async def questions_list(self, a): return await self._request("GET", "/questions", a)
    async def question_get(self, a, qid, version: Optional[int]):
        params = {"version": version} if version is not None else None
        return await self._request("GET", f"/questions/{qid}", a, params=params)

    async def question_add(self, a, title, text, options, correct_index: int):
        return await self._request("POST", "/questions", a, json={"title": title, "text": text, "options": options, "correctIndex": correct_index})

    async def question_update(self, a, qid, title, text, options, correct_index: int):
        return await self._request("PUT", f"/questions/{qid}", a, json={"title": title, "text": text, "options": options, "correctIndex": correct_index})

    async def question_del(self, a, qid): return await self._request("DELETE", f"/questions/{qid}", a)

    # ATTEMPT
    async def attempt_start(self, a, test_id): return await self._request("POST", f"/tests/{test_id}/attempt", a)
    async def attempt_get(self, a, test_id): return await self._request("GET", f"/tests/{test_id}/attempt", a)
    async def attempt_finish(self, a, test_id): return await self._request("POST", f"/tests/{test_id}/attempt/finish", a)

    # ANSWERS
    async def answer_get(self, a, answer_id): return await self._request("GET", f"/answers/{answer_id}", a)
    async def answer_set(self, a, answer_id, value: int): return await self._request("PUT", f"/answers/{answer_id}", a, json={"value": value})
    async def answer_del(self, a, answer_id): return await self._request("DELETE", f"/answers/{answer_id}", a)

    # NOTIFICATIONS
    async def get_notifications(self, a): return await self._request("GET", "/notification", a)
    async def clear_notifications(self, a): return await self._request("DELETE", "/notification", a)
