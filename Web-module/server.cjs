const express = require('express');
const { createClient } = require('redis');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cookieParser());
app.use(express.json());

const redis = createClient({ url: 'redis://localhost:6379' });
redis.connect().then(() => console.log('✅ Web Client подключен к Redis'));

const AUTH_MODULE_URL = 'http://localhost:8080';
const CPP_SERVER_URL = 'http://localhost:7081';

// Обновление токена
async function refreshAccessToken(sessionToken, refreshToken) {
	try {
		console.log("🔄 Токен истекает. Обновляю через Go...");
		const response = await fetch(`${AUTH_MODULE_URL}/api/auth/refresh`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refresh_token: refreshToken })
		});

		if (!response.ok) {
			console.error("❌ Ошибка обновления токена:", response.status);
			return null;
		}

		const data = await response.json();
		if (!data.access_token) return null;

		const cachedData = await redis.get(sessionToken);
		if (!cachedData) return null;

		const userData = JSON.parse(cachedData);
		userData.accessToken = data.access_token;

		// ВАЖНО: Обновляем роль в Redis, если она изменилась
		try {
			const tokenPart = data.access_token.split('.')[1];
			const payload = JSON.parse(Buffer.from(tokenPart, 'base64').toString());
			if (payload.role) {
				userData.role = payload.role;
				console.log("🆙 Роль обновлена на:", payload.role);
			}
		} catch (e) { console.error("Parse role error:", e); }

		await redis.set(sessionToken, JSON.stringify(userData), { EX: 3600 });
		return data.access_token;
	} catch (e) {
		console.error("Critical Refresh Error:", e);
		return null;
	}
}

async function callCpp(action, params = {}, req) {
	const sessionToken = req.cookies['session_token'];
	if (!sessionToken) return { status: 401, body: "No session cookie" };

	let cachedData = await redis.get(sessionToken);
	if (!cachedData) return { status: 401, body: "Session expired" };

	let user = JSON.parse(cachedData);
	if (!user.accessToken) return { status: 401, body: "No token" };

	let currentToken = user.accessToken;
	try {
		const payload = JSON.parse(Buffer.from(currentToken.split('.')[1], 'base64').toString());
		const now = Math.floor(Date.now() / 1000);
		if (payload.exp && (payload.exp - now) < 10) {
			const newToken = await refreshAccessToken(sessionToken, user.refreshToken);
			if (newToken) currentToken = newToken;
		}
	} catch (e) { }

	const performRequest = async (tokenToUse) => {
		try {
			const tokenParts = tokenToUse.split('.');
			if (tokenParts.length < 2) return { status: 400, body: "Invalid Token" };
			const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

			const url = new URL(`${CPP_SERVER_URL}/task`);
			url.searchParams.append('Action', action);
			url.searchParams.append('JWT', tokenToUse);
			url.searchParams.append('ID', payload.user_id);
			Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));

			const response = await fetch(url.toString());
			const text = await response.text();
			return { status: response.status, body: text };
		} catch (e) {
			console.error(`C++ Error (${action}):`, e);
			return { status: 500, body: "Internal Proxy Error" };
		}
	};

	let result = await performRequest(currentToken);

	if (result.status === 401 || result.body.includes("ERROR 401") || result.body.includes("Token expired")) {
		const newToken = await refreshAccessToken(sessionToken, user.refreshToken);
		if (newToken) result = await performRequest(newToken);
		else return { status: 401, body: "Session expired completely" };
	}

	return result;
}


