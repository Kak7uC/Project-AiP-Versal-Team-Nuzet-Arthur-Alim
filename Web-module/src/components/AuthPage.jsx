import React from 'react';

export default function AuthPage() {
	const startLogin = async (type) => {
		try {
			// 1. Обращаемся к нашему серверу (server.js)
			const response = await fetch(`/api/auth/init?type=${type}`, {
				credentials: 'include'
			});

			const data = await response.json();

			// 2. Уходим на страницу авторизации
			window.location.href = data.url;
		} catch (err) {
			alert("Ошибка подключения к серверу");
		}
	};

	return (
		<div className="page-container">
			<div className="card">
				<h2 style={{ textAlign: 'center', marginBottom: '20px' }}>Вход в систему</h2>

				<button onClick={() => startLogin('github')} className="btn btn-github">
					Войти через GitHub
				</button>

				<button onClick={() => startLogin('yandex')} className="btn btn-yandex">
					Войти через Яндекс
				</button>

				<div style={{ margin: '20px 0', textAlign: 'center', color: '#6b7280' }}>Или по коду</div>

				<input type="text" className="input-field" placeholder="Введите код" />
				<button className="btn btn-primary">Подтвердить код</button>

				<div style={{ marginTop: '20px', textAlign: 'center' }}>
					<a href="https://web.telegram.org/k/#@versal_test_bot" style={{ color: '#4f46e5' }}>Перейти в Telegram</a>
				</div>
			</div>
		</div>
	);
}