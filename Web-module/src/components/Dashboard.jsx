import React, { useState, useEffect } from 'react';
import QuestionView from './QuestionView';
import TestCreator from './TestCreator';

const Dashboard = ({ user, onLogout }) => {
	const [activeTab, setActiveTab] = useState('home');
	const [startedTest, setStartedTest] = useState(null);
	const [editMode, setEditMode] = useState(false);
	const [isCreatingTest, setIsCreatingTest] = useState(null); // null или { courseId, courseName }
	const [testActiveMap, setTestActiveMap] = useState({}); // { [testId]: true/false }
	const [attemptsModal, setAttemptsModal] = useState(null); // null или { testId, testName, data: [] }


	// Состояния для реальных данных
	const [courses, setCourses] = useState([]); // Сюда загрузим курсы из БД
	const [blockedMap, setBlockedMap] = useState({}); // { [userId]: true/false }

	const [userList, setUserList] = useState([]); // Сюда загрузим юзеров (для админа)
	const [newName, setNewName] = useState({ first: '', last: '' });
	const [isLoading, setIsLoading] = useState(false);

	const isAdmin = user?.role === 'Admin';
	const isTeacher = user?.role === 'Teacher';
	// const isStudent = false //user?.role === 'Student' || (!isAdmin && !isTeacher);

	// --- 1. ЕДИНСТВЕННАЯ ФУНКЦИЯ ЗАГРУЗКИ КУРСОВ ---
	const fetchCourses = async () => {
		try {
			// ЛОГИКА:
			// 1. По умолчанию грузим ЛИЧНЫЕ данные (чтобы видеть оценки).
			let endpoint = '/api/student/dashboard';

			// 2. И только если мы Админ/Учитель И сидим на вкладке "Дисциплины" (home),
			// тогда грузим ВСЕ курсы (чтобы можно было их редактировать).
			if (activeTab === 'home' && (isAdmin || isTeacher)) {
				endpoint = '/api/courses/all';
			}

			console.log(`🚀 Загрузка данных... Вкладка: ${activeTab}, Источник: ${endpoint}`);

			const res = await fetch(endpoint);
			if (res.ok) {
				const data = await res.json();

				// Защита от сбоя
				if (data.error) {
					console.error("Ошибка от сервера:", data.error);
					return;
				}

				if (data.courses) {
					setCourses(data.courses);
					if (activeTab === 'home' && (isAdmin || isTeacher)) {
						data.courses.forEach(course => {
							(course.tests || []).forEach(test => {
								const cId = course.course_id || course.id;
								const tId = test.test_id || test.id;
								fetchTestActive(cId, tId);
							});
						});
					}
				} else {
					setCourses([]);
				}
			}
		} catch (e) {
			console.error("Ошибка сети при загрузке:", e);
		}
	};

	// --- ОБНОВЛЕНИЕ ПРИ СМЕНЕ ВКЛАДКИ ---
	useEffect(() => {
		// Грузим данные только если открыты вкладки 'home' или 'results'
		if (activeTab === 'home' || activeTab === 'results') {
			fetchCourses();
		}
	}, [activeTab, isAdmin, isTeacher]);


	// --- 2. ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ
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
						const usersArr = Array.isArray(data) ? data : (data.users || []);
						setUserList(usersArr);

						// Подгружаем статус блокировки для каждого
						const pairs = await Promise.all(usersArr.map(async (u) => {
							try {
								const br = await fetch(`/api/admin/blocked?userId=${encodeURIComponent(u.id)}`);
								if (!br.ok) return [u.id, false];
								const bj = await br.json();
								return [u.id, !!bj.is_blocked];
							} catch {
								return [u.id, false];
							}
						}));

						setBlockedMap(Object.fromEntries(pairs));

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


	// --- СМЕНА РОЛИ (АДМИН) ---
	const handleRoleChange = async (userId, newRole) => {
		if (!confirm(`Вы уверены, что хотите назначить роль ${newRole}?`)) return;
		setIsLoading(true);
		try {
			const res = await fetch('/api/admin/role', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, newRole })
			});
			const data = await res.json();

			if (data.success) {
				alert("Роль успешно изменена!");
				// Обновляем список пользователей
				const uRes = await fetch('/api/admin/users');
				const uData = await uRes.json();
				setUserList(Array.isArray(uData) ? uData : (uData.users || []));
			} else {
				alert("Ошибка: " + (data.error || JSON.stringify(data)));
			}
		} catch (e) {
			alert("Ошибка сети");
		} finally {
			setIsLoading(false);
		}
	};


	const handleToggleBlocked = async (userId, nextBlocked) => {
		if (!confirm(nextBlocked ? "Заблокировать пользователя?" : "Разблокировать пользователя?")) return;

		setIsLoading(true);
		try {
			const res = await fetch('/api/admin/blocked', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, blocked: nextBlocked })
			});

			const text = await res.text();
			if (!res.ok) {
				alert("Ошибка: " + text);
				return;
			}

			// обновляем локально
			setBlockedMap((m) => ({ ...m, [userId]: nextBlocked }));
		} catch (e) {
			alert("Ошибка сети");
		} finally {
			setIsLoading(false);
		}
	};


	// --- ЗАПИСЬ СТУДЕНТА (УЧИТЕЛЬ) ---
	const handleEnrollStudent = async (courseId) => {
		const studentId = prompt("Введите ID студента (например: github_12345):");
		if (!studentId) return;

		setIsLoading(true);
		try {
			const res = await fetch('/api/course/enroll', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ courseId, studentId })
			});
			const data = await res.json();

			if (data.status === 'success') {
				alert("Студент успешно записан!");
			} else {
				alert("Ошибка: " + (data.error || JSON.stringify(data)));
			}
		} catch (e) {
			alert("Ошибка сети");
		} finally {
			setIsLoading(false);
		}
	};


	// --- СОЗДАНИЕ КУРСА ---
	const handleCreateCourse = async () => {
		// 1. Простой способ спросить данные (можно заменить на красивое модальное окно потом)
		const name = prompt("Введите название нового курса:");
		if (!name) return;

		const description = prompt("Введите описание курса:", "Базовый курс");

		setIsLoading(true);
		try {
			const res = await fetch('/api/course/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					description,
					teacherId: "SELF" // Метка для Node.js
				})
			});

			const data = await res.json();

			if (data.status === 'success' || data.course_id) {
				alert(`Курс "${data.course_name}" успешно создан!`);
				// Перезагружаем страницу, чтобы курс появился в списке
				window.location.reload();
			} else {
				alert("Ошибка создания: " + (data.error || JSON.stringify(data)));
			}

		} catch (e) {
			console.error(e);
			alert("Ошибка сети");
		} finally {
			setIsLoading(false);
		}
	};

	// --- ФУНКЦИЯ РЕДАКТИРОВАНИЯ КУРСА ---
	const handleEditCourse = async (courseId, currentName, currentDesc) => {
		const newName = prompt("Новое название курса:", currentName);
		if (newName === null) return;

		const newDesc = prompt("Новое описание:", currentDesc);

		setIsLoading(true);
		try {
			const res = await fetch('/api/course/edit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					courseId: courseId,
					name: newName || currentName,
					description: newDesc !== null ? newDesc : currentDesc
				})
			});

			// Читаем как текст, чтобы не падать на JSON.parse
			const text = await res.text();
			console.log("Ответ сервера при редактировании:", text);

			// Если статус 200 - считаем успехом, даже если JSON кривой
			if (res.ok) {
				alert("Курс обновлен!");
				fetchCourses();
			} else {
				alert("Ошибка сервера: " + text);
			}
		} catch (e) {
			console.error(e);
			alert("Ошибка сети (проверьте консоль)");
		} finally {
			setIsLoading(false);
		}
	};

	const handleDeleteCourse = async (courseId) => {
		if (!confirm("Вы уверены? Курс и все тесты будут удалены.")) return;
		setIsLoading(true);
		try {
			await fetch('/api/course/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ courseId })
			});
			// Обновляем список
			const endpoint = (isAdmin || isTeacher) ? '/api/courses/all' : '/api/student/dashboard';
			const res = await fetch(endpoint);
			const data = await res.json();
			if (data.courses) setCourses(data.courses);
		} catch (e) {
			alert("Ошибка удаления");
		} finally {
			setIsLoading(false);
		}
	};

	const handleEditCourseSave = async (courseId, name, description) => {
		setIsLoading(true);
		try {
			await fetch('/api/course/edit', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ courseId, name, description })
			});
			setEditingCourse(null);
			fetchCourses();
		} catch (e) { alert("Ошибка сохранения"); } finally { setIsLoading(false); }
	};

	// --- ДЕЙСТВИЯ С ТЕСТАМИ ---

	const handleDeleteTest = async (courseId, testId) => {
		if (!confirm("Удалить этот тест?")) return;
		setIsLoading(true);
		try {
			await fetch('/api/test/delete', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ courseId, testId })
			});
			// Обновляем список (просто перезагружаем курсы)
			const endpoint = (isAdmin || isTeacher) ? '/api/courses/all' : '/api/student/dashboard';
			const res = await fetch(endpoint);
			const data = await res.json();
			if (data.courses) setCourses(data.courses);
		} catch (e) {
			alert("Ошибка удаления теста");
		} finally {
			setIsLoading(false);
		}
	};


	const fetchTestActive = async (courseId, testId) => {
		try {
			const res = await fetch(`/api/test/active?courseId=${encodeURIComponent(courseId)}&testId=${encodeURIComponent(testId)}`);
			if (!res.ok) return;
			const data = await res.json();
			setTestActiveMap(m => ({ ...m, [testId]: !!data.is_active }));
		} catch { }
	};

	const toggleTestActive = async (courseId, testId, activate) => {
		setIsLoading(true);
		try {
			const res = await fetch('/api/test/active', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ courseId, testId, activate })
			});
			const text = await res.text();
			if (!res.ok) return alert("Ошибка: " + text);

			// пробуем JSON
			try {
				const data = JSON.parse(text);
				if (typeof data.is_active === "boolean") {
					setTestActiveMap(m => ({ ...m, [testId]: data.is_active }));
				} else {
					// если сервер не вернул is_active — просто обновим через fetch
					fetchTestActive(courseId, testId);
				}
			} catch {
				fetchTestActive(courseId, testId);
			}
		} finally {
			setIsLoading(false);
		}
	};

	const openAttempts = async (testId, testName) => {
		setIsLoading(true);
		try {
			const res = await fetch(`/api/test/attempts?testId=${encodeURIComponent(testId)}`);
			const text = await res.text();
			if (!res.ok) return alert("Ошибка: " + text);

			const data = JSON.parse(text);
			const attempts = data.attempts || [];

			setAttemptsModal({ testId, testName, data: attempts });
		} catch (e) {
			alert("Не удалось загрузить попытки (смотри консоль)");
			console.error(e);
		} finally {
			setIsLoading(false);
		}
	};

	const handleSaveNewTest = async (testData) => {
		setIsLoading(true);
		try {
			const res = await fetch('/api/test/create-full', {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					courseId: isCreatingTest.courseId,
					title: testData.title,
					questions: testData.questions
				})
			});
			const data = await res.json();
			if (data.status === 'success' || data.test_id) {
				alert("Тест создан!");
				setIsCreatingTest(null);
				fetchCourses();
			} else {
				alert("Ошибка: " + JSON.stringify(data));
			}
		} catch (e) { alert("Ошибка сети"); } finally { setIsLoading(false); }
	};

	const handleSaveTest = async (testData) => {
		setIsLoading(true);
		try {
			const res = await fetch('/api/test/create-full', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					courseId: isCreatingTest.courseId,
					title: testData.title,
					questions: testData.questions
				})
			});
			const data = await res.json();

			if (data.status === 'success' || data.test_id) {
				alert("Тест создан!");
				setIsCreatingTest(null);
				// Тут можно вызвать fetchCourses(), если вынесешь его наружу из useEffect
				window.location.reload();
			} else {
				alert("Ошибка: " + JSON.stringify(data));
			}
		} catch (e) {
			alert("Ошибка сети");
		} finally {
			setIsLoading(false);
		}
	};

	// --- ЗАПУСК ТЕСТА (ИСПРАВЛЕННАЯ) ---
	const handleStartTest = async (rawTestId, testName) => {
		// Защита: Убедимся, что ID это строка и без пробелов
		const testId = String(rawTestId).trim();

		console.log("🚀 Попытка запуска теста. ID:", testId); // <--- СМОТРИ СЮДА В КОНСОЛЬ

		if (!testId || testId === "undefined") {
			return alert("Ошибка: Некорректный ID теста. Попробуйте обновить страницу.");
		}

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
				console.error("Ошибка от сервера:", startData);
				alert("Ошибка запуска: " + startData.error);
				return;
			}

			// ... Остальной код получения вопросов без изменений ...
			const attemptId = startData.attempt_id;
			const attemptInfoRes = await fetch(`/api/proxy/attempt?id=${testId}`);
			const attemptInfo = await attemptInfoRes.json();

			if (!attemptInfo.answers) {
				alert("Ошибка: вопросы не загрузились (пустой список)");
				return;
			}

			const questionsWithText = await Promise.all(attemptInfo.answers.map(async (ans) => {
				const qRes = await fetch(`/api/test/question?id=${ans.question_id}&version=1`);
				const qData = await qRes.json();
				return {
					id: ans.question_id,
					text: qData.question_text || "Текст вопроса не найден",
					options: qData.options || [],
					version: "1",
					initialAnswer: ans.answer_index
				};
			}));

			setStartedTest({
				name: testName,
				questions: questionsWithText,
				attemptId: attemptId
			});

		} catch (e) {
			console.error(e);
			alert("Сбой запуска теста (см. консоль)");
		} finally {
			setIsLoading(false);
		}
	};

	// Компонент карточки курса (Адаптирован под данные из БД)
	// Компонент карточки курса (ОБНОВЛЕННЫЙ)
	const CourseCard = ({ course }) => (
		<div style={styles.courseCard}>
			<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
				<span style={{ fontSize: '32px' }}>📚</span>
				{(isAdmin || isTeacher) && (
					<div style={{ display: 'flex', gap: '8px' }}>
						{/* Кнопка РЕДАКТИРОВАТЬ (пока просто алерт, или сделай prompt как для создания) */}
						<button
							title="Редактировать курс"
							style={styles.iconBtn}
							onClick={() => handleEditCourse(
								course.course_id || course.id,
								course.course_name || course.name,
								course.description
							)}
						>
							✏️
						</button>

						{/* Кнопка УДАЛИТЬ КУРС (Новая) */}
						<button
							title="Удалить курс"
							style={{ ...styles.iconBtn, backgroundColor: '#fee2e2', color: 'red' }}
							onClick={() => handleDeleteCourse(course.course_id || course.id)}
						>🗑️</button>
					</div>
				)}
			</div>

			<h4 style={styles.courseTitle}>{course.course_name || course.name || "Без названия"}</h4>
			<p style={styles.courseDesc}>{course.description || "Нет описания"}</p>

			<div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
				{/* Список тестов */}
				{course.tests && course.tests.length > 0 ? (
					course.tests.map(test => {
						const testId = test.test_id || test.id;
						const courseId = course.course_id || course.id;

						return (
							<div key={testId} style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
								{/* Запуск */}
								<button
									style={{ ...styles.primaryBtn, marginBottom: 0 }}
									onClick={() => handleStartTest(testId, test.test_title || test.title)}
								>
									📝 {test.test_title || test.title || "Тест"}
								</button>

								{(isAdmin || isTeacher) && (
									<>
										{/* ON/OFF */}
										<button
											title="Включить/выключить тест"
											style={{
												width: '54px',
												border: 'none',
												borderRadius: '8px',
												cursor: 'pointer',
												fontWeight: 'bold',
												backgroundColor: testActiveMap[testId] ? '#d1fae5' : '#f3f4f6'
											}}
											onClick={() => {
												const cur = !!testActiveMap[testId];
												toggleTestActive(courseId, testId, !cur);
											}}
										>
											{testActiveMap[testId] ? "ON" : "OFF"}
										</button>

										{/* Attempts */}
										<button
											title="Посмотреть попытки"
											style={{
												width: '42px',
												border: 'none',
												borderRadius: '8px',
												cursor: 'pointer',
												fontWeight: 'bold',
												backgroundColor: '#e0e7ff'
											}}
											onClick={() => openAttempts(testId, test.test_title || test.title)}
										>
											👥
										</button>

										{/* Удалить тест */}
										<button
											style={{
												width: '40px',
												backgroundColor: '#fee2e2',
												color: 'red',
												border: 'none',
												borderRadius: '8px',
												cursor: 'pointer',
												fontWeight: 'bold'
											}}
											onClick={() => handleDeleteTest(courseId, testId)}
											title="Удалить тест"
										>
											✕
										</button>
									</>
								)}
							</div>
						);
					})

				) : (
					<div style={{ color: '#999', fontSize: '13px', fontStyle: 'italic' }}>Нет тестов</div>
				)}

				{/* Кнопка добавления теста */}
				{(isTeacher || isAdmin) && (
					<button
						style={{ ...styles.outlineBtn, marginTop: '10px', width: '100%' }}
						onClick={() => setIsCreatingTest({
							courseId: course.course_id || course.id,
							courseName: course.course_name || course.name
						})}
					>
						+ Добавить тест
					</button>
				)}

				{/* КНОПКА ЗАПИСАТЬ СТУДЕНТА (Только для учителя/админа) */}
				{(isTeacher || isAdmin) && (
					<button
						style={{ ...styles.outlineBtn, marginTop: '5px', borderColor: '#10b981', color: '#10b981' }}
						onClick={() => handleEnrollStudent(course.course_id || course.id)}
					>
						+ Записать студента
					</button>
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
	// --- ЗАВЕРШЕНИЕ ТЕСТА (С ДЕТАЛЬНЫМ ОТЧЕТОМ ОБ ОШИБКЕ) ---
	const handleFinishTest = async (answers) => {
		setIsLoading(true);
		try {
			// 1. Отправляем ответы
			// (Используем Promise.allSettled, чтобы один сбой не ломал всё)
			await Promise.allSettled(Object.entries(answers).map(([qId, idx]) =>
				fetch('/api/test/answer', {
					method: 'POST',
					body: JSON.stringify({ attemptId: startedTest.attemptId, questionId: qId, answerIndex: idx }),
					headers: { 'Content-Type': 'application/json' }
				})
			));

			// 2. Завершаем
			const res = await fetch('/api/test/complete', {
				method: 'POST',
				body: JSON.stringify({ attemptId: startedTest.attemptId }),
				headers: { 'Content-Type': 'application/json' }
			});

			const text = await res.text(); // Сначала читаем как текст
			console.log("Ответ сервера (Complete):", text);

			let data;
			try {
				data = JSON.parse(text); // Пробуем превратить в JSON
			} catch (e) {
				throw new Error("Сервер вернул не JSON: " + text);
			}

			if (data.status === 'success') {
				alert(`🎉 Тест завершен!\nРезультат: ${data.score} из ${data.max_score || '?'}`);
				setStartedTest(null);
				fetchCourses(); // Обновляем историю
			} else {
				alert("Ошибка при завершении: " + (data.error || text));
			}

		} catch (e) {
			console.error(e);
			alert("Критическая ошибка сохранения: " + e.message);
		} finally {
			setIsLoading(false);
		}
	};
	return (
		<div style={styles.container}>
			{attemptsModal && (
				<div style={{
					position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
					display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
				}}>
					<div style={{
						width: '700px', maxWidth: '92vw', maxHeight: '80vh', overflow: 'auto',
						background: 'white', borderRadius: '16px', padding: '20px', border: '1px solid #e5e7eb'
					}}>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
							<h3 style={{ margin: 0 }}>
								Попытки: {attemptsModal.testName}
							</h3>
							<button
								onClick={() => setAttemptsModal(null)}
								style={{ border: 'none', background: '#f3f4f6', borderRadius: '10px', padding: '8px 12px', cursor: 'pointer' }}
							>
								Закрыть
							</button>
						</div>

						<div style={{ marginTop: '14px' }}>
							{attemptsModal.data.length === 0 ? (
								<p style={{ color: '#666' }}>Попыток пока нет.</p>
							) : (
								<table style={{ width: '100%', borderCollapse: 'collapse' }}>
									<thead>
										<tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
											<th style={{ padding: '10px' }}>Student ID</th>
											<th style={{ padding: '10px' }}>Score</th>
											<th style={{ padding: '10px' }}>%</th>
											<th style={{ padding: '10px' }}>Status</th>
										</tr>
									</thead>
									<tbody>
										{attemptsModal.data.map((a, idx) => (
											<tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
												<td style={{ padding: '10px', fontSize: '13px' }}>{a.student_id}</td>
												<td style={{ padding: '10px' }}>
													{a.score ?? "-"} / {a.max_score ?? "-"}
												</td>
												<td style={{ padding: '10px' }}>{a.percentage ?? "-"}</td>
												<td style={{ padding: '10px' }}>{a.status}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</div>
				</div>
			)}

			{startedTest && (
				<QuestionView
					testName={startedTest.name}
					questions={startedTest.questions}
					onFinish={(answers) => handleFinishTest(answers)}
					onCancel={() => setStartedTest(null)}
				/>
			)}

			{isCreatingTest && (
				<TestCreator
					courseName={isCreatingTest.courseName}
					onSave={handleSaveTest}
					onCancel={() => setIsCreatingTest(null)}
				/>
			)}

			<aside style={styles.sidebar}>
				<div style={styles.logo}>
					<span style={styles.logoIcon}>⚡</span> Versal Test
				</div>

				<nav style={{ flex: 1 }}>
					<NavItem id="home" label="Дисциплины" icon="🏠" />
					<div onClick={() => setActiveTab('results')} style={{
						...styles.navItem,
						backgroundColor: activeTab === 'results' ? '#f3f4f6' : 'transparent',
						color: activeTab === 'results' ? '#4f46e5' : '#4b5563',
					}}>
						<span style={{ marginRight: '12px' }}>📊</span> История оценок
					</div>
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
							{activeTab === 'results' && "Моя успеваемость"}
							{activeTab === 'profile' && "Настройки профиля"}
							{activeTab === 'users' && "Управление пользователями"}
						</h2>
						<p style={styles.userInfo}>
							Роль: <b>{user?.role}</b> | Студент <b>{user?.fullName}</b>
						</p>
					</div>
					{/* ВСТАВИТЬ СЮДА: Кнопка создания курса (видна только учителю/админу) */}
					{activeTab === 'home' && (isTeacher || isAdmin) && (
						<button style={styles.addBtn} onClick={handleCreateCourse}>
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

					{/* --- ИСТОРИЯ ОЦЕНОК (НОВЫЙ БЛОК) --- */}
					{activeTab === 'results' && (
						<div style={styles.grid}>
							{courses.length === 0 ? (
								<div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#888' }}>
									<p>Загрузка данных или история пуста...</p>
								</div>
							) : (
								courses.map(course => (
									<div key={course.course_id || course.id} style={styles.card}>
										<div style={{ borderBottom: '1px solid #eee', paddingBottom: '10px', marginBottom: '15px' }}>
											<h3 style={{ margin: 0, color: '#111827' }}>{course.course_name || course.name}</h3>
										</div>

										{course.grades && course.grades.length > 0 ? (
											<div style={{ display: 'flex', flexDirection: 'column' }}>
												{course.grades.map((g, idx) => (
													<div key={idx} style={styles.resultItem}>
														<div>
															<div style={{ fontWeight: '600', color: '#374151' }}>{g.test_title}</div>
														</div>
														<div style={{ textAlign: 'right' }}>
															<div style={styles.scoreBadge(g.percentage)}>
																{g.score} / {g.max_score}
															</div>
															<div style={styles.dateText}>
																{g.percentage}%
															</div>
														</div>
													</div>
												))}
											</div>
										) : (
											<p style={{ color: '#9ca3af', fontStyle: 'italic', textAlign: 'center', margin: '20px 0' }}>
												Нет попыток прохождения тестов.
											</p>
										)}
									</div>
								))
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
					{/* Вкладка ПОЛЬЗОВАТЕЛЕЙ (Таблица) */}
					{activeTab === 'users' && isAdmin && (
						<div style={styles.card}>
							<h3 style={{ marginTop: 0 }}>Управление пользователями</h3>
							<table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
								<thead>
									<tr style={{ borderBottom: '2px solid #eee', textAlign: 'left' }}>
										<th style={{ padding: '10px' }}>ID / Логин</th>
										<th style={{ padding: '10px' }}>Имя</th>
										<th style={{ padding: '10px' }}>Роль</th>
										<th style={{ padding: '10px' }}>Действия</th>
										<th style={{ padding: '10px' }}>Блок</th>

									</tr>
								</thead>
								<tbody>
									{userList.map(u => (
										<tr key={u.id} style={{ borderBottom: '1px solid #eee' }}>
											<td style={{ padding: '10px', fontSize: '13px', color: '#555' }}>
												{u.id}<br />
												<b>{u.login}</b>
											</td>
											<td style={{ padding: '10px' }}>
												{u.first_name} {u.last_name}
											</td>
											<td style={{ padding: '10px' }}>
												<span style={{
													backgroundColor: u.role === 'Admin' ? '#fee2e2' : u.role === 'Teacher' ? '#e0e7ff' : '#f3f4f6',
													color: u.role === 'Admin' ? '#dc2626' : u.role === 'Teacher' ? '#4f46e5' : '#374151',
													padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold'
												}}>
													{u.role}
												</span>
											</td>
											<td style={{ padding: '10px' }}>
												{(() => {
													const isBlocked = !!blockedMap[u.id];
													return (
														<button
															disabled={isLoading}
															onClick={() => handleToggleBlocked(u.id, !isBlocked)}
															style={{
																padding: '6px 10px',
																borderRadius: '8px',
																border: '1px solid #ddd',
																cursor: 'pointer',
																backgroundColor: isBlocked ? '#dc2626' : '#f3f4f6',
																color: isBlocked ? 'white' : '#111827',
																fontWeight: 700
															}}
															title={isBlocked ? "Разблокировать" : "Заблокировать"}
														>
															{isBlocked ? "Разблокировать" : "Заблокировать"}
														</button>
													);
												})()}
											</td>

											<td style={{ padding: '10px' }}>
												<select
													defaultValue=""
													onChange={(e) => {
														if (e.target.value) handleRoleChange(u.id, e.target.value);
														e.target.value = ""; // Сброс селекта
													}}
													style={{ padding: '5px', borderRadius: '4px', border: '1px solid #ddd' }}
												>
													<option value="" disabled>Сменить роль...</option>
													<option value="Student">Студент</option>
													<option value="Teacher">Учитель</option>
													<option value="Admin">Админ</option>
												</select>
											</td>
										</tr>
									))}
								</tbody>
							</table>
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
	resultItem: {
		padding: '16px',
		backgroundColor: '#f8fafc',
		borderRadius: '10px',
		border: '1px solid #e2e8f0',
		marginBottom: '10px',
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		transition: 'transform 0.2s',
	},

	scoreBadge: (percent) => ({
		fontWeight: 'bold',
		color: percent >= 50 ? '#059669' : '#dc2626', // Зеленый если >50%, красный если меньше
		backgroundColor: percent >= 50 ? '#d1fae5' : '#fee2e2',
		padding: '6px 12px',
		borderRadius: '20px',
		fontSize: '14px'
	}),

	dateText: {
		fontSize: '12px',
		color: '#64748b',
		marginTop: '4px',
		textAlign: 'right'
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