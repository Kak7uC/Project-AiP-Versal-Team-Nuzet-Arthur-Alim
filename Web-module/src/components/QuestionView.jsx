export default function QuestionView({ question }) {
	return (
		<div className="page-container">
			<div className="card" style={{ maxWidth: '600px' }}>
				<span style={{ color: '#9ca3af', fontSize: '12px' }}>Вопрос v.{question.version}</span>
				<h2 style={{ margin: '10px 0 20px' }}>{question.text}</h2>

				{question.options.map((opt, i) => (
					<label key={i} className="option-label">
						<input type="radio" name="q" style={{ marginRight: '10px' }} />
						{opt}
					</label>
				))}

				<div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
					<button className="btn" style={{ backgroundColor: '#e5e7eb' }}>Назад</button>
					<button className="btn btn-primary">Ответить</button>
				</div>
			</div>
		</div>
	);
}