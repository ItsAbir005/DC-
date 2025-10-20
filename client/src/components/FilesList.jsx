// client/src/components/FilesList.jsx
import { useState } from 'react';

export default function FilesList({ files, onShare, onRevoke }) {
  const [selectedFiles, setSelectedFiles] = useState(new Set());

  const handleShare = async (file) => {
    const recipient = prompt('Enter recipient nickname(s) separated by comma:');
    if (recipient) {
      const recipients = recipient.split(',').map(r => r.trim());
      await onShare(file.hash, recipients, file.fileName);
    }
  };

  const handleRevoke = async (file) => {
    const targetUser = prompt('Enter user to revoke access:');
    if (targetUser) {
      await onRevoke(file.hash, targetUser, file.fileName);
    }
  };

  return (
    <div className="panel h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          📁 My Files
          {files.length > 0 && (
            <span className="text-sm font-normal text-gray-400 bg-gray-800 px-2 py-1 rounded">
              {files.length}
            </span>
          )}
        </h2>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[calc(100%-60px)] text-gray-500">
          <div className="text-8xl mb-6 opacity-20">📂</div>
          <p className="text-xl font-medium mb-2">No files shared yet</p>
          <p className="text-sm text-gray-600">Share a folder on login to get started</p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto h-[calc(100%-60px)]">
          {files.map((file, index) => (
            <div
              key={index}
              className="group bg-gray-800 hover:bg-gray-750 rounded-lg p-4 border border-gray-700 hover:border-indigo-500/50 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/10"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-3xl">📄</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate text-lg group-hover:text-indigo-400 transition-colors">
                        {file.fileName}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
                        <span className="flex items-center gap-1">
                          💾 {(file.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                        <span className="font-mono bg-gray-900 px-2 py-0.5 rounded">
                          🔑 {file.hash.substring(0, 12)}...
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleShare(file)}
                    className="btn-primary text-sm px-4 py-2 flex items-center gap-1"
                    title="Share with users"
                  >
                    <span>📤</span>
                    <span className="hidden sm:inline">Share</span>
                  </button>
                  <button
                    onClick={() => handleRevoke(file)}
                    className="btn-danger text-sm px-4 py-2 flex items-center gap-1"
                    title="Revoke access"
                  >
                    <span>⛔</span>
                    <span className="hidden sm:inline">Revoke</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}