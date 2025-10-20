// client/src/App.jsx
import { useState } from 'react';
import LoginScreen from './components/LoginScreen';
import MainLayout from './components/MainLayout';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const handleLogin = (nickname) => {
    setCurrentUser(nickname);
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <MainLayout nickname={currentUser} />;
}

export default App;