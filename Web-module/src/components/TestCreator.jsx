import React, { useState } from 'react';

const TestCreator = ({ courseName, onSave, onCancel }) => {
	const [title, setTitle] = useState('');
	const [questions, setQuestions] = useState([
		{ text: '', options: ['', ''], correctIndex: 0 }
	]);

	// Добавить новый вопрос
	const addQuestion = () => {
		setQuestions([...questions, { text: '', options: ['', ''], correctIndex: 0 }]);
	};

	// Удалить вопрос
	const removeQuestion = (idx) => {
		setQuestions(questions.filter((_, i) => i !== idx));
	};

	// Изменить текст вопроса
	const updateQuestionText = (idx, text) => {
		const newQ = [...questions];
		newQ[idx].text = text;
		setQuestions(newQ);
	};

	// Изменить вариант ответа
	const updateOption = (qIdx, oIdx, val) => {
		const newQ = [...questions];
		newQ[qIdx].options[oIdx] = val;
		setQuestions(newQ);
	};

	// Добавить вариант ответа (кнопка "+ Вариант")
	const addOption = (qIdx) => {
		const newQ = [...questions];
		newQ[qIdx].options.push('');
		setQuestions(newQ);
	};

	// Выбрать правильный ответ (радио-кнопка)
	const setCorrect = (qIdx, oIdx) => {
		const newQ = [...questions];
		newQ[qIdx].correctIndex = oIdx;
		setQuestions(newQ);
	};

	const handleSave = () => {
		if (!title.trim()) return alert("Введите название теста!");

		// Валидация: проверяем, что везде есть текст
		for (let i = 0; i < questions.length; i++) {
			const q = questions[i];
			if (!q.text.trim()) return alert(`Вопрос №${i + 1} пустой!`);
			if (q.options.some(o => !o.trim())) return alert(`В вопросе №${i + 1} есть пустые варианты ответов!`);
		}

		onSave({ title, questions });
	};

	return (
		<div style={styles.overlay}>
			<div style={styles.card}>
				<div style={styles.header}>
					<div>
						<span style={styles.subtitle}>Создание теста для курса:</span>
						<h3 style={styles.title}>{courseName}</h3>
					</div>
					<button onClick={onCancel} style={styles.closeBtn}>✕</button>
				</div>

				<div style={styles.body}>
					<label style={styles.label}>Название теста</label>
					<input
						style={styles.mainInput}
						placeholder="Например: Итоговый тест по модулю 1"
						value={title}
						onChange={e => setTitle(e.target.value)}
					/>

					<div style={styles.questionsList}>
						{questions.map((q, qIdx) => (
							<div key={qIdx} style={styles.questionBlock}>
								<div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
									<span style={styles.qBadge}>Вопрос {qIdx + 1}</span>
									{questions.length > 1 && (
										<button onClick={() => removeQuestion(qIdx)} style={styles.removeBtn}>Удалить вопрос</button>
									)}
								</div>

								<textarea
									style={styles.area}
									placeholder="Введите текст вопроса..."
									value={q.text}
									onChange={e => updateQuestionText(qIdx, e.target.value)}
								/>

								<div style={styles.optionsLabel}>Варианты ответов (отметьте правильный):</div>
								<div style={styles.optionsGrid}>
									{q.options.map((opt, oIdx) => (
										<div key={oIdx} style={styles.optionRow}>
											<input
												type="radio"
												name={`correct-${qIdx}`}
												checked={q.correctIndex === oIdx}
												onChange={() => setCorrect(qIdx, oIdx)}
												style={{ cursor: 'pointer', width: '20px', height: '20px' }}
												title="Отметить как правильный"
											/>
											<input
												style={{ ...styles.input, borderColor: q.correctIndex === oIdx ? '#10b981' : '#e5e7eb' }}
												value={opt}
												onChange={e => updateOption(qIdx, oIdx, e.target.value)}
												placeholder={`Вариант ${oIdx + 1}`}
											/>
										</div>
									))}
									<button onClick={() => addOption(qIdx)} style={styles.smallBtn}>+ Добавить вариант</button>
								</div>
							</div>
						))}
					</div>

					<button onClick={addQuestion} style={styles.addQBtn}>+ Добавить еще один вопрос</button>
				</div>

				<div style={styles.footer}>
					<button onClick={onCancel} style={styles.cancelBtn}>Отмена</button>
					<button onClick={handleSave} style={styles.saveBtn}>Сохранить тест</button>
				</div>
			</div>
		</div>
	);
};

const styles = {
	overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' },
	card: { backgroundColor: 'white', borderRadius: '16px', width: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' },
	header: { padding: '24px 32px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: '16px 16px 0 0' },
	subtitle: { fontSize: '12px', textTransform: 'uppercase', color: '#6b7280', fontWeight: 'bold', letterSpacing: '0.5px' },
	title: { margin: '4px 0 0 0', fontSize: '20px', color: '#111827' },
	body: { padding: '32px', overflowY: 'auto', flex: 1, backgroundColor: '#f9fafb' },
	footer: { padding: '20px 32px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#fff', borderRadius: '0 0 16px 16px' },
	closeBtn: { background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#9ca3af', padding: '0 8px' },

	label: { display: 'block', fontWeight: 'bold', marginBottom: '8px', fontSize: '14px', color: '#374151' },
	mainInput: { width: '100%', padding: '12px 16px', fontSize: '16px', borderRadius: '8px', border: '1px solid #d1d5db', marginBottom: '32px', boxSizing: 'border-box', outline: 'none' },

	questionsList: { display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '24px' },
	questionBlock: { backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' },
	qBadge: { fontSize: '12px', backgroundColor: '#e0e7ff', color: '#4f46e5', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' },
	removeBtn: { color: '#ef4444', background: 'none', border: 'none', fontSize: '13px', cursor: 'pointer', fontWeight: '600' },

	area: { width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #d1d5db', minHeight: '80px', marginBottom: '20px', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', fontSize: '15px' },

	optionsLabel: { fontSize: '13px', fontWeight: '600', color: '#4b5563', marginBottom: '12px' },
	optionsGrid: { display: 'flex', flexDirection: 'column', gap: '12px' },
	optionRow: { display: 'flex', alignItems: 'center', gap: '12px' },
	input: { flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' },

	smallBtn: { padding: '6px 12px', fontSize: '12px', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer', alignSelf: 'flex-start', color: '#374151', fontWeight: '600', marginTop: '4px' },
	addQBtn: { width: '100%', padding: '16px', border: '2px dashed #d1d5db', backgroundColor: 'transparent', color: '#6b7280', borderRadius: '12px', cursor: 'pointer', fontWeight: '600', fontSize: '15px', transition: 'all 0.2s' },

	saveBtn: { backgroundColor: '#4f46e5', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' },
	cancelBtn: { backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', padding: '12px 24px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }
};

export default TestCreator;