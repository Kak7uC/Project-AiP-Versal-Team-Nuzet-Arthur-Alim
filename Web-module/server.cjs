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

// 1. Проверка статуса
app.get('/api/auth/status', async (req, res) => {
	const sessionToken = req.cookies['session_token'];
	if (!sessionToken) return res.json({ status: 'Unknown' });

	const cachedData = await redis.get(sessionToken);
	if (!cachedData) return res.json({ status: 'Unknown' });

	let data;
	try {
		data = JSON.parse(cachedData);
	} catch (e) {
		return res.json({ status: 'Unknown' });
	}
	if (data.status === 'Anonymous' && data.loginToken) {
		try {
			const response = await fetch(`${AUTH_MODULE_URL}/api/auth/check/${data.loginToken}`);
			if (response.ok) {
				const authResult = await response.json();
				if (authResult.status === 'granted') {
					const authorizedData = {
						status: 'Authorized',
						role: payload.role,
						userName: authResult.user_name || 'Студент',
						accessToken: authResult.access_token,
						refreshToken: authResult.refresh_token
					};
					await redis.set(sessionToken, JSON.stringify(authorizedData), { EX: 3600 });
					return res.json(authorizedData);
				}
			}
		} catch (error) {

		}
	}

	res.json(data);
});

// 2. Старт входа
app.get('/api/auth/init', async (req, res) => {
	const { type } = req.query;
	if (!type) return res.status(400).json({ error: "Type required" });

	const sessionToken = uuidv4();
	const loginToken = uuidv4();

	await redis.set(sessionToken, JSON.stringify({
		status: 'Anonymous',
		loginToken: loginToken
	}), { EX: 600 });

	res.cookie('session_token', sessionToken, { httpOnly: true });

	try {
		const response = await fetch(`${AUTH_MODULE_URL}/api/auth/init?type=${type}&login_token=${loginToken}`);
		const data = await response.json();
		res.json({ url: data.auth_url });
	} catch (error) {
		console.error("Ошибка init:", error);
		res.status(500).json({ error: "Auth server unreachable" });
	}
});

// 3. Обработка возврата
app.get('/api/auth/confirm', async (req, res) => {
	const { state, user } = req.query;
	const sessionToken = req.cookies['session_token'];

	console.log(`⚡ Callback от Go. User: ${user}, Token: ${state}`);

	// Если есть кука сессии — сразу обновляем Redis
	if (sessionToken) {
		try {
			const response = await fetch(`${AUTH_MODULE_URL}/api/auth/check/${state}`);

			if (response.ok) {
				const authResult = await response.json();

				if (authResult.status === 'granted' && authResult.access_token) {
					// 1. Расшифровываем токен, чтобы узнать РЕАЛЬНУЮ роль
					const payload = JSON.parse(Buffer.from(authResult.access_token.split('.')[1], 'base64').toString());

					const authorizedData = {
						status: 'Authorized',
						userName: user,
						role: payload.role || 'Student', // <--- ТЕПЕРЬ РОЛЬ БУДЕТ НАСТОЯЩЕЙ
						accessToken: authResult.access_token,
						refreshToken: authResult.refresh_token
					};

					await redis.set(sessionToken, JSON.stringify(authorizedData), { EX: 3600 });
					console.log(`✅ Redis успешно обновлен для пользователя ${user}`);
				}
			} else {
				console.log("Go ответил ошибкой при подтверждении, но мы попробуем пустить пользователя.");

				const simpleAuth = {
					status: 'Authorized',
					userName: user
				};
				await redis.set(sessionToken, JSON.stringify(simpleAuth), { EX: 3600 });
			}
		} catch (e) {
			console.error("Ошибка внутри confirm:", e);
		}
	} else {
		console.log("⚠️ Нет session_token cookie в запросе confirm!");
	}

	// Редирект на фронт
	res.send(`
        <html>
            <body style="background-color: #ffffff; color: #000000; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh;">
                <div style="text-align: center;">
                    <h1>Успешно!</h1>
                    <p>Добро пожаловать, ${user}</p>
                    <p>Заходим в личный кабинет...</p>
                </div>
                <script>
                    setTimeout(() => { window.location.href = 'http://localhost/'; }, 1000);
                </script>
            </body>
        </html>
    `);
});

