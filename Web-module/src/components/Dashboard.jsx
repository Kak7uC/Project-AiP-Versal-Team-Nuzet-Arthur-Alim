import React, { useState, useEffect } from 'react';
import QuestionView from './QuestionView';

const Dashboard = ({ user, onLogout }) => {
	const [activeTab, setActiveTab] = useState('home');
	const [startedTest, setStartedTest] = useState(null);
	const [editMode, setEditMode] = useState(false);

	// Состояния для реальных данных
	const [courses, setCourses] = useState([]); // Сюда загрузим курсы из БД
	const [userList, setUserList] = useState([]); // Сюда загрузим юзеров (для админа)
	const [newName, setNewName] = useState({ first: '', last: '' });
	const [isLoading, setIsLoading] = useState(false);

	const isAdmin = true //user?.role === 'Admin';
	const isTeacher = true //user?.role === 'Teacher';
	const isStudent = false  //user?.role === 'Student' || (!isAdmin && !isTeacher); НУЖНО БУДЕТ ПОТОМ ИСПРАВИТЬ!!!!!!!!!

	// --- 1. ЗАГРУЗКА КУРСОВ (При открытии вкладки "home") ---
	useEffect(() => {
		if (activeTab === 'home') {
			const fetchCourses = async () => {
				try {
					const res = await fetch('/api/student/dashboard');
					if (res.ok) {
						const data = await res.json();
						console.log("📦 Данные курсов из БД:", data);
						// C++ возвращает структуру { user_id: "...", courses: [...] }
						if (data.courses) setCourses(data.courses);
					}
				} catch (e) {
					console.error("Ошибка загрузки курсов:", e);
				}
			};
			fetchCourses();
		}
	}, [activeTab]);

	// --- 2. ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ (При открытии вкладки "users") ---
	useEffect(() => {
		if (activeTab === 'users' && isAdmin) {
			const fetchUsers = async () => {
				try {
					const res = await fetch('/api/admin/users');
					if (res.ok) {
						const data = await res.json();
						console.log("📦 Данные курсов из БД:", data);
						// Предполагаем, что C++ вернет массив или объект с массивом
						// Адаптируй этот момент, если формат C++ отличается
						setUserList(Array.isArray(data) ? data : (data.users || []));
					}
				} catch (e) {
					console.error("Ошибка загрузки пользователей:", e);
				}
			};
			fetchUsers();
		}
	}, [activeTab, isAdmin]);

	// --- 3. КНОПКА "СОХРАНИТЬ" (Смена имени) ---
	const handleUpdateName = async () => {
		// Простая валидация
		if (!newName.first && !newName.last) return;

		try {
			// Формируем запрос
			// encodeURIComponent обязателен для кириллицы
			const res = await fetch(`/api/user/update-name?first=${encodeURIComponent(newName.first)}&last=${encodeURIComponent(newName.last)}`);
			const text = await res.text();

			// Проверяем ответ C++ (он обычно возвращает "SUCCESS..." или "ERROR...")
			if (text.includes("SUCCESS") || !text.includes("ERROR")) {
				alert("Данные обновлены: " + text);
				setEditMode(false);
				window.location.reload(); // Перезагружаем, чтобы в шапке обновилось имя
			} else {
				alert("Ошибка обновления: " + text);
			}
		} catch (err) {
			console.error(err);
			alert("Ошибка сети");
		}
	};

	// Заменяем старую функцию-заглушку на реальную
	const handleStartTest = async (testId, testName) => {
		setIsLoading(true);
		try {
			// 1. Создаем попытку в БД
			const startRes = await fetch('/api/test/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ testId })
			});
			const startData = await startRes.json();

			if (startData.error) {
				alert("Ошибка старта: " + startData.error);
				return;
			}

			const attemptId = startData.attempt_id;

			// 2. Нам нужно получить список вопросов для этой попытки.
			// В твоем C++ есть VIEW_ATTEMPT, который возвращает { answers: [ {question_id, ...} ] }
			// Используем прямой вызов через прокси (так как отдельный роут мы не делали, используем универсальный подход если есть, или добавим)
			// ПРИМЕЧАНИЕ: Я использую callCpp через GET запрос вручную, так как в server.cjs мы не добавили route для VIEW_ATTEMPT
			// Давай добавим роут VIEW_ATTEMPT в server.cjs следующим шагом, а пока код фронта:

			const attemptInfoRes = await fetch(`/api/proxy/attempt?id=${testId}`); // Мы сейчас добавим этот роут
			const attemptInfo = await attemptInfoRes.json();

			if (!attemptInfo.answers) {
				alert("Ошибка: не удалось получить вопросы теста");
				return;
			}

			// 3. Скачиваем тексты вопросов (так как VIEW_ATTEMPT возвращает только ID)
			const questionsWithText = await Promise.all(attemptInfo.answers.map(async (ans) => {
				// ans.question_id
				// По умолчанию версия 1, если API не возвращает версию
				const qRes = await fetch(`/api/test/question?id=${ans.question_id}&version=1`);
				const qData = await qRes.json();

				return {
					id: ans.question_id,
					text: qData.question_text || "Текст не загружен",
					options: qData.options || [],
					version: "1",
					initialAnswer: ans.answer_index // Если мы продолжили старый тест
				};
			}));

			// Запускаем интерфейс теста
			setStartedTest({
				name: testName,
				questions: questionsWithText,
				attemptId: attemptId
			});

		} catch (e) {
			console.error(e);
			alert("Ошибка при запуске теста. Проверьте консоль.");
		} finally {
			setIsLoading(false);
		}
	};

	// Компонент карточки курса (Адаптирован под данные из БД)
	const CourseCard = ({ course }) => (
		<div style={styles.courseCard}>
			{/* ВСТАВИТЬ СЮДА: Кнопка добавления теста */}
			{(isTeacher || isAdmin) && (
				<button
					style={{ ...styles.outlineBtn, marginTop: '10px', width: '100%' }}
					onClick={() => alert("Скоро: Создание теста")}
				>
					+ Добавить тест
				</button>
			)}
			<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
				<span style={{ fontSize: '32px' }}>📚</span>
				{(isAdmin || isTeacher) && (
					<div style={{ display: 'flex', gap: '8px' }}>
						<button title="Редактировать" style={styles.iconBtn}>✏️</button>
					</div>
				)}
			</div>
			{/* В C++ поле называется course_name, а не name */}
			<h4 style={styles.courseTitle}>{course.course_name || course.name}</h4>
			<p style={styles.courseDesc}>{course.description || "Нет описания"}</p>

			<div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
				{/* Если пришли тесты из БД */}
				{course.tests && course.tests.length > 0 ? (
					course.tests.map(test => (
						<button
							key={test.test_id}
							style={styles.primaryBtn}
							onClick={() => handleStartTest(test.test_id, test.test_title)}
						>
							Тест: {test.test_title}
						</button>
					))
				) : (
					<div style={{ color: '#999', fontSize: '13px' }}>Нет доступных тестов</div>
				)}
			</div>
		</div>
	);

	const NavItem = ({ id, label, icon }) => (
		<div
			onClick={() => setActiveTab(id)}
			style={{
				...styles.navItem,
				backgroundColor: activeTab === id ? '#f3f4f6' : 'transparent',
				color: activeTab === id ? '#4f46e5' : '#4b5563',
			}}
		>
			<span style={{ marginRight: '12px' }}>{icon}</span>
			{label}
		</div>
	);
	const handleFinishTest = async (userAnswers) => {
		if (!startedTest) return;

		setIsLoading(true);
		const attemptId = startedTest.attemptId;

		try {
			// 1. Отправляем все ответы
			// userAnswers это объект { [questionId]: answerIndex }
			const promises = Object.entries(userAnswers).map(([qId, ansIdx]) => {
				return fetch('/api/test/answer', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						attemptId: attemptId,
						questionId: qId,
						answerIndex: ansIdx
					})
				});
			});

			await Promise.all(promises);

			// 2. Завершаем попытку
			await fetch('/api/test/complete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ attemptId })
			});

			alert("Тест завершен!");
			setStartedTest(null);

			// 3. Обновляем данные на странице (чтобы оценка появилась)
			// Трюк: переключаем вкладку туда-сюда или вызываем fetchCourses (если вынесем его)
			// Самый простой способ без рефакторинга - релоад, но лучше просто закрыть тест.
			window.location.reload();

		} catch (e) {
			console.error(e);
			alert("Ошибка при сохранении ответов");
		} finally {
			setIsLoading(false);
		}
	};
	return (
		<div style={styles.container}>
			{startedTest && (
				<QuestionView
					testName={startedTest.name}
					questions={startedTest.questions}
					onFinish={(answers) => handleFinishTest(answers)}
					onCancel={() => setStartedTest(null)}
				/>
			)}

			<aside style={styles.sidebar}>
				<div style={styles.logo}>
					<span style={styles.logoIcon}>⚡</span> Versal Test
				</div>

				<nav style={{ flex: 1 }}>
					<NavItem id="home" label="Дисциплины" icon="🏠" />
					<NavItem id="profile" label="Профиль" icon="👤" />

					{isAdmin && (
						<>
							<div style={styles.navDivider}>Админ-панель</div>
							<NavItem id="users" label="Пользователи" icon="🔑" />
						</>
					)}
				</nav>

				<div style={styles.logoutSection}>
					<button onClick={() => onLogout(true)} style={styles.allLogoutBtn}>
						Выйти везде
					</button>
					<button onClick={() => onLogout(false)} style={styles.logoutBtn}>
						Выйти
					</button>
				</div>
			</aside>

			<main style={styles.mainContent}>
				<header style={styles.header}>
					<div>
						<h2 style={styles.pageTitle}>
							{activeTab === 'home' && "Мои дисциплины"}
							{activeTab === 'profile' && "Настройки профиля"}
							{activeTab === 'users' && "Управление пользователями"}
						</h2>
						<p style={styles.userInfo}>
							Роль: <b>{user?.role}</b> | Студент <b>{user?.fullName}</b>
						</p>
					</div>
					{/* ВСТАВИТЬ СЮДА: Кнопка создания курса (видна только учителю/админу) */}
					{activeTab === 'home' && (isTeacher || isAdmin) && (
						<button style={styles.addBtn} onClick={() => alert("Скоро: Создание курса")}>
							+ Создать курс
						</button>
					)}
				</header>

				<section style={styles.contentArea}>
					{/* ВКЛАДКА КУРСОВ */}
					{activeTab === 'home' && (
						<div style={styles.grid}>
							{courses.length > 0 ? (
								courses.map((course, idx) => <CourseCard key={course.course_id || idx} course={course} />)
							) : (
								<p>Курсы не найдены или загрузка...</p>
							)}
						</div>
					)}

					{/* ВКЛАДКА ПРОФИЛЯ */}
					{activeTab === 'profile' && (
						<div style={styles.card}>
							<h3>Ваш профиль</h3>
							{!editMode ? (
								<>
									<p>ФИО: <strong>{user?.fullName}</strong></p>
									<button style={styles.outlineBtn} onClick={() => setEditMode(true)}>
										Изменить ФИО
									</button>
								</>
							) : (
								<div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '300px' }}>
									<input
										type="text"
										placeholder="Имя"
										style={{ padding: '8px' }}
										value={newName.first}
										onChange={(e) => setNewName({ ...newName, first: e.target.value })}
									/>
									<input
										type="text"
										placeholder="Фамилия"
										style={{ padding: '8px' }}
										value={newName.last}
										onChange={(e) => setNewName({ ...newName, last: e.target.value })}
									/>
									<div style={{ display: 'flex', gap: '10px' }}>
										<button style={styles.addBtn} onClick={handleUpdateName} disabled={isLoading}>
											{isLoading ? '...' : 'Сохранить'}
										</button>
										<button style={styles.secondaryBtn} onClick={() => setEditMode(false)}>Отмена</button>
									</div>
								</div>
							)}
						</div>
					)}

					{/* ВКЛАДКА ПОЛЬЗОВАТЕЛЕЙ (АДМИН) */}
					{activeTab === 'users' && isAdmin && (
						<div style={styles.card}>
							<h3>Список пользователей (из БД)</h3>
							{userList.length > 0 ? (
								<table style={{ width: '100%', borderCollapse: 'collapse' }}>
									<thead>
										<tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
											<th style={{ padding: '10px' }}>ID</th>
											<th style={{ padding: '10px' }}>Инфо</th>
										</tr>
									</thead>
									<tbody>
										{/* Тут рендерим сырой JSON или разбираем структуру, если знаем формат */}
										{/* Для теста просто выводим JSON строки, так как я не вижу точного формата вывода C++ для VIEW_ALL_USERS */}
										<tr>
											<td colSpan="2">
												<pre style={{ background: '#f4f4f4', padding: '10px', borderRadius: '5px' }}>
													{JSON.stringify(userList, null, 2)}
												</pre>
											</td>
										</tr>
									</tbody>
								</table>
							) : (
								<p>Загрузка списка пользователей...</p>
							)}
						</div>
					)}
				</section>
			</main>
		</div>
	);
};

