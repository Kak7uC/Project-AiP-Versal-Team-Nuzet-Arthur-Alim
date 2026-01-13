import React, { useState } from 'react';
import QuestionView from './QuestionView';

const Dashboard = ({ user, courses, onLogout }) => {
	// 1. Состояния (States)
	const [activeTab, setActiveTab] = useState('home');
	const [startedTest, setStartedTest] = useState(null);

	// 2. Логика запуска теста (ВСТАВЛЯЕМ СЮДА)
	const handleStartTest = (course) => {
		// Имитируем получение вопросов из базы для этого курса
		const mockQuestions = [
			{ id: 101, text: "Что такое Redis?", version: "1.0", options: ["База данных в памяти", "Язык программирования", "Фреймворк"] },
			{ id: 102, text: "Для чего нужен Nginx?", version: "1.2", options: ["Для стилей", "Для проксирования запросов", "Для написания кода"] },
			{ id: 103, text: "Что такое JWT?", version: "2.1", options: ["Тип файла", "Токен безопасности", "Название модуля"] }
		];

		setStartedTest({
			name: course.name,
			questions: mockQuestions
		});
	};

	// Определяем роль (для логики отображения)
	const isAdmin = user?.role === 'Admin';
	const isTeacher = user?.role === 'Teacher' || isAdmin;

	// Вспомогательный компонент для карточки курса
	const CourseCard = ({ course }) => (
		<div style={styles.courseCard}>
			<div style={styles.courseIcon}>📚</div>
			<h4 style={styles.courseTitle}>{course.name}</h4>
			<p style={styles.courseDesc}>{course.description}</p>
			{/* Кнопка теперь вызывает функцию handleStartTest */}
			<button style={styles.primaryBtn} onClick={() => handleStartTest(course)}>
				Начать тест
			</button>
		</div>
	);

	// Вспомогательный компонент для Sidebar
	const NavItem = ({ id, label, icon, color = '#4b5563' }) => (
		<div
			onClick={() => setActiveTab(id)}
			style={{
				...styles.navItem,
				backgroundColor: activeTab === id ? '#f3f4f6' : 'transparent',
				color: activeTab === id ? '#4f46e5' : color,
			}}
		>
			<span style={{ marginRight: '12px' }}>{icon}</span>
			{label}
		</div>
	);

	return (
		<div style={styles.container}>

			{/* 3. ЛОГИКА ОТОБРАЖЕНИЯ ТЕСТА (Если startedTest не пустой) */}
			{startedTest && (
				<QuestionView
					testName={startedTest.name}
					questions={startedTest.questions}
					onFinish={(results) => {
						console.log("Результаты отправлены на сервер:", results);
						setStartedTest(null); // Закрываем тест
						alert("Поздравляем! Вы прошли тест.");
					}}
					onCancel={() => setStartedTest(null)} // Кнопка "Прервать"
				/>
			)}

			{/* --- SIDEBAR --- */}
			<aside style={styles.sidebar}>
				<div style={styles.logo}>
					<span style={styles.logoIcon}>⚡</span> Versal Test
				</div>

				<nav style={{ flex: 1 }}>
					<NavItem id="home" label="Мои курсы" icon="🏠" />
					<NavItem id="results" label="Результаты" icon="📊" />
					<NavItem id="profile" label="Профиль" icon="👤" />

					{isAdmin && (
						<>
							<div style={styles.navDivider}>Администрирование</div>
							<NavItem id="users" label="Пользователи" icon="🔑" color="#dc2626" />
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

			{/* --- MAIN CONTENT --- */}
			<main style={styles.mainContent}>
				<header style={styles.header}>
					<div>
						<h2 style={styles.pageTitle}>
							{activeTab === 'home' && "Доступные дисциплины"}
							{activeTab === 'results' && "История тестирований"}
							{activeTab === 'profile' && "Настройки профиля"}
							{activeTab === 'users' && "Управление доступом"}
						</h2>
						<p style={styles.userInfo}>
							{user?.role || 'Студент'}: <span style={{ color: '#111827', fontWeight: 600 }}>{user?.fullName || 'Загрузка...'}</span>
						</p>
					</div>
				</header>

				<section style={styles.contentArea}>
					{activeTab === 'home' && (
						<div style={styles.grid}>
							{courses && courses.length > 0 ? (
								courses.map(course => <CourseCard key={course.id} course={course} />)
							) : (
								<p>Курсы не найдены.</p>
							)}
						</div>
					)}

					{activeTab === 'users' && isAdmin && (
						<div style={styles.card}>
							<h3>Список пользователей (Модуль Админа)</h3>
							<p style={{ color: '#6b7280' }}>Здесь будет таблица из ТЗ (стр. 13) с возможностью блокировки.</p>
						</div>
					)}

					{activeTab === 'profile' && (
						<div style={styles.card}>
							<h3>Личные данные</h3>
							<p>ФИО: {user?.fullName}</p>
							<button style={styles.secondaryBtn}>Редактировать данные</button>
						</div>
					)}
				</section>
			</main>
		</div>
	);
};

const styles = {
	container: { display: 'flex', height: '100vh', backgroundColor: '#f9fafb', color: '#111827', fontFamily: "'Inter', sans-serif" },
	sidebar: { width: '260px', backgroundColor: '#ffffff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', padding: '24px 16px' },
	logo: { fontSize: '20px', fontWeight: '800', color: '#4f46e5', marginBottom: '32px', display: 'flex', alignItems: 'center' },
	logoIcon: { backgroundColor: '#4f46e5', color: 'white', width: '32px', height: '32px', display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '8px', marginRight: '10px' },
	navItem: { display: 'flex', alignItems: 'center', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontWeight: '500', marginBottom: '4px', transition: 'all 0.2s' },
	navDivider: { fontSize: '11px', textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '1px', margin: '20px 12px 10px', fontWeight: '700' },
	mainContent: { flex: 1, overflowY: 'auto', padding: '32px 48px' },
	header: { marginBottom: '32px' },
	pageTitle: { fontSize: '28px', fontWeight: '800', margin: 0, color: '#111827' },
	userInfo: { color: '#6b7280', marginTop: '4px', fontSize: '14px' },
	grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '24px' },
	courseCard: { backgroundColor: 'white', padding: '24px', borderRadius: '16px', border: '1px solid #e5e7eb', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', transition: 'transform 0.2s' },
	courseIcon: { fontSize: '32px', marginBottom: '16px' },
	courseTitle: { fontSize: '18px', fontWeight: '700', margin: '0 0 8px 0' },
	courseDesc: { fontSize: '14px', color: '#4b5563', lineHeight: '1.5', marginBottom: '20px' },
	primaryBtn: { width: '100%', padding: '10px', backgroundColor: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', transition: 'background 0.2s' },
	secondaryBtn: { padding: '10px 20px', backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' },
	logoutSection: { borderTop: '1px solid #e5e7eb', paddingTop: '16px', marginTop: '20px' },
	logoutBtn: { width: '100%', padding: '10px', backgroundColor: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', marginTop: '8px' },
	allLogoutBtn: { width: '100%', padding: '10px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' },
	card: { backgroundColor: 'white', padding: '24px', borderRadius: '16px', border: '1px solid #e5e7eb' }
};

export default Dashboard;