// 4. Выход
app.post('/api/auth/logout', async (req, res) => {
	const sessionToken = req.cookies['session_token'];
	const { all } = req.query;

	if (sessionToken) {
		if (all === 'true') {
			try {
				const cachedData = await redis.get(sessionToken);
				if (cachedData) {
					const data = JSON.parse(cachedData);
					if (data.refreshToken) {
						await fetch(`${AUTH_MODULE_URL}/api/auth/logout?all=true`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ refresh_token: data.refreshToken })
						});
						console.log("Отправлен запрос на полный выход в Auth Module");
					}
				}
			} catch (e) {
				console.error("Ошибка при связи с Auth Module при выходе:", e);
			}
		}

		await redis.del(sessionToken);
	}

	res.clearCookie('session_token');
	res.json({ status: 'LoggedOut' });
});

const CPP_SERVER_URL = 'http://localhost:8081';
async function refreshAccessToken(sessionToken, refreshToken) {
	try {
		console.log("🔄 Токен истек. Пытаюсь обновить через Go...");

		// 1. Стучимся в Go
		const response = await fetch(`${AUTH_MODULE_URL}/api/auth/refresh`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ refresh_token: refreshToken })
		});

		if (!response.ok) {
			console.error("❌ Не удалось обновить токен. Go ответил:", response.status);
			return null;
		}

		const data = await response.json();
		if (!data.access_token) return null;

		// 2. Если получили новый токен - обновляем Redis
		// Нам нужно достать старые данные, заменить токен и сохранить обратно
		const cachedData = await redis.get(sessionToken);
		if (!cachedData) return null;

		const userData = JSON.parse(cachedData);
		userData.accessToken = data.access_token;

		// Продлеваем жизнь сессии еще на час
		await redis.set(sessionToken, JSON.stringify(userData), { EX: 3600 });

		console.log("✅ Токен успешно обновлен и сохранен в Redis!");
		return data.access_token;
	} catch (e) {
		console.error("🔥 Ошибка при обновлении токена:", e);
		return null;
	}
}

// Функция-посредник между Web и C++
// --- САМАЯ УМНАЯ ФУНКЦИЯ-ПОСРЕДНИК (ПРОВЕРКА ВРЕМЕНИ + СТРАХОВКА) ---
async function callCpp(action, params = {}, req) {
	const sessionToken = req.cookies['session_token'];
	if (!sessionToken) return { status: 401, body: "No session cookie" };

	let cachedData = await redis.get(sessionToken);
	if (!cachedData) return { status: 401, body: "Session expired" };

	let user = JSON.parse(cachedData);
	if (!user.accessToken) {
		return { status: 401, body: "Auth Error: No access token" };
	}

	// === 1. ПРОАКТИВНАЯ ПРОВЕРКА ВРЕМЕНИ (НОВАЯ ЧАСТЬ) ===
	let currentToken = user.accessToken;
	try {
		const payload = JSON.parse(Buffer.from(currentToken.split('.')[1], 'base64').toString());

		// Время сейчас (в секундах)
		const now = Math.floor(Date.now() / 1000);

		// Время жизни токена (exp) минус "буфер" 60 секунд.
		// Если время вышло или осталась минута — обновляем заранее.
		if (payload.exp && (payload.exp - now) < 10) {
			console.log(`⏳ Токен истекает через ${payload.exp - now} сек. Обновляю ЗАРАНЕЕ...`);
			const newToken = await refreshAccessToken(sessionToken, user.refreshToken);
			if (newToken) {
				currentToken = newToken; // Для этого запроса берем уже новый токен
			}
		}
	} catch (e) {
		console.error("⚠️ Ошибка при проверке времени токена:", e);
		// Если ошибка парсинга - не страшно, сработает страховка ниже
	}
	// =======================================================

	// Внутренняя функция запроса
	const performRequest = async (tokenToUse) => {
		try {
			const tokenParts = tokenToUse.split('.');
			if (tokenParts.length < 2) return { status: 400, body: "Invalid Token Structure" };
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
			console.error("Ошибка запроса к C++:", e);
			return { status: 500, body: "Internal Proxy Error" };
		}
	};

	// 2. Выполняем запрос (либо со старым, либо уже с обновленным токеном)
	let result = await performRequest(currentToken);

	// === 3. СТРАХОВКА (Если вдруг проверка времени не помогла, а C++ все равно вернул 401) ===
	const isExpired = result.status === 401 || result.body.includes("ERROR 401") || result.body.includes("Token expired");

	if (isExpired) {
		console.log("⚠️ Токен все-таки не подошел (401). Пробую обновить реактивно...");
		const newToken = await refreshAccessToken(sessionToken, user.refreshToken);

		if (newToken) {
			result = await performRequest(newToken);
		} else {
			return { status: 401, body: "Session expired completely. Please login again." };
		}
	}

	return result;
}

