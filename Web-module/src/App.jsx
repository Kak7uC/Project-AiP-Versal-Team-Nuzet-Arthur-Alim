import React, { useState, useEffect } from 'react';
import './App.css';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';

function App() {
  const [view, setView] = useState('auth');
  const [user, setUser] = useState(null);
  const [debugStatus, setDebugStatus] = useState('unknown');

  const handleLogout = async (all = false) => {
    try {
      await fetch(`/api/auth/logout${all ? '?all=true' : ''}`, {
        method: 'POST',
        credentials: 'include'
      });
      setUser(null);
      setView('auth');
    } catch (err) {
      console.error('Ошибка выхода:', err);
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/status', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setDebugStatus(data.status);

          if (data.status === 'Authorized') {
            setUser({ fullName: data.userName || 'Студент' });
            setView('dashboard');
          } else {
            setUser(null);
            setView('auth');
          }
        }
      } catch (err) {
        console.error("Ошибка связи:", err);
      }
    };

    checkAuth();
    const interval = setInterval(checkAuth, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="App">
      {view === 'auth' ? (
        <AuthPage />
      ) : (
        <Dashboard
          user={user}
          onLogout={() => handleLogout(false)}
          courses={[
            { id: 1, name: "Основы Go", description: "Тест по материалам модуля авторизации" },
            { id: 2, name: "Работа с Redis", description: "Проверка знаний Task Flow" }
          ]}
        />
      )}
    </div>
  );
}

export default App;