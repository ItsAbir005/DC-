// client/src/components/SharedByMe.jsx
import { useState } from 'react';

export default function SharedByMe({ files, onShare, onRevoke, onOpenShareModal }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileIcon = (fileName) => {
    const ext = fileName.split('.').pop().toLowerCase();
    const icons = {
      pdf: '📄',
      doc: '📝',
      docx: '📝',
      txt: '📃',
      jpg: '🖼️',
      jpeg: '🖼️',
      png: '🖼️',
      gif: '🖼️',
      mp4: '🎥',
      mov: '🎥',
      avi: '🎥',
      mp3: '🎵',
      wav: '🎵',
      zip: '📦',
      rar: '📦',
      '7z': '📦',
      exe: '⚙️',
      js: '📜',
      py: '🐍',
      java: '☕',
      cpp: '⚡',
    };
    return icons[ext] || '📄';
  };

  const filteredFiles = files.filter(file =>
    file.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (files.length === 0) {
    return (
      <div className="panel flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-6xl mb-4">📂</div>
          <h3 className="text-xl font-bold text-white mb-2">No Files Shared Yet</h3>
          <p className="text-gray-400 mb-4">
            Connect with a shared folder to see your files here
          </p>
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700 max-w-md mx-auto">
            <p className="text-sm text-gray-300 mb-2">💡 To share files:</p>
            <ol className="text-sm text-gray-400 text-left space-y-1">
              <li>1. Disconnect if connected</li>
              <li>2. Reconnect and select a folder with files</li>
              <li>3. Your files will appear here</li>
              <li>4. Click "Share" to share with other users</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">
            📤 My Shared Files ({files.length})
          </h2>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="🔍 Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {filteredFiles.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <div className="text-4xl mb-2">🔍</div>
            <p>No files match "{searchQuery}"</p>
          </div>
        ) : (
          filteredFiles.map((file) => (
            <div
              key={file.hash}
              className={`bg-gray-800/50 rounded-lg p-4 border transition-all cursor-pointer ${
                selectedFile?.hash === file.hash
                  ? 'border-indigo-500 shadow-lg shadow-indigo-500/20'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
              onClick={() => setSelectedFile(file)}
            >
              {/* File Header */}
              <div className="flex items-start gap-3 mb-3">
                <div className="text-3xl">{getFileIcon(file.fileName)}</div>
                
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-medium truncate mb-1">
                    {file.fileName}
                  </h3>
                  
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    <span>💾 {formatBytes(file.size)}</span>
                    <span>•</span>
                    <span className="font-mono text-xs">
                      {file.hash.slice(0, 8)}...
                    </span>
                  </div>
                </div>

                {/* Share Status Badge */}
                <div className="flex flex-col gap-2">
                  {file.sharedWith && file.sharedWith.length > 0 ? (
                    <div className="px-3 py-1 bg-emerald-500/20 text-emerald-400 rounded-full text-xs font-medium border border-emerald-500/30 whitespace-nowrap">
                      ✓ Shared with {file.sharedWith.length}
                    </div>
                  ) : (
                    <div className="px-3 py-1 bg-gray-700 text-gray-400 rounded-full text-xs font-medium whitespace-nowrap">
                      Not shared
                    </div>
                  )}
                </div>
              </div>

              {/* Shared With Section */}
              {file.sharedWith && file.sharedWith.length > 0 && (
                <div className="mt-3 p-3 bg-gray-900/50 rounded-lg border border-gray-700">
                  <p className="text-xs text-gray-400 mb-2">Shared with:</p>
                  <div className="flex flex-wrap gap-2">
                    {file.sharedWith.map((user, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 px-3 py-1 bg-indigo-500/20 text-indigo-300 rounded-lg border border-indigo-500/30 text-sm group"
                      >
                        <span>👤 {user}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Revoke access for ${user}?`)) {
                              onRevoke(file, user);
                            }
                          }}
                          className="text-red-400 hover:text-red-300 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Revoke access"
                        >
                          ⊗
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File Actions */}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenShareModal(file);
                  }}
                  className="flex-1 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-all transform hover:scale-105"
                >
                  📤 Share
                </button>
                
                {file.sharedWith && file.sharedWith.length > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Revoke all access to "${file.fileName}"?`)) {
                        file.sharedWith.forEach(user => onRevoke(file, user));
                      }
                    }}
                    className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg font-medium transition-all border border-red-500/30"
                  >
                    ⛔ Revoke All
                  </button>
                )}
              </div>

              {/* Detailed Info (when selected) */}
              {selectedFile?.hash === file.hash && (
                <div className="mt-4 pt-4 border-t border-gray-700 space-y-2 animate-slide-in">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 bg-gray-900/50 rounded">
                      <span className="text-gray-500">Full Hash:</span>
                      <p className="text-gray-300 font-mono break-all mt-1">
                        {file.hash}
                      </p>
                    </div>
                    <div className="p-2 bg-gray-900/50 rounded">
                      <span className="text-gray-500">File Path:</span>
                      <p className="text-gray-300 truncate mt-1" title={file.filePath}>
                        {file.filePath}
                      </p>
                    </div>
                  </div>

                  {file.encryptedKeys && Object.keys(file.encryptedKeys).length > 0 && (
                    <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs">
                      <span className="text-emerald-400">🔐 Encryption Status:</span>
                      <p className="text-gray-300 mt-1">
                        File encrypted with AES-256-CBC
                      </p>
                      <p className="text-gray-400 mt-1">
                        {Object.keys(file.encryptedKeys).length} encrypted key(s) generated
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Summary Footer */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <div className="text-gray-400">
            <span className="font-medium text-white">{files.length}</span> files available
          </div>
          <div className="text-gray-400">
            <span className="font-medium text-white">
              {files.reduce((acc, f) => acc + (f.sharedWith?.length || 0), 0)}
            </span>{' '}
            total shares
          </div>
          <div className="text-gray-400">
            Total size:{' '}
            <span className="font-medium text-white">
              {formatBytes(files.reduce((acc, f) => acc + f.size, 0))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}