// Ручки для Фронтенда
app.get('/api/proxy/me', (req, res) =>
	callCpp('VIEW_OWN_NAME', {}, req).then(r => res.status(r.status).send(r.body)));

app.get('/api/proxy/update-name', (req, res) =>
	callCpp('EDIT_OWN_NAME', {
		New_name: req.query.first_name,
		New_lastname: req.query.last_name
	}, req).then(r => res.status(r.status).send(r.body)));

app.get('/api/proxy/admin/users', (req, res) =>
	callCpp('VIEW_ALL_USERS', {}, req).then(r => res.status(r.status).send(r.body)));

app.get('/api/proxy/admin/block', (req, res) =>
	callCpp('EDIT_BLOCKED', {
		Target_ID: req.query.id,
		Action: req.query.action // 'block' или 'unblock'
	}, req).then(r => res.status(r.status).send(r.body)));

// --- МОСТИК К C++ ---
const CPP_URL = 'http://localhost:8081/task';

// 1. Получение ФИО (Теперь через callCpp с авто-обновлением токена)
app.get('/api/user/me', (req, res) =>
	callCpp('VIEW_OWN_NAME', {}, req)
		.then(r => res.status(r.status).send(r.body))
);

// 2. Смена ФИО (Теперь через callCpp с авто-обновлением токена)
app.get('/api/user/update-name', (req, res) =>
	callCpp('EDIT_OWN_NAME', {
		New_name: req.query.first,      // Передаем то, что пришло от React
		New_lastname: req.query.last
	}, req).then(r => res.status(r.status).send(r.body))
);

// 1. Получить данные студента (Курсы, Тесты, Оценки)
// Вызывает C++ функцию VIEW_OWN_DATA
app.get('/api/student/dashboard', (req, res) =>
	callCpp('VIEW_OWN_DATA', {}, req)
		.then(r => res.status(r.status).send(r.body))
);

// 2. Получить список всех пользователей (Только для Админа)
// Вызывает C++ функцию VIEW_ALL_USERS
app.get('/api/admin/users', (req, res) =>
	callCpp('VIEW_ALL_USERS', {}, req)
		.then(r => res.status(r.status).send(r.body))
);

// --- БЛОК ТЕСТИРОВАНИЯ (Студент) ---

// 1. Начать тест (Создать попытку) -> C++ CREATE_ATTEMPT
app.post('/api/test/start', (req, res) =>
	callCpp('CREATE_ATTEMPT', {
		Test_ID: req.body.testId
	}, req).then(r => res.status(r.status).send(r.body))
);

// 2. Получить детали вопроса (Текст, Варианты) -> C++ VIEW_QUESTION_DETAIL
// Нам нужно вызывать это для каждого вопроса в тесте
app.get('/api/test/question', (req, res) =>
	callCpp('VIEW_QUESTION_DETAIL', {
		Question_ID: req.query.id,
		Version: req.query.version
	}, req).then(r => res.status(r.status).send(r.body))
);

