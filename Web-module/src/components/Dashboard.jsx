import React from 'react';

const Dashboard = ({ user, courses, onLogout }) => {
	return (
		<div className="dashboard-container" style={{ padding: '20px', fontFamily: 'sans-serif' }}>
			<header style={{
				display: 'flex',
				justifyContent: 'space-between',
				alignItems: 'center',
				borderBottom: '1px solid #e5e7eb',
				paddingBottom: '10px',
				marginBottom: '20px'
			}}>
				<div>
					<h2 style={{ margin: 0 }}>Личный кабинет</h2>
					<p style={{ margin: 0, color: '#6b7280' }}>
						Студент: <strong>{user?.fullName || 'Загрузка...'}</strong>
					</p>
				</div>

				<div style={{ display: 'flex', gap: '10px' }}>

					<button
						onClick={() => onLogout(true)}
						style={{
							backgroundColor: '#1f2937',
							color: 'white',
							border: 'none',
							padding: '8px 16px',
							cursor: 'pointer',
							borderRadius: '6px',
							fontWeight: 'bold',
							transition: 'background 0.2s',
							fontSize: '14px'
						}}
						onMouseOver={(e) => e.target.style.backgroundColor = 'black'}
						onMouseOut={(e) => e.target.style.backgroundColor = '#1f2937'}
					>
						Выйти со всех устройств
					</button>

					<button
						onClick={() => onLogout(false)}
						style={{
							background: '#ef4444',
							color: 'white',
							border: 'none',
							padding: '8px 16px',
							cursor: 'pointer',
							borderRadius: '6px',
							fontWeight: 'bold',
							transition: 'background 0.2s',
							fontSize: '14px'
						}}
						onMouseOver={(e) => e.target.style.background = '#dc2626'}
						onMouseOut={(e) => e.target.style.background = '#ef4444'}
					>
						Выйти
					</button>
				</div>
			</header>

			<main>
				<h3>Мои курсы и тесты</h3>
				<div style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
					gap: '20px',
					marginTop: '20px'
				}}>
					{courses && courses.length > 0 ? (
						courses.map(course => (
							<div key={course.id} style={{
								border: '1px solid #e5e7eb',
								borderRadius: '8px',
								padding: '15px',
								boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
							}}>
								<h4 style={{ margin: '0 0 10px 0' }}>{course.name}</h4>
								<p style={{ fontSize: '14px', color: '#4b5563' }}>{course.description}</p>
								<button style={{
									width: '100%',
									padding: '10px',
									background: '#4f46e5',
									color: 'white',
									border: 'none',
									borderRadius: '4px',
									cursor: 'pointer'
								}}>
									Начать тест
								</button>
							</div>
						))
					) : (
						<p>У вас пока нет доступных курсов.</p>
					)}
				</div>
			</main>
		</div>
	);
};

export default Dashboard;