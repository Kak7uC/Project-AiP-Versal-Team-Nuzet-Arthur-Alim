import React, { useState, useEffect } from 'react';
import './App.css';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';

function App() {
  const [view, setView] = useState('auth');
  const [user, setUser] = useState(null);
  const [debugStatus, setDebugStatus] = useState('unknown');

  const logout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });

    setUser(null);
    setView('auth');
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });

      setUser(null);
      setView('auth');
    } catch (err) {
      console.error('Ошибка выхода:', err);
    }
  };


  <Dashboard
    user={user}
    courses={[
      { id: 1, name: "Основы Go", description: "Тест по материалам модуля авторизации" },
      { id: 2, name: "Работа с Redis", description: "Проверка знаний Task Flow" }
    ]}
    onLogout={handleLogout}
  />



  useEffect(() => {
    // Функция проверки статуса
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/status', {
          credentials: 'include'
        });

        if (res.ok) {
          const data = await res.json();
          setDebugStatus(data.status); // Для отладки на экране

          if (data.status === 'Authorized') {
            setUser({ fullName: data.userName || 'Студент' });
            setView('dashboard');
          }
        }
      } catch (err) {
        console.error("Ошибка связи с сервером:", err);
      }
    };

    // Запускаем проверку сразу
    checkAuth();

    // И повторяем каждые 2 секунды
    const interval = setInterval(checkAuth, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="App">
      {/* Маленькая плашка сверху для проверки (потом удалим) */}
      <div style={{
        position: 'fixed', top: 0, left: 0, background: '#000', color: '#fff',
        fontSize: '10px', padding: '2px 5px', zIndex: 9999
      }}>
        Статус в Redis: {debugStatus} | Вид: {view}
      </div>

      {view === 'auth' ? (
        <AuthPage />
      ) : (
        <Dashboard user={user} courses={[
          { id: 1, name: "Основы Go", description: "Тест по материалам модуля авторизации" },
          { id: 2, name: "Работа с Redis", description: "Проверка знаний Task Flow" }
        ]} />
      )}
    </div>
  );
}

export default App;