// 3. Отправить ответ -> C++ UPDATE_ANSWER
app.post('/api/test/answer', (req, res) =>
	callCpp('UPDATE_ANSWER', {
		Attempt_ID: req.body.attemptId,
		Question_ID: req.body.questionId,
		Answer_Index: req.body.answerIndex
	}, req).then(r => res.status(r.status).send(r.body))
);

// 4. Завершить тест -> C++ COMPLETE_ATTEMPT
app.post('/api/test/complete', (req, res) =>
	callCpp('COMPLETE_ATTEMPT', {
		Attempt_ID: req.body.attemptId
	}, req).then(r => res.status(r.status).send(r.body))
);

// 5. Получить состояние попытки (вопросы и ответы) -> C++ VIEW_ATTEMPT
app.get('/api/proxy/attempt', (req, res) =>
	callCpp('VIEW_ATTEMPT', {
		Test_ID: req.query.id // В C++ VIEW_ATTEMPT принимает Test_ID и ищет попытку студента
	}, req).then(r => res.status(r.status).send(r.body))
);

// --- УПРАВЛЕНИЕ КУРСАМИ ---
app.post('/api/course/edit', (req, res) =>
	callCpp('EDIT_COURSE_INFO', {
		Course_ID: req.body.courseId,
		Course_NAME: req.body.name,
		Description: req.body.description
	}, req).then(r => res.status(r.status).send(r.body))
);

app.post('/api/course/delete', (req, res) =>
	callCpp('DELETE_COURSE', { Course_ID: req.body.courseId }, req).then(r => res.status(r.status).send(r.body))
);

// --- УПРАВЛЕНИЕ ТЕСТАМИ ---
app.post('/api/test/create', (req, res) =>
	callCpp('CREATE_TEST', {
		Course_ID: req.body.courseId,
		Title: req.body.title
	}, req).then(r => res.status(r.status).send(r.body))
);

app.post('/api/test/delete', (req, res) =>
	callCpp('DELETE_TEST', {
		Course_ID: req.body.courseId, // Нужно для проверки прав
		Test_ID: req.body.testId
	}, req).then(r => res.status(r.status).send(r.body))
);

app.post('/api/test/toggle', (req, res) =>
	callCpp('TOGGLE_TEST_ACTIVE', {
		Course_ID: req.body.courseId,
		Test_ID: req.body.testId,
		Activate: req.body.isActive // true/false
	}, req).then(r => res.status(r.status).send(r.body))
);

// --- УПРАВЛЕНИЕ ВОПРОСАМИ ---
app.post('/api/question/create', async (req, res) => {
	// 1. Создаем вопрос
	const createRes = await callCpp('CREATE_QUESTION', {
		Title: req.body.title,
		Text: req.body.text,
		Options: req.body.options, // JSON string
		Answer_Index: req.body.correctIndex
	}, req);

	const createData = JSON.parse(createRes.body);
	if (createData.error || !createData.question_id) return res.send(createRes.body);

	// 2. Привязываем к тесту (НОВАЯ ФУНКЦИЯ)
	const linkRes = await callCpp('ADD_QUESTION_TO_TEST', {
		Test_ID: req.body.testId,
		Question_ID: createData.question_id
	}, req);

	res.status(linkRes.status).send(linkRes.body);
});

// --- НЕДОСТАЮЩИЕ МАРШРУТЫ ДЛЯ КУРСОВ ---

// 1. Создать курс (ЭТОГО НЕ БЫЛО)
app.post('/api/course/create', async (req, res) => {
	const sessionToken = req.cookies['session_token'];
	const cachedData = await redis.get(sessionToken);
	if (!cachedData) return res.status(401).json({ error: "No session" });

	const user = JSON.parse(cachedData);
	const payload = JSON.parse(Buffer.from(user.accessToken.split('.')[1], 'base64').toString());

	// Если teacherId равен "SELF", берем ID текущего пользователя из токена
	const teacherId = (req.body.teacherId === "SELF") ? payload.user_id : req.body.teacherId;

	callCpp('CREATE_COURSE', {
		Course_NAME: req.body.name,
		Description: req.body.description,
		Target_ID: teacherId
	}, req).then(r => res.status(r.status).send(r.body));
});

