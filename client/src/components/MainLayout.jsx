// client/src/components/MainLayout.jsx
import { useState, useEffect } from 'react';
import OnlineUsers from './OnlineUsers';
import SharedByMe from './SharedByMe';
import SharedWithMe from './SharedWithMe';
import ShareModal from './ShareModal';

export default function MainLayout({ nickname }) {
  const [users, setUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeTab, setActiveTab] = useState('shared-by-me'); // 'shared-by-me' | 'shared-with-me'
  const [shareModalFile, setShareModalFile] = useState(null);

  useEffect(() => {
    loadInitialData();
    setupEventListeners();
  }, []);

  const loadInitialData = async () => {
    const fileList = await window.electronAPI.getFiles();
    setFiles(fileList || []);
    
    const userList = await window.electronAPI.getUsers();
    setUsers(userList || []);
  };

  const setupEventListeners = () => {
    window.electronAPI.onUserListUpdate((userList) => {
      setUsers(userList);
    });

    window.electronAPI.onUserJoined((data) => {
      addMessage('info', `👤 ${data.nickname} joined`);
      // Refresh user list
      window.electronAPI.getUsers().then(setUsers);
    });

    window.electronAPI.onFileShared((data) => {
      addMessage('success', `📁 ${data.from} shared: ${data.fileName}`);
    });

    window.electronAPI.onMessage((data) => {
      if (data.type === 'system') {
        addMessage('info', data.text);
      }
    });
  };

  const addMessage = (type, text) => {
    setMessages(prev => [...prev, { type, text, timestamp: new Date() }]);
  };

  const handleShare = async (fileHash, recipients, fileName) => {
    const result = await window.electronAPI.shareFile(fileHash, recipients);
    if (result.success) {
      addMessage('success', `✅ Shared "${fileName}" with ${recipients.join(', ')}`);
    } else {
      addMessage('error', `❌ Failed to share: ${result.error}`);
      throw new Error(result.error);
    }
  };

  const handleRevoke = async (file) => {
    const targetUser = prompt('Enter user to revoke access:');
    if (targetUser) {
      const result = await window.electronAPI.revokeAccess(file.hash, targetUser);
      if (result.success) {
        addMessage('warning', `⛔ Revoked access to "${file.fileName}" for ${targetUser}`);
      } else {
        addMessage('error', `❌ Failed to revoke: ${result.error}`);
      }
    }
  };

  const handleDownload = (fileHash, uploader, fileName) => {
    addMessage('info', `⬇️ Downloading "${fileName}" from ${uploader}...`);
    // Download will be implemented with peer controller
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-3xl">🔒</div>
            <div>
              <h1 className="text-2xl font-bold text-white">DC Clone</h1>
              <p className="text-sm text-gray-400">
                Connected as <span className="text-indigo-400 font-semibold">{nickname}</span>
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 rounded-lg border border-emerald-500/30">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
              <span className="text-emerald-400 text-sm font-medium">Online</span>
            </div>
            <div className="px-4 py-2 bg-gray-800 rounded-lg border border-gray-700">
              <span className="text-gray-400 text-sm">👥 {users.length} users</span>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-gray-900 border-b border-gray-800 px-6">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('shared-by-me')}
            className={`px-6 py-3 font-medium transition-all ${
              activeTab === 'shared-by-me'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            📤 Shared By Me {files.length > 0 && `(${files.length})`}
          </button>
          <button
            onClick={() => setActiveTab('shared-with-me')}
            className={`px-6 py-3 font-medium transition-all ${
              activeTab === 'shared-with-me'
                ? 'text-white border-b-2 border-indigo-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            📥 Shared With Me
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Files Panel */}
        <div className="lg:col-span-2 h-[calc(100vh-200px)]">
          {activeTab === 'shared-by-me' ? (
            <SharedByMe 
              files={files} 
              onShare={handleShare}
              onRevoke={handleRevoke}
              onOpenShareModal={setShareModalFile}
            />
          ) : (
            <SharedWithMe 
              onDownload={handleDownload}
            />
          )}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-4 h-[calc(100vh-200px)]">
          {/* Users */}
          <div className="h-1/2">
            <OnlineUsers users={users} />
          </div>

          {/* Activity Log */}
          <div className="panel h-1/2">
            <h2 className="text-lg font-bold text-white mb-4">💬 Activity Log</h2>
            
            <div className="space-y-2 overflow-y-auto h-[calc(100%-40px)]">
              {messages.slice(-10).reverse().map((msg, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border text-sm animate-slide-in ${
                    msg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                    msg.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                    msg.type === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                    'bg-blue-500/10 border-blue-500/30 text-blue-300'
                  }`}
                >
                  <p className="break-words leading-relaxed">{msg.text}</p>
                  {msg.timestamp && (
                    <p className="text-xs opacity-60 mt-1">
                      {msg.timestamp.toLocaleTimeString()}
                    </p>
                  )}
                </div>
              ))}
              
              {messages.length === 0 && (
                <p className="text-gray-500 text-center py-8">No activity yet</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Share Modal */}
      {shareModalFile && (
        <ShareModal
          file={shareModalFile}
          users={users}
          onShare={handleShare}
          onClose={() => setShareModalFile(null)}
        />
      )}
    </div>
  );
}