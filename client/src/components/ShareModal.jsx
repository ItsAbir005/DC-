// client/src/components/ShareModal.jsx
import { useState, useEffect } from 'react';

export default function ShareModal({ file, users, onShare, onClose }) {
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  const filteredUsers = users.filter(user =>
    user.nickname.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleUser = (user) => {
    if (selectedUsers.includes(user.nickname)) {
      setSelectedUsers(selectedUsers.filter(u => u !== user.nickname));
    } else {
      setSelectedUsers([...selectedUsers, user.nickname]);
    }
  };

  const handleShare = async () => {
    if (selectedUsers.length === 0) {
      alert('Please select at least one user');
      return;
    }

    setIsSharing(true);
    try {
      await onShare(file.hash, selectedUsers, file.fileName);
      onClose();
    } catch (error) {
      console.error('Share failed:', error);
      alert('Failed to share file: ' + error.message);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl shadow-2xl border border-gray-700 w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              📤 Share File
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white text-2xl"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-gray-400 truncate">
            {file.fileName}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-6">
          {/* Search */}
          <input
            type="text"
            placeholder="🔍 Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field text-sm mb-4"
            autoFocus
          />

          {/* Selected Count */}
          {selectedUsers.length > 0 && (
            <div className="mb-3 p-3 bg-indigo-500/20 border border-indigo-500/30 rounded-lg">
              <p className="text-indigo-300 text-sm font-medium">
                {selectedUsers.length} user{selectedUsers.length !== 1 ? 's' : ''} selected: {' '}
                <span className="text-indigo-400">{selectedUsers.join(', ')}</span>
              </p>
            </div>
          )}

          {/* User List */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {filteredUsers.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No users found</p>
            ) : (
              filteredUsers.map((user, index) => (
                <label
                  key={index}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedUsers.includes(user.nickname)
                      ? 'bg-indigo-500/20 border-indigo-500/50'
                      : 'bg-gray-800 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedUsers.includes(user.nickname)}
                    onChange={() => toggleUser(user)}
                    className="w-5 h-5 accent-indigo-500"
                  />
                  
                  <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center text-sm font-bold">
                    {user.nickname[0].toUpperCase()}
                  </div>
                  
                  <div className="flex-1">
                    <p className="text-white font-medium">{user.nickname}</p>
                    <p className="text-xs text-gray-400">
                      {user.publicKey ? '🔐 Verified' : '⚠️ No key'}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-700 flex gap-3">
          <button
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={isSharing}
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            className="btn-primary flex-1"
            disabled={selectedUsers.length === 0 || isSharing}
          >
            {isSharing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                Sharing...
              </span>
            ) : (
              <>📤 Share ({selectedUsers.length})</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}