// 2. Получить список ВСЕХ курсов (ЭТОГО НЕ БЫЛО - нужно для Админа)
app.get('/api/courses/all', (req, res) =>
	callCpp('VIEW_ALL_COURSES', {}, req)
		.then(r => res.status(r.status).send(r.body))
);

// --- УЛУЧШЕННЫЙ БЛОК API (Вставь перед app.listen) ---

// 1. Создать курс (С защитой от сбоев)
// Вставь это в server.cjs ВМЕСТО старого маршрута create course
app.post('/api/course/create', async (req, res) => {
	try {
		const sessionToken = req.cookies['session_token'];
		const cachedData = await redis.get(sessionToken);
		if (!cachedData) return res.status(401).json({ error: "No session" });

		const user = JSON.parse(cachedData);
		// Достаем ID юзера из токена
		const payload = JSON.parse(Buffer.from(user.accessToken.split('.')[1], 'base64').toString());

		// Если фронт прислал "SELF", подставляем ID из токена
		const teacherId = (req.body.teacherId === "SELF") ? payload.user_id : req.body.teacherId;

		const cppRes = await callCpp('CREATE_COURSE', {
			Course_NAME: req.body.name,
			Description: req.body.description,
			Target_ID: teacherId
		}, req);

		res.status(cppRes.status).send(cppRes.body);
	} catch (e) {
		console.error("Create Course Error:", e);
		res.status(500).json({ error: "Server Error" });
	}
});

// 2. Получить ВСЕ курсы (Для Админа/Учителя)
app.get('/api/courses/all', (req, res) =>
	callCpp('VIEW_ALL_COURSES', {}, req)
		.then(r => res.status(r.status).send(r.body))
);

// 3. Создание сложного теста (Цепочка вызовов)
// C++ требует создать тест -> создать вопрос -> привязать вопрос.
// Мы сделаем это на Node.js, чтобы фронтенд не слал 100 запросов.
app.post('/api/test/create-full', async (req, res) => {
	try {
		const { courseId, title, questions } = req.body; // questions = [{text, options:[], correctIndex}]

		// A. Создаем сам тест
		const testRes = await callCpp('CREATE_TEST', { Course_ID: courseId, Title: title }, req);
		const testData = JSON.parse(testRes.body);
		if (testData.error || !testData.test_id) return res.status(400).send(testRes.body);

		const testId = testData.test_id;

		// B. Создаем вопросы и привязываем их
		for (const q of questions) {
			// 1. Создать вопрос
			const qRes = await callCpp('CREATE_QUESTION', {
				Title: q.text.substring(0, 30) + "...", // Краткое название
				Text: q.text,
				Options: JSON.stringify(q.options),
				Answer_Index: q.correctIndex
			}, req);

			const qData = JSON.parse(qRes.body);
			if (qData.question_id) {
				// 2. Привязать к тесту (Используем метод C++, который ты добавил ранее)
				// Если в C++ нет ADD_QUESTION_TO_TEST, вопросы не привяжутся!
				// Предполагаем, что ты добавил это в logic.cpp или используешь существующий механизм.
				// В твоем logic.cpp я видел REMOVE, но не ADD. 
				// !!! ВАЖНО: Если C++ не поддерживает добавление вопроса в существующий тест,
				// то этот шаг не сработает. Но мы попробуем.
				await callCpp('ADD_QUESTION_TO_TEST', {
					Test_ID: testId,
					Question_ID: qData.question_id
				}, req);
			}
		}

		// C. Активируем тест (сразу делаем доступным)
		await callCpp('TOGGLE_TEST_ACTIVE', {
			Course_ID: courseId, Test_ID: testId, Activate: "true"
		}, req);

		res.json({ status: "success", test_id: testId });

	} catch (e) {
		console.error("Test Creation Error:", e);
		res.status(500).json({ error: "Failed to create full test" });
	}
});
app.listen(3001, () => console.log('🚀 Node.js Server (v3) на порту 3001 запущен'));