// Стили оставляем те же, я добавил только пару мелочей, они подтянутся из старого файла если ты их не удалял
const styles = {
	container: { display: 'flex', height: '100vh', backgroundColor: '#f9fafb', fontFamily: 'sans-serif' },
	sidebar: {
		width: '260px', backgroundColor: '#fff', borderRight: '1px solid #e5e7eb',
		display: 'flex', flexDirection: 'column', padding: '24px 16px'
	},
	logo: { fontSize: '20px', fontWeight: '800', color: '#4f46e5', marginBottom: '32px', display: 'flex', alignItems: 'center' },
	logoIcon: {
		backgroundColor: '#4f46e5', color: 'white', width: '32px', height: '32px',
		display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '8px', marginRight: '10px'
	},
	navItem: {
		display: 'flex', alignItems: 'center', padding: '12px', borderRadius: '8px',
		cursor: 'pointer', fontWeight: '600', marginBottom: '4px', transition: '0.2s'
	},
	navDivider: { fontSize: '11px', textTransform: 'uppercase', color: '#9ca3af', margin: '20px 12px 10px', fontWeight: '700' },
	mainContent: { flex: 1, overflowY: 'auto', padding: '32px 48px' },
	header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' },
	pageTitle: { fontSize: '28px', fontWeight: '800', margin: 0 },
	userInfo: { color: '#6b7280', marginTop: '5px', fontSize: '14px' },
	grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '24px' },
	courseCard: {
		backgroundColor: 'white', padding: '24px', borderRadius: '16px',
		border: '1px solid #e5e7eb', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column'
	},
	courseTitle: { fontSize: '18px', fontWeight: '700', margin: '0 0 10px 0' },
	courseDesc: { fontSize: '14px', color: '#4b5563', marginBottom: '20px' },
	primaryBtn: {
		backgroundColor: '#4f46e5', color: 'white', border: 'none',
		padding: '10px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', marginTop: '5px', width: '100%'
	},
	secondaryBtn: {
		backgroundColor: '#fff', color: '#ef4444', border: '1px solid #fee2e2',
		padding: '8px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600'
	},
	outlineBtn: {
		backgroundColor: '#fff', color: '#4b5563', border: '1px solid #d1d5db',
		padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600'
	},
	addBtn: {
		backgroundColor: '#10b981', color: 'white', border: 'none',
		padding: '12px 24px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer'
	},
	logoutSection: { borderTop: '1px solid #e5e7eb', paddingTop: '16px' },
	logoutBtn: {
		width: '100%', padding: '12px', backgroundColor: '#fef2f2', color: '#dc2626',
		border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', marginTop: '8px'
	},
	allLogoutBtn: {
		width: '100%', padding: '12px', backgroundColor: '#111827', color: 'white',
		border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer'
	},
	card: { backgroundColor: 'white', padding: '30px', borderRadius: '16px', border: '1px solid #e5e7eb' },
	iconBtn: { background: '#f3f4f6', border: 'none', borderRadius: '4px', cursor: 'pointer', padding: '6px' },
};

export default Dashboard;