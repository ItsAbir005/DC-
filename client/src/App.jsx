// client/src/App.jsx
import { useState } from 'react';

function App() {
  const [nickname, setNickname] = useState('');
  const [connected, setConnected] = useState(false);

  const handleConnect = () => {
    if (nickname.trim()) {
      setConnected(true);
    }
  };

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600">
        <div className="w-full max-w-md px-6">
          <div className="text-center mb-8">
            <div className="text-7xl mb-4">🔒</div>
            <h1 className="text-5xl font-bold text-white mb-2">
              DC Clone
            </h1>
            <p className="text-white/90 text-lg">
              Secure P2P File Sharing
            </p>
          </div>

          <div className="card backdrop-blur-xl bg-gray-900/80">
            <h2 className="text-2xl font-bold text-white mb-6">Connect to Hub</h2>
            
            <input
              type="text"
              placeholder="Enter your nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleConnect()}
              className="input-field mb-4"
              autoFocus
            />

            <button onClick={handleConnect} className="btn-primary w-full py-3 text-lg">
              🚀 Connect
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <h1 className="text-2xl font-bold text-white">
          DC Clone - Connected as {nickname}
        </h1>
      </header>
      
      <div className="p-8 text-center">
        <p className="text-gray-400 text-xl">Welcome to DC Clone! 🎉</p>
        <p className="text-gray-500 mt-2">Electron integration coming next...</p>
      </div>
    </div>
  );
}

export default App;