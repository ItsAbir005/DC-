// client/src/components/SharedByMe.jsx
import { useState } from 'react';

export default function SharedByMe({ files, onShare, onRevoke, onOpenShareModal }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('fileName');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedFile, setSelectedFile] = useState(null);

  const filteredFiles = files
    .filter(file => 
      file.fileName.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      
      if (sortBy === 'size') {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else {
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();
      }
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handleContextMenu = (e, file) => {
    e.preventDefault();
    setSelectedFile(file);
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <span className="text-gray-600">↕</span>;
    return <span className="text-indigo-400">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="panel h-full flex flex-col">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          📤 Shared By Me
          {files.length > 0 && (
            <span className="text-sm font-normal text-gray-400 bg-gray-800 px-2 py-1 rounded">
              {filteredFiles.length} of {files.length}
            </span>
          )}
        </h2>

        <input
          type="text"
          placeholder="🔍 Search my files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-field text-sm w-full"
        />
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
          <div className="text-8xl mb-6 opacity-20">📂</div>
          <p className="text-xl font-medium mb-2">No files shared yet</p>
          <p className="text-sm text-gray-600">Share a folder on login to get started</p>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
          <div className="text-6xl mb-4 opacity-20">🔍</div>
          <p className="text-lg font-medium">No files match your search</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-800 border-b border-gray-700">
              <tr className="text-left text-gray-400">
                <th className="p-3 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('fileName')}>
                  <div className="flex items-center gap-2">
                    File Name <SortIcon field="fileName" />
                  </div>
                </th>
                <th className="p-3 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('size')}>
                  <div className="flex items-center gap-2">
                    Size <SortIcon field="size" />
                  </div>
                </th>
                <th className="p-3">Hash</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file, index) => (
                <tr 
                  key={index}
                  className="border-b border-gray-700/50 hover:bg-gray-800/50 transition-colors group"
                  onContextMenu={(e) => handleContextMenu(e, file)}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">📄</span>
                      <span className="text-white font-medium truncate max-w-xs">
                        {file.fileName}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-gray-300">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </td>
                  <td className="p-3">
                    <span className="font-mono text-xs bg-gray-900 px-2 py-1 rounded text-gray-400">
                      {file.hash.substring(0, 16)}...
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onOpenShareModal(file)}
                        className="btn-primary text-xs px-3 py-1"
                        title="Share with users"
                      >
                        📤 Share
                      </button>
                      <button
                        onClick={() => onRevoke(file)}
                        className="btn-danger text-xs px-3 py-1"
                        title="Revoke access"
                      >
                        ⛔ Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Context Menu */}
      {selectedFile && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setSelectedFile(null)}
        >
          <div className="absolute bg-gray-800 border border-gray-700 rounded-lg shadow-2xl p-2 min-w-[200px]"
               style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <button
              onClick={() => {
                onOpenShareModal(selectedFile);
                setSelectedFile(null);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-700 rounded text-white flex items-center gap-2"
            >
              📤 Share with...
            </button>
            <button
              onClick={() => {
                onRevoke(selectedFile);
                setSelectedFile(null);
              }}
              className="w-full text-left px-4 py-2 hover:bg-gray-700 rounded text-red-400 flex items-center gap-2"
            >
              ⛔ Revoke Access
            </button>
          </div>
        </div>
      )}
    </div>
  );
}