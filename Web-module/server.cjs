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

				if (authResult.status === 'granted') {
					// Формируем данные авторизованного пользователя
					const authorizedData = {
						status: 'Authorized',
						userName: user,
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
            <body style="background-color: #1a1a1a; color: #fff; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh;">
                <div style="text-align: center;">
                    <h1>Успешно!</h1>
                    <p>Добро пожаловать, ${user}</p>
                    <p>Заходим в личный кабинет...</p>
                </div>
                <script>
                    setTimeout(() => { window.location.href = '/'; }, 1000);
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

app.listen(3001, () => console.log('🚀 Node.js Server (v3) на порту 3001 запущен'));