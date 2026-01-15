import React, { useState, useEffect } from 'react';
import './App.css';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';

function App() {
  const [view, setView] = useState('auth');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
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
        const res = await fetch('/api/auth/status');
        const data = await res.json();

        if (data.status === 'Authorized') {
          const nameRes = await fetch('/api/user/me');
          const fullNameFromCpp = await nameRes.text();

          // ЛОГИКА: 
          // 1. Если C++ вернул "ERROR..." (например, юзера нет в базе C++)
          // 2. ИЛИ если C++ вернул пустую строку
          // ТОГДА берем имя из Redis (data.userName - то, что пришло от Яндекса)
          // ИНАЧЕ берем то, что вернул C++

          let finalName = data.userName; // По умолчанию берем из авторизации (Яндекс)

          if (!fullNameFromCpp.includes("ERROR") && fullNameFromCpp.trim() !== "") {
            finalName = fullNameFromCpp;
          }

          setUser({
            fullName: finalName,
            role: data.role
          });
          setView('dashboard');
          }
        }
        catch (err) { console.error("Ошибка авторизации:", err); }
      finally {
        setLoading(false); // <--- ДОБАВИЛИ: Убираем экран загрузки
      }
    };
    checkAuth();
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Загрузка...</div>;
  }

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