// Проверка статуса
app.get('/api/auth/status', async (req, res) => {
	const sessionToken = req.cookies['session_token'];
	if (!sessionToken) return res.json({ status: 'Unknown' });

	const cachedData = await redis.get(sessionToken);
	if (!cachedData) return res.json({ status: 'Unknown' });

	try {
		let data = JSON.parse(cachedData);

		if (data.status === 'Anonymous' && data.loginToken) {
			const response = await fetch(`${AUTH_MODULE_URL}/api/auth/check/${data.loginToken}`);
			if (response.ok) {
				const authResult = await response.json();
				if (authResult.status === 'granted') {
					const tokenParts = authResult.access_token.split('.');
					const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());

					const authorizedData = {
						status: 'Authorized',
						role: payload.role || 'Student',
						userName: authResult.user_name || 'User',
						accessToken: authResult.access_token,
						refreshToken: authResult.refresh_token
					};
					await redis.set(sessionToken, JSON.stringify(authorizedData), { EX: 3600 });
					return res.json(authorizedData);
				}
			}
		}
		res.json(data);
	} catch (e) {
		console.error("Status check error:", e);
		res.json({ status: 'Unknown' });
	}
});

// Инициализация входа
app.get('/api/auth/init', async (req, res) => {
	const { type } = req.query;
	const sessionToken = uuidv4();
	const loginToken = uuidv4();
	await redis.set(sessionToken, JSON.stringify({ status: 'Anonymous', loginToken }), { EX: 600 });
	res.cookie('session_token', sessionToken, { httpOnly: true });

	try {
		const response = await fetch(`${AUTH_MODULE_URL}/api/auth/init?type=${type}&login_token=${loginToken}`);
		const data = await response.json();
		res.json({ url: data.auth_url });
	} catch (e) { res.status(500).json({ error: "Auth Error" }); }
});

app.get('/api/auth/confirm', async (req, res) => {
	const { state, user } = req.query;
	const sessionToken = req.cookies['session_token'];

	if (sessionToken) {
		try {
			const response = await fetch(`${AUTH_MODULE_URL}/api/auth/check/${state}`);
			if (response.ok) {
				const authResult = await response.json();
				if (authResult.status === 'granted' && authResult.access_token) {
					// !!! ПАРСИМ РОЛЬ !!!
					const payload = JSON.parse(Buffer.from(authResult.access_token.split('.')[1], 'base64').toString());

					const authorizedData = {
						status: 'Authorized',
						userName: user,
						role: payload.role || 'Student', // <--- БЕРЕМ ИЗ ТОКЕНА
						accessToken: authResult.access_token,
						refreshToken: authResult.refresh_token
					};
					await redis.set(sessionToken, JSON.stringify(authorizedData), { EX: 3600 });
					console.log(`✅ Вход успешен. Роль: ${authorizedData.role}`);
				}
			}
		} catch (e) { console.error(e); }
	}
	res.send(`<script>window.location.href = 'http://localhost/';</script>`);
});

app.post('/api/auth/logout', async (req, res) => {
	const sessionToken = req.cookies['session_token'];
	if (sessionToken) await redis.del(sessionToken);
	res.clearCookie('session_token');
	res.json({ status: 'LoggedOut' });
});


app.get('/api/user/me', (req, res) =>
	callCpp('VIEW_OWN_NAME', {}, req).then(r => res.status(r.status).send(r.body)));

app.get('/api/user/update-name', (req, res) =>
	callCpp('EDIT_OWN_NAME', { New_name: req.query.first, New_lastname: req.query.last }, req)
		.then(r => res.status(r.status).send(r.body)));

app.get('/api/student/dashboard', (req, res) =>
	callCpp('VIEW_OWN_DATA', {}, req).then(r => res.status(r.status).send(r.body)));

app.get('/api/admin/users', (req, res) =>
	callCpp('VIEW_ALL_USERS', {}, req).then(r => res.status(r.status).send(r.body)));

// Смена роли
app.post('/api/admin/role', (req, res) =>
	callCpp('EDIT_OTHER_ROLES', { Target_ID: req.body.userId, Target_ROLE: req.body.newRole }, req)
		.then(r => res.status(r.status).send(r.body)));

// Запись студента на курс
app.post('/api/course/enroll', (req, res) =>
	callCpp('ENROLL_STUDENT', { Course_ID: req.body.courseId, Target_ID: req.body.studentId }, req)
		.then(r => res.status(r.status).send(r.body)));


