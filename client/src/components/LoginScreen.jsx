// client/src/components/LoginScreen.jsx
import { useState } from 'react';

export default function LoginScreen({ onLogin }) {
  const [nickname, setNickname] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!nickname.trim()) {
      setError('Please enter a nickname');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await window.electronAPI.connect(nickname.trim(), folderPath.trim());
      
      if (result.success) {
        onLogin(result.nickname);
      } else {
        setError(result.error || 'Connection failed');
      }
    } catch (err) {
      setError(err.message || 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-white rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-300 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
      </div>
      
      <div className="relative z-10 w-full max-w-md px-6">
        {/* Logo/Title */}
        <div className="text-center mb-8 animate-fade-in">
          <div className="text-7xl mb-4">🔒</div>
          <h1 className="text-5xl font-bold text-white mb-2 drop-shadow-2xl">
            DC Clone
          </h1>
          <p className="text-white/90 text-lg font-medium">
            Secure Peer-to-Peer File Sharing
          </p>
        </div>

        {/* Login Card */}
        <div className="card backdrop-blur-xl bg-gray-900/80 border-gray-700/50 shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-6">Connect to Hub</h2>
          
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
              <p className="text-red-200 text-sm">❌ {error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Nickname *
              </label>
              <input
                type="text"
                placeholder="Enter your nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                className="input-field"
                disabled={loading}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Folder Path <span className="text-gray-500">(Optional)</span>
              </label>
              <input
                type="text"
                placeholder="C:\Users\YourName\Documents"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                className="input-field"
                disabled={loading}
              />
              <p className="text-xs text-gray-400 mt-1">
                💡 Leave empty to connect without sharing files
              </p>
            </div>

            <button
              onClick={handleLogin}
              disabled={loading}
              className="btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Connecting...
                </span>
              ) : (
                <>🚀 Connect to Hub</>
              )}
            </button>
          </div>
        </div>

        {/* Security Badge */}
        <div className="mt-6 text-center">
          <div className="inline-flex items-center gap-3 px-4 py-2 bg-white/10 backdrop-blur-sm rounded-full border border-white/20">
            <span className="text-xs text-white/80">🔐 AES-256</span>
            <span className="w-1 h-1 bg-white/40 rounded-full"></span>
            <span className="text-xs text-white/80">🔑 RSA-2048</span>
            <span className="w-1 h-1 bg-white/40 rounded-full"></span>
            <span className="text-xs text-white/80">🛡️ E2E Encrypted</span>
          </div>
        </div>
      </div>
    </div>
  );
}