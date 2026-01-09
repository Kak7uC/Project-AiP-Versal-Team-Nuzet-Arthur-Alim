const express = require('express');
const { createClient } = require('redis');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cookieParser());

const redis = createClient({ url: 'redis://localhost:6379' });
redis.connect().then(() => console.log('✅ Web Client подключен к Redis'));

// Инициализация входа
app.get('/api/auth/init', async (req, res) => {
	const { type } = req.query;
	const sessionToken = uuidv4();
	const loginToken = uuidv4();

	// Сохраняем данные в Redis
	await redis.set(sessionToken, JSON.stringify({
		status: 'Anonymous',
		loginToken: loginToken
	}), { EX: 600 });

	res.cookie('session_token', sessionToken, { httpOnly: true });

	let authUrl = "";
	if (type === 'github') {
		authUrl = `https://github.com/login/oauth/authorize?client_id=Ov23liUMaPN9HYOlJgG5&redirect_uri=http://localhost:8080/oauth/github&scope=user&state=${loginToken}`;
	} else {
		authUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=f085c61ba55c469aa0ea68b85f873e4e&state=${loginToken}`;
	}

	console.log(`🆕 Создана сессия: ${sessionToken}, ждем state: ${loginToken}`);
	res.json({ url: authUrl });
});

// ТОТ САМЫЙ ЭНДПОИНТ, КОТОРЫЙ ВЫЗЫВАЕТ GO
app.get('/api/auth/confirm', async (req, res) => {
	const { state, user } = req.query;
	console.log(`📞 Получен сигнал от Go! Ищем state: ${state}`);

	const keys = await redis.keys('*');
	let found = false;

	for (const key of keys) {
		const val = await redis.get(key);
		try {
			const data = JSON.parse(val);
			if (data.loginToken === state) {
				// ОБНОВЛЯЕМ СТАТУС В REDIS
				await redis.set(key, JSON.stringify({
					status: 'Authorized',
					userName: user
				}), { EX: 3600 });
				console.log(`✅ Статус сессии ${key} изменен на Authorized для ${user}`);
				found = true;
				break;
			}
		} catch (e) { continue; }
	}

	if (!found) console.log(`❌ Сессия со state ${state} не найдена!`);
	res.send('OK');
});

// Проверка статуса для React
app.get('/api/auth/status', async (req, res) => {
	const sessionToken = req.cookies['session_token'];
	if (!sessionToken) return res.json({ status: 'Unknown' });
	const data = await redis.get(sessionToken);
	res.json(data ? JSON.parse(data) : { status: 'Unknown' });
});

// ===== LOGOUT =====
app.post('/api/auth/logout', async (req, res) => {
	const sessionToken = req.cookies['session_token'];

	if (sessionToken) {
		await redis.del(sessionToken);
	}

	res.clearCookie('session_token', {
		httpOnly: true,
		sameSite: 'lax'
	});

	res.json({ status: 'LoggedOut' });
});


app.listen(3001, () => console.log('🚀 Сервер на порту 3001 запущен'));