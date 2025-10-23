// client/src/components/DebugPanel.jsx
import { useState, useEffect } from 'react';

export default function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [debugInfo, setDebugInfo] = useState({
    myFiles: [],
    sharedWithMe: [],
    users: [],
    activeDownloads: [],
    events: []
  });

  useEffect(() => {
    // Listen to all events for debugging
    const eventLog = [];

    const logEvent = (type, data) => {
      const event = {
        type,
        data,
        timestamp: new Date().toLocaleTimeString()
      };
      eventLog.unshift(event);
      if (eventLog.length > 20) eventLog.pop();
      
      setDebugInfo(prev => ({
        ...prev,
        events: [...eventLog]
      }));
    };

    // Set up listeners
    window.electronAPI.onMessage?.((data) => {
      logEvent('hub-message', data);
    });

    window.electronAPI.onFileShared?.((data) => {
      logEvent('file-shared', data);
    });

    window.electronAPI.onDownloadProgress?.((data) => {
      logEvent('download-progress', { 
        fileName: data.fileName,
        progress: data.progress?.toFixed(1) + '%',
        speed: formatBytes(data.speed) + '/s'
      });
    });

    window.electronAPI.onDownloadComplete?.((data) => {
      logEvent('download-complete', data);
    });

    window.electronAPI.onDownloadError?.((data) => {
      logEvent('download-error', data);
    });

    window.electronAPI.onUserListUpdate?.((users) => {
      logEvent('user-list-update', { count: users.length });
      setDebugInfo(prev => ({ ...prev, users }));
    });

    window.electronAPI.onFileListUpdate?.((files) => {
      logEvent('file-list-update', { count: files.length });
      setDebugInfo(prev => ({ ...prev, myFiles: files }));
    });
  }, []);

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const refreshData = async () => {
    const files = await window.electronAPI.getFiles?.() || [];
    const shared = await window.electronAPI.getSharedWithMe?.() || [];
    const users = await window.electronAPI.getUsers?.() || [];
    
    setDebugInfo(prev => ({
      ...prev,
      myFiles: files,
      sharedWithMe: shared,
      users
    }));
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg shadow-lg z-50 font-mono text-sm"
      >
        🐛 Debug
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-purple-500 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-purple-500 px-4 py-3 flex items-center justify-between">
          <h2 className="text-white font-bold font-mono">🐛 Debug Panel</h2>
          <div className="flex gap-2">
            <button
              onClick={refreshData}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
            >
              🔄 Refresh
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* My Files */}
          <div className="bg-gray-800 rounded-lg p-3">
            <h3 className="text-emerald-400 font-bold mb-2 font-mono">
              📤 My Files ({debugInfo.myFiles.length})
            </h3>
            {debugInfo.myFiles.length === 0 ? (
              <p className="text-gray-500 text-sm">No files indexed</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-auto">
                {debugInfo.myFiles.map((file, i) => (
                  <div key={i} className="bg-gray-900 rounded p-2 text-xs">
                    <div className="text-white font-mono">{file.fileName}</div>
                    <div className="text-gray-400 mt-1">
                      Size: {formatBytes(file.size)} | 
                      Hash: {file.hash?.substring(0, 16)}... | 
                      Shared with: {file.sharedWith?.length || 0}
                    </div>
                    {file.sharedWith?.length > 0 && (
                      <div className="text-purple-400 mt-1">
                        Users: {file.sharedWith.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Shared With Me */}
          <div className="bg-gray-800 rounded-lg p-3">
            <h3 className="text-blue-400 font-bold mb-2 font-mono">
              📥 Shared With Me ({debugInfo.sharedWithMe.length})
            </h3>
            {debugInfo.sharedWithMe.length === 0 ? (
              <p className="text-gray-500 text-sm">No files shared with you</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-auto">
                {debugInfo.sharedWithMe.map((file, i) => (
                  <div key={i} className="bg-gray-900 rounded p-2 text-xs">
                    <div className="text-white font-mono">{file.fileName}</div>
                    <div className="text-gray-400 mt-1">
                      From: {file.uploader} | 
                      Size: {formatBytes(file.size)} | 
                      Has Key: {file.encryptedKey ? '✅' : '❌'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Online Users */}
          <div className="bg-gray-800 rounded-lg p-3">
            <h3 className="text-amber-400 font-bold mb-2 font-mono">
              👥 Online Users ({debugInfo.users.length})
            </h3>
            {debugInfo.users.length === 0 ? (
              <p className="text-gray-500 text-sm">No users online</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {debugInfo.users.map((user, i) => (
                  <div key={i} className="bg-gray-900 rounded px-3 py-1 text-sm text-white font-mono">
                    {user.nickname}
                    {user.publicKey && <span className="text-emerald-400 ml-2">🔑</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Event Log */}
          <div className="bg-gray-800 rounded-lg p-3">
            <h3 className="text-pink-400 font-bold mb-2 font-mono">
              📡 Event Log (Last 20)
            </h3>
            {debugInfo.events.length === 0 ? (
              <p className="text-gray-500 text-sm">No events yet</p>
            ) : (
              <div className="space-y-1 max-h-60 overflow-auto">
                {debugInfo.events.map((event, i) => (
                  <div key={i} className="bg-gray-900 rounded p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-mono font-bold ${
                        event.type.includes('error') ? 'text-red-400' :
                        event.type.includes('complete') ? 'text-emerald-400' :
                        event.type.includes('progress') ? 'text-blue-400' :
                        'text-gray-300'
                      }`}>
                        {event.type}
                      </span>
                      <span className="text-gray-500">{event.timestamp}</span>
                    </div>
                    <pre className="text-gray-400 whitespace-pre-wrap break-all">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* API Test */}
          <div className="bg-gray-800 rounded-lg p-3">
            <h3 className="text-cyan-400 font-bold mb-2 font-mono">
              🧪 API Tests
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  const files = await window.electronAPI.getFiles();
                  console.log('getFiles():', files);
                  alert(`Files: ${files.length}\nCheck console for details`);
                }}
                className="px-3 py-2 bg-gray-900 hover:bg-gray-700 text-white rounded text-sm font-mono"
              >
                Test getFiles()
              </button>
              <button
                onClick={async () => {
                  const shared = await window.electronAPI.getSharedWithMe();
                  console.log('getSharedWithMe():', shared);
                  alert(`Shared: ${shared.length}\nCheck console for details`);
                }}
                className="px-3 py-2 bg-gray-900 hover:bg-gray-700 text-white rounded text-sm font-mono"
              >
                Test getSharedWithMe()
              </button>
              <button
                onClick={async () => {
                  const users = await window.electronAPI.getUsers();
                  console.log('getUsers():', users);
                  alert(`Users: ${users.length}\nCheck console for details`);
                }}
                className="px-3 py-2 bg-gray-900 hover:bg-gray-700 text-white rounded text-sm font-mono"
              >
                Test getUsers()
              </button>
              <button
                onClick={() => {
                  console.log('electronAPI:', window.electronAPI);
                  alert('Check console for full API');
                }}
                className="px-3 py-2 bg-gray-900 hover:bg-gray-700 text-white rounded text-sm font-mono"
              >
                Log Full API
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}