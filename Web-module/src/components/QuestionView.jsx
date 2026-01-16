import React, { useState } from 'react';

const QuestionView = ({ testName, questions, onFinish, onCancel }) => {
	// Состояние: индекс текущего вопроса
	const [currentIndex, setCurrentIndex] = useState(0);
	// Состояние: объект с ответами { [questionId]: selectedOptionIndex }
	const [answers, setAnswers] = useState({});

	const currentQuestion = questions[currentIndex];
	const totalQuestions = questions.length;
	const isLastQuestion = currentIndex === totalQuestions - 1;

	// Обработка выбора варианта
	const handleSelectOption = (optionIndex) => {
		setAnswers({
			...answers,
			[currentQuestion.id]: optionIndex
		});
	};


	if (!questions || questions.length === 0) {
		return (
			<div style={styles.overlay}>
				<div style={styles.testCard}>
					<div style={{ padding: '40px', textAlign: 'center' }}>
						<h3>Ошибка загрузки теста</h3>
						<p>В этом тесте нет вопросов или они не загрузились.</p>
						<button onClick={onCancel} style={styles.exitBtn}>Закрыть</button>
					</div>
				</div>
			</div>
		);
	}

	// Переход вперед / Завершение
	const handleNext = () => {
		if (isLastQuestion) {
			onFinish(answers); // Отправляем все накопленные ответы
		} else {
			setCurrentIndex(currentIndex + 1);
		}
	};

	// Переход назад
	const handlePrev = () => {
		if (currentIndex > 0) {
			setCurrentIndex(currentIndex - 1);
		}
	};

	return (

		
		<div style={styles.overlay}>
			<div style={styles.testCard}>
				{/* Шапка теста */}
				<div style={styles.header}>
					<div>
						<button onClick={onCancel} style={styles.exitBtn}>✕ Прервать</button>
						<h3 style={styles.testTitle}>{testName}</h3>
					</div>
					<div style={styles.badge}>
						Вопрос {currentIndex + 1} из {totalQuestions}
					</div>
				</div>

				{/* Прогресс-бар */}
				<div style={styles.progressTrack}>
					<div style={{
						...styles.progressFill,
						width: `${((currentIndex + 1) / totalQuestions) * 100}%`
					}} />
				</div>

				{/* Тело вопроса */}
				<div style={styles.questionBody}>
					<span style={styles.versionTag}>Версия вопроса: {currentQuestion.version}</span>
					<h2 style={styles.questionText}>{currentQuestion.text}</h2>

					<div style={styles.optionsList}>
						{currentQuestion.options.map((opt, i) => (
							<label
								key={i}
								style={{
									...styles.optionLabel,
									borderColor: answers[currentQuestion.id] === i ? '#4f46e5' : '#e5e7eb',
									backgroundColor: answers[currentQuestion.id] === i ? '#f5f3ff' : 'white'
								}}
							>
								<input
									type="radio"
									name={`q-${currentQuestion.id}`}
									checked={answers[currentQuestion.id] === i}
									onChange={() => handleSelectOption(i)}
									style={styles.radioInput}
								/>
								<span style={styles.optionText}>{opt}</span>
							</label>
						))}
					</div>
				</div>

				{/* Подвал с навигацией */}
				<div style={styles.footer}>
					<button
						onClick={handlePrev}
						disabled={currentIndex === 0}
						style={{
							...styles.navBtn,
							opacity: currentIndex === 0 ? 0.5 : 1,
							backgroundColor: '#e5e7eb',
							color: '#374151'
						}}
					>
						← Назад
					</button>

					<button
						onClick={handleNext}
						disabled={answers[currentQuestion.id] === undefined}
						style={{
							...styles.navBtn,
							backgroundColor: isLastQuestion ? '#10b981' : '#4f46e5',
							color: 'white',
							opacity: answers[currentQuestion.id] === undefined ? 0.6 : 1
						}}
					>
						{isLastQuestion ? 'Завершить тест' : 'Далее →'}
					</button>
				</div>
			</div>
		</div>
	);
};

// --- СТИЛИ ДЛЯ ТЕСТА ---
const styles = {
	overlay: {
		position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
		backgroundColor: '#f9fafb', display: 'flex', justifyContent: 'center', alignItems: 'center',
		zIndex: 1000, padding: '20px'
	},
	testCard: {
		backgroundColor: 'white', width: '100%', maxWidth: '700px',
		borderRadius: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
		overflow: 'hidden', border: '1px solid #e5e7eb'
	},
	header: {
		padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
	},
	exitBtn: {
		border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer',
		fontSize: '13px', marginBottom: '8px', padding: 0, fontWeight: '600'
	},
	testTitle: { margin: 0, fontSize: '20px', fontWeight: '800', color: '#111827' },
	badge: {
		backgroundColor: '#4f46e5', color: 'white', padding: '6px 12px',
		borderRadius: '20px', fontSize: '12px', fontWeight: '700'
	},
	progressTrack: { height: '6px', backgroundColor: '#f3f4f6', width: '100%' },
	progressFill: { height: '100%', backgroundColor: '#4f46e5', transition: 'width 0.3s ease' },
	questionBody: { padding: '32px' },
	versionTag: { fontSize: '11px', color: '#9ca3af', fontWeight: '700', textTransform: 'uppercase' },
	questionText: { fontSize: '24px', margin: '12px 0 24px 0', color: '#111827', lineHeight: '1.3' },
	optionsList: { display: 'flex', flexDirection: 'column', gap: '12px' },
	optionLabel: {
		display: 'flex', alignItems: 'center', padding: '16px', borderRadius: '12px',
		border: '2px solid #e5e7eb', cursor: 'pointer', transition: 'all 0.2s'
	},
	radioInput: { width: '18px', height: '18px', marginRight: '14px', cursor: 'pointer' },
	optionText: { fontSize: '16px', fontWeight: '500', color: '#374151' },
	footer: {
		padding: '24px 32px', backgroundColor: '#f9fafb', borderTop: '1px solid #e5e7eb',
		display: 'flex', justifyContent: 'space-between'
	},
	navBtn: {
		padding: '12px 24px', borderRadius: '10px', border: 'none',
		fontWeight: '700', fontSize: '15px', cursor: 'pointer', transition: 'all 0.2s'
	}
};

export default QuestionView;