// получить статус блокировки пользователя
app.get('/api/admin/blocked', async (req, res) => {
	try {
		const sessionToken = req.cookies['session_token'];
		if (!sessionToken) return res.status(401).json({ error: "No session" });

		const cached = await redis.get(sessionToken);
		if (!cached) return res.status(401).json({ error: "Session expired" });

		const user = JSON.parse(cached);
		if (!user.accessToken) return res.status(401).json({ error: "No token" });

		const userId = req.query.userId;
		if (!userId) return res.status(400).json({ error: "userId required" });

		const url = new URL(`${AUTH_MODULE_URL}/api/user/blocked`);
		url.searchParams.append("ID", userId);

		const r = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${user.accessToken}` }
		});

		const text = await r.text();

		try {
			return res.status(r.status).json(JSON.parse(text));
		} catch {
			return res.status(r.status).send(text);
		}
	} catch (e) {
		console.error("blocked status error:", e);
		return res.status(500).json({ error: "Server error" });
	}
});

// заблокировать / разблокировать
app.post('/api/admin/blocked', async (req, res) => {
	try {
		const sessionToken = req.cookies['session_token'];
		if (!sessionToken) return res.status(401).json({ error: "No session" });

		const cached = await redis.get(sessionToken);
		if (!cached) return res.status(401).json({ error: "Session expired" });

		const user = JSON.parse(cached);
		if (!user.accessToken) return res.status(401).json({ error: "No token" });

		const { userId, blocked } = req.body || {};
		if (!userId || typeof blocked !== "boolean") {
			return res.status(400).json({ error: "userId and blocked(boolean) required" });
		}

		const url = new URL(`${AUTH_MODULE_URL}/api/user/blockededit`);
		url.searchParams.append("ID", userId);

		url.searchParams.append("ACTION", blocked ? "block" : "unblock");

		let r = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${user.accessToken}` }
		});

		let text = await r.text();

		if (!r.ok) {
			const url2 = new URL(`${AUTH_MODULE_URL}/api/user/blockededit`);
			url2.searchParams.append("ID", userId);
			url2.searchParams.append("ACTION", blocked ? "1" : "0");

			r = await fetch(url2.toString(), {
				headers: { Authorization: `Bearer ${user.accessToken}` }
			});
			text = await r.text();
		}

		try {
			return res.status(r.status).json(JSON.parse(text));
		} catch {
			return res.status(r.status).send(text);
		}
	} catch (e) {
		console.error("blocked edit error:", e);
		return res.status(500).json({ error: "Server error" });
	}
});

app.get('/api/courses/all', async (req, res) => {
	try {
		const coursesRes = await callCpp('VIEW_ALL_COURSES', {}, req);
		if (coursesRes.status !== 200) return res.status(coursesRes.status).send(coursesRes.body);

		const coursesData = JSON.parse(coursesRes.body);
		if (!coursesData.courses) return res.json({ courses: [] });

		const coursesWithTests = await Promise.all(coursesData.courses.map(async (course) => {
			const testsRes = await callCpp('VIEW_COURSE_TESTS', { Course_ID: course.id }, req);
			let tests = [];
			try {
				const testsData = JSON.parse(testsRes.body);
				if (testsData.tests) tests = testsData.tests;
			} catch (e) { }
			return { ...course, tests };
		}));

		res.json({ courses: coursesWithTests });
	} catch (e) { res.status(500).json({ error: "Server Error" }); }
});

app.post('/api/course/create', async (req, res) => {
	try {
		const sessionToken = req.cookies['session_token'];
		const cachedData = await redis.get(sessionToken);
		if (!cachedData) return res.status(401).json({ error: "No session" });

		const user = JSON.parse(cachedData);
		const payload = JSON.parse(Buffer.from(user.accessToken.split('.')[1], 'base64').toString());
		const teacherId = (req.body.teacherId === "SELF") ? payload.user_id : req.body.teacherId;

		const cppRes = await callCpp('CREATE_COURSE', {
			Course_NAME: req.body.name,
			Description: req.body.description,
			Target_ID: teacherId
		}, req);
		res.status(cppRes.status).send(cppRes.body);
	} catch (e) { res.status(500).json({ error: "Proxy Error" }); }
});

