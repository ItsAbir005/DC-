import { useState, useEffect } from 'react';

export default function DownloadManager() {
  const [downloads, setDownloads] = useState([]);
  const [completedDownloads, setCompletedDownloads] = useState([]);

  useEffect(() => {
    // Listen for download progress updates
    window.electronAPI.onDownloadProgress((data) => {
      setDownloads(prev => {
        const existing = prev.find(d => d.fileHash === data.fileHash);
        
        if (existing) {
          // Update existing download
          return prev.map(d => 
            d.fileHash === data.fileHash 
              ? { ...d, ...data, lastUpdate: Date.now() }
              : d
          );
        } else {
          // Add new download
          return [...prev, { ...data, lastUpdate: Date.now() }];
        }
      });
    });

    // Listen for download completion
    window.electronAPI.onDownloadComplete?.((data) => {
      console.log('✅ Download complete event:', data);
      
      // Remove from active downloads
      setDownloads(prev => prev.filter(d => d.fileHash !== data.fileHash));
      
      // Add to completed downloads with file path
      setCompletedDownloads(prev => [{
        fileHash: data.fileHash,
        fileName: data.fileName,
        filePath: data.outputPath, // This contains the absolute path
        completedAt: Date.now(),
        status: 'completed'
      }, ...prev]);
    });

    // Listen for download errors
    window.electronAPI.onDownloadError?.((data) => {
      setDownloads(prev => 
        prev.map(d => 
          d.fileHash === data.fileHash
            ? { ...d, status: 'error', error: data.error }
            : d
        )
      );
    });
  }, []);

  const handleOpenFile = async (download) => {
    try {
      console.log('📂 Opening file:', download.filePath);
      const result = await window.electronAPI.openFile(download.filePath);
      if (!result.success) {
        alert(`Failed to open file: ${result.error}`);
      }
    } catch (error) {
      console.error('Error opening file:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handleShowInFolder = async (download) => {
    try {
      console.log('📁 Showing file in folder:', download.filePath);
      const result = await window.electronAPI.showFileInFolder(download.filePath);
      if (!result.success) {
        alert(`Failed to show file: ${result.error}`);
      }
    } catch (error) {
      console.error('Error showing file:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const handlePause = (fileHash) => {
    window.electronAPI.pauseDownload?.(fileHash);
    setDownloads(prev => 
      prev.map(d => 
        d.fileHash === fileHash
          ? { ...d, status: 'paused' }
          : d
      )
    );
  };

  const handleResume = (fileHash) => {
    window.electronAPI.resumeDownload?.(fileHash);
    setDownloads(prev => 
      prev.map(d => 
        d.fileHash === fileHash
          ? { ...d, status: 'downloading' }
          : d
      )
    );
  };

  const handleCancel = (fileHash) => {
    window.electronAPI.cancelDownload?.(fileHash);
    setDownloads(prev => prev.filter(d => d.fileHash !== fileHash));
  };

  const handleRemoveCompleted = (fileHash) => {
    setCompletedDownloads(prev => prev.filter(d => d.fileHash !== fileHash));
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond) => {
    return formatBytes(bytesPerSecond) + '/s';
  };

  const calculateETA = (downloaded, total, speed) => {
    if (speed === 0) return 'Calculating...';
    const remaining = total - downloaded;
    const seconds = remaining / speed;
    
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
  };

  const formatTimeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const activeDownloads = downloads.filter(d => 
    d.status === 'downloading' || d.status === 'paused'
  );

  if (downloads.length === 0 && completedDownloads.length === 0) {
    return (
      <div className="panel h-full flex flex-col">
        <h2 className="text-lg font-bold text-white mb-4">📥 Downloads</h2>
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
          <div className="text-8xl mb-6 opacity-20">📥</div>
          <p className="text-xl font-medium mb-2">No downloads yet</p>
          <p className="text-sm text-gray-600">Downloaded files will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel h-full flex flex-col">
      <h2 className="text-lg font-bold text-white mb-4">
        📥 Downloads
        {activeDownloads.length > 0 && (
          <span className="ml-2 text-sm font-normal text-indigo-400">
            ({activeDownloads.length} active)
          </span>
        )}
      </h2>

      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Active Downloads */}
        {activeDownloads.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-3">Active Downloads</h3>
            <div className="space-y-3">
              {activeDownloads.map((download) => (
                <div
                  key={download.fileHash}
                  className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-all"
                >
                  {/* File Info */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-white font-medium truncate">
                        📄 {download.fileName}
                      </h3>
                      <p className="text-sm text-gray-400">
                        From: <span className="text-indigo-400">{download.uploader}</span>
                      </p>
                    </div>
                    
                    {/* Status Badge */}
                    <div className={`px-3 py-1 rounded-full text-xs font-medium ml-3 ${
                      download.status === 'downloading' 
                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        : download.status === 'paused'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {download.status === 'downloading' && '⬇️ Downloading'}
                      {download.status === 'paused' && '⏸️ Paused'}
                      {download.status === 'completed' && '✅ Complete'}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span>{Math.round(download.progress || 0)}%</span>
                      <span>
                        {formatBytes(download.downloaded || 0)} / {formatBytes(download.total || 0)}
                      </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          download.status === 'downloading'
                            ? 'bg-gradient-to-r from-blue-500 to-indigo-500'
                            : 'bg-amber-500'
                        }`}
                        style={{ width: `${download.progress || 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Download Stats */}
                  {download.status === 'downloading' && (
                    <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
                      <div className="flex items-center gap-1">
                        <span>🚀</span>
                        <span>{formatSpeed(download.speed || 0)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>⏱️</span>
                        <span>
                          ETA: {calculateETA(
                            download.downloaded || 0,
                            download.total || 1,
                            download.speed || 0
                          )}
                        </span>
                      </div>
                      {download.chunksReceived && (
                        <div className="flex items-center gap-1">
                          <span>📦</span>
                          <span>
                            {download.chunksReceived}/{download.totalChunks} chunks
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    {download.status === 'downloading' && (
                      <button
                        onClick={() => handlePause(download.fileHash)}
                        className="flex-1 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg text-sm font-medium transition-all border border-amber-500/30"
                      >
                        ⏸️ Pause
                      </button>
                    )}
                    
                    {download.status === 'paused' && (
                      <button
                        onClick={() => handleResume(download.fileHash)}
                        className="flex-1 px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg text-sm font-medium transition-all border border-blue-500/30"
                      >
                        ▶️ Resume
                      </button>
                    )}
                    
                    <button
                      onClick={() => handleCancel(download.fileHash)}
                      className="flex-1 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-all border border-red-500/30"
                    >
                      ❌ Cancel
                    </button>
                  </div>

                  {/* Error Message */}
                  {download.error && (
                    <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-red-400 text-sm">
                      ⚠️ {download.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed Downloads */}
        {completedDownloads.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-3">
              ✅ Completed ({completedDownloads.length})
            </h3>
            
            <div className="space-y-2">
              {completedDownloads.map((download) => (
                <div
                  key={download.fileHash}
                  className="bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/30 hover:bg-emerald-500/15 transition-all group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-emerald-400 font-medium truncate">
                        ✅ {download.fileName}
                      </h3>
                      <p className="text-xs text-gray-400 mt-1">
                        Completed {formatTimeAgo(download.completedAt)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenFile(download)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1"
                        title="Open file"
                      >
                        📂 Open
                      </button>
                      <button
                        onClick={() => handleShowInFolder(download)}
                        className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
                        title="Show in folder"
                      >
                        📁
                      </button>
                      <button
                        onClick={() => handleRemoveCompleted(download.fileHash)}
                        className="text-gray-500 hover:text-red-400 transition-colors px-2"
                        title="Remove from list"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}