// client/src/components/SharedWithMe.jsx
import { useState, useEffect } from 'react';

export default function SharedWithMe({ onDownload }) {
  const [sharedFiles, setSharedFiles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('fileName');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedOwner, setSelectedOwner] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load existing shared files on mount
    loadSharedFiles();

    // Listen for NEW files being shared
    window.electronAPI.onFileShared((data) => {
      console.log('📥 New file shared event:', data);
      setSharedFiles(prev => {
        // Check if file already exists
        const exists = prev.find(f => f.fileHash === data.fileHash && f.from === data.from);
        if (exists) return prev;

        return [...prev, {
          fileHash: data.fileHash,
          fileName: data.fileName,
          size: data.size,
          from: data.from,
          timestamp: new Date(),
        }];
      });
    });

    // Listen for access revoked
    if (window.electronAPI.onAccessRevoked) {
      window.electronAPI.onAccessRevoked((data) => {
        console.log('🚫 Access revoked:', data);
        setSharedFiles(prev => prev.filter(f => 
          !(f.fileHash === data.fileHash && f.from === data.from)
        ));
      });
    }
  }, []);

  const loadSharedFiles = async () => {
    try {
      setLoading(true);
      console.log('📋 Loading shared files from backend...');
      
      const files = await window.electronAPI.getSharedWithMe();
      console.log('✅ Loaded shared files:', files);
      
      // Transform the data to match our component's format
      const transformedFiles = (files || []).map(file => ({
        fileHash: file.fileHash,
        fileName: file.fileName,
        size: file.size,
        from: file.uploader,
        timestamp: file.sharedAt ? new Date(file.sharedAt) : new Date(),
      }));
      
      setSharedFiles(transformedFiles);
    } catch (error) {
      console.error('❌ Error loading shared files:', error);
      setSharedFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const getUniqueOwners = () => {
    const owners = new Set(sharedFiles.map(f => f.from));
    return ['all', ...Array.from(owners)];
  };

  const filteredFiles = sharedFiles
    .filter(file => {
      const matchesSearch = file.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        file.from.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesOwner = selectedOwner === 'all' || file.from === selectedOwner;
      return matchesSearch && matchesOwner;
    })
    .sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      if (sortBy === 'size') {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      } else if (sortBy === 'timestamp') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
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

  const handleDownload = async (file) => {
    try {
      console.log('🎯 Download button clicked for:', file.fileName);

      // Request download token from hub
      const tokenResult = await window.electronAPI.requestDownloadToken(
        file.fileHash,
        file.from
      );

      console.log('🎫 Token result:', tokenResult);

      if (tokenResult.success) {
        const downloadResult = await window.electronAPI.startDownload({
          fileHash: file.fileHash,
          fileName: file.fileName,
          uploader: file.from,
          size: file.size,
          token: tokenResult.token,
          uploaderAddress: tokenResult.uploaderAddress || 'localhost',
        });

        console.log('🚀 Download started:', downloadResult);
        if (onDownload) {
          onDownload(file.fileHash, file.from, file.fileName);
        }
      } else {
        console.error('❌ Token request failed:', tokenResult.error);
        alert(`Failed to get download token: ${tokenResult.error}`);
      }
    } catch (error) {
      console.error('❌ Download error:', error);
      alert(`Download error: ${error.message}`);
    }
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <span className="text-gray-600">↕</span>;
    return <span className="text-indigo-400">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  if (loading) {
    return (
      <div className="panel h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading shared files...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            📥 Shared With Me
            {sharedFiles.length > 0 && (
              <span className="text-sm font-normal text-gray-400 bg-gray-800 px-2 py-1 rounded">
                {filteredFiles.length} of {sharedFiles.length}
              </span>
            )}
          </h2>
          
          <button
            onClick={loadSharedFiles}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Filters */}
        {sharedFiles.length > 0 && (
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="🔍 Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field text-sm flex-1"
            />

            <select
              value={selectedOwner}
              onChange={(e) => setSelectedOwner(e.target.value)}
              className="input-field text-sm w-40"
            >
              {getUniqueOwners().map(owner => (
                <option key={owner} value={owner}>
                  {owner === 'all' ? 'All Owners' : owner}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {sharedFiles.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
          <div className="text-8xl mb-6 opacity-20">📭</div>
          <p className="text-xl font-medium mb-2">No files shared with you yet</p>
          <p className="text-sm text-gray-600">Files shared by others will appear here</p>
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
                <th className="p-3 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('from')}>
                  <div className="flex items-center gap-2">
                    Owner <SortIcon field="from" />
                  </div>
                </th>
                <th className="p-3 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('timestamp')}>
                  <div className="flex items-center gap-2">
                    Shared <SortIcon field="timestamp" />
                  </div>
                </th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file, index) => (
                <tr
                  key={`${file.fileHash}-${file.from}-${index}`}
                  className="border-b border-gray-700/50 hover:bg-gray-800/50 transition-colors"
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
                    <span className="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded text-xs font-medium">
                      {file.from}
                    </span>
                  </td>
                  <td className="p-3 text-gray-400 text-xs">
                    {file.timestamp ? new Date(file.timestamp).toLocaleString() : 'Just now'}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => handleDownload(file)}
                      className="btn-primary text-xs px-3 py-1"
                    >
                      ⬇️ Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}