app.post('/api/course/edit', (req, res) =>
	callCpp('EDIT_COURSE_INFO', { Course_ID: req.body.courseId, Course_NAME: req.body.name, Description: req.body.description }, req)
		.then(r => res.status(r.status).send(r.body)));

app.post('/api/course/delete', (req, res) =>
	callCpp('DELETE_COURSE', { Course_ID: req.body.courseId }, req).then(r => res.status(r.status).send(r.body)));

app.post('/api/test/create-full', async (req, res) => {
	try {
		const { courseId, title, questions } = req.body;
		const testRes = await callCpp('CREATE_TEST', { Course_ID: courseId, Title: title }, req);
		const testData = JSON.parse(testRes.body);
		if (testData.error || !testData.test_id) return res.status(400).send(testRes.body);
		const testId = testData.test_id;

		for (const q of questions) {
			const qRes = await callCpp('CREATE_QUESTION', {
				Title: q.text.substring(0, 30) + "...",
				Text: q.text,
				Options: JSON.stringify(q.options),
				Answer_Index: q.correctIndex
			}, req);
			const qData = JSON.parse(qRes.body);
			if (qData.question_id) {
				await callCpp('ADD_QUESTION_TO_TEST', { Test_ID: testId, Question_ID: qData.question_id }, req);
			}
		}
		await callCpp('TOGGLE_TEST_ACTIVE', { Course_ID: courseId, Test_ID: testId, Activate: "true" }, req);
		res.json({ status: "success", test_id: testId });
	} catch (e) { res.status(500).json({ error: "Failed to create test" }); }
});

app.post('/api/test/delete', (req, res) =>
	callCpp('DELETE_TEST', { Course_ID: req.body.courseId, Test_ID: req.body.testId }, req)
		.then(r => res.status(r.status).send(r.body)));



app.get('/api/test/active', (req, res) =>
	callCpp('CHECK_TEST_ACTIVE', { Course_ID: req.query.courseId, Test_ID: req.query.testId }, req)
		.then(r => res.status(r.status).send(r.body))
);

app.post('/api/test/active', (req, res) =>
	callCpp('TOGGLE_TEST_ACTIVE', {
		Course_ID: req.body.courseId,
		Test_ID: req.body.testId,
		Activate: String(!!req.body.activate) 
	}, req).then(r => res.status(r.status).send(r.body))
);

app.get('/api/test/attempts', (req, res) =>
	callCpp('VIEW_TEST_ATTEMPTS', { Test_ID: req.query.testId }, req)
		.then(r => res.status(r.status).send(r.body))
);


app.post('/api/test/start', (req, res) =>
	callCpp('CREATE_ATTEMPT', { Test_ID: req.body.testId }, req).then(r => res.status(r.status).send(r.body))
);

app.get('/api/test/question', (req, res) =>
	callCpp('VIEW_QUESTION_DETAIL', { Question_ID: req.query.id, Version: req.query.version }, req)
		.then(r => res.status(r.status).send(r.body))
);

app.post('/api/test/answer', (req, res) =>
	callCpp('UPDATE_ANSWER', { Attempt_ID: req.body.attemptId, Question_ID: req.body.questionId, Answer_Index: req.body.answerIndex }, req)
		.then(r => res.status(r.status).send(r.body))
);

app.post('/api/test/complete', (req, res) =>
	callCpp('COMPLETE_ATTEMPT', { Attempt_ID: req.body.attemptId }, req).then(r => res.status(r.status).send(r.body))
);

app.get('/api/proxy/attempt', (req, res) =>
	callCpp('VIEW_ATTEMPT', { Test_ID: req.query.id }, req).then(r => res.status(r.status).send(r.body))
);


app.listen(3001, () => console.log('🚀 Node.js Server на порту 3001 запущен'));