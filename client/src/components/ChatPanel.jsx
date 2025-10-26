// client/src/components/ChatPanel.jsx
import { useState, useEffect, useRef } from 'react';

export default function ChatPanel({ nickname, users, messages = [], onAddMessage, typingUsers = new Set() }) {
  const [input, setInput] = useState('');
  const [selectedUser, setSelectedUser] = useState('all');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const welcomeAddedRef = useRef(false);

  // Add welcome message only once
  useEffect(() => {
    if (messages.length === 0 && !welcomeAddedRef.current) {
      welcomeAddedRef.current = true;
      onAddMessage({
        id: `welcome-${nickname}-${Date.now()}`,
        text: `Welcome ${nickname}! Start chatting with other users.`,
        timestamp: new Date(),
        type: 'system'
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);

    if (!isTyping) {
      setIsTyping(true);
      if (window.electronAPI?.sendMessage) {
        window.electronAPI.sendMessage({
          type: 'typing',
          from: nickname,
          to: selectedUser === 'all' ? undefined : selectedUser
        });
      }
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2000);
  };

  const handleSend = () => {
    if (!input.trim()) return;

    const message = {
      type: selectedUser === 'all' ? 'message' : 'privateMessage',
      text: input.trim(),
      from: nickname
    };

    if (selectedUser !== 'all') {
      message.to = selectedUser;
    }

    if (window.electronAPI?.sendMessage) {
      window.electronAPI.sendMessage(message);
    }

    onAddMessage({
      id: Date.now() + Math.random(),
      from: nickname,
      to: selectedUser === 'all' ? undefined : selectedUser,
      text: input.trim(),
      timestamp: new Date(),
      type: selectedUser === 'all' ? 'public' : 'private',
      isMine: true
    });

    setInput('');
    setIsTyping(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const filteredMessages = selectedUser === 'all' 
    ? messages.filter(m => m.type === 'public' || m.type === 'system')
    : messages.filter(m => 
        m.type === 'system' || 
        (m.type === 'private' && (m.from === selectedUser || m.to === selectedUser))
      );

  const onlineUsers = users.filter(u => u.nickname !== nickname);

  return (
    <div className="panel h-full flex flex-col bg-gray-900 border border-gray-800 rounded-xl shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="text-2xl">💬</div>
          <div>
            <h2 className="text-lg font-bold text-white">Chat</h2>
            {selectedUser === 'all' ? (
              <p className="text-xs text-gray-500">Public channel</p>
            ) : (
              <p className="text-xs text-indigo-400">Private with {selectedUser}</p>
            )}
          </div>
        </div>
        
        <select
          value={selectedUser}
          onChange={(e) => setSelectedUser(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">📢 Public Chat</option>
          {onlineUsers.length > 0 && (
            <>
              <option disabled>───────────</option>
              {onlineUsers.map(user => (
                <option key={user.nickname} value={user.nickname}>
                  🔒 {user.nickname}
                </option>
              ))}
            </>
          )}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-6xl mb-4 opacity-20">💭</div>
            <p className="text-lg font-medium mb-1">
              {selectedUser === 'all' ? 'No messages yet' : `Chat with ${selectedUser}`}
            </p>
            <p className="text-sm text-gray-600">
              {selectedUser === 'all' ? 'Be the first to say something!' : 'Messages are encrypted'}
            </p>
          </div>
        ) : (
          filteredMessages.map((msg) => (
            <div key={msg.id}>
              {msg.type === 'system' ? (
                <div className="flex justify-center py-2">
                  <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700">
                    ℹ️ {msg.text}
                  </span>
                </div>
              ) : (
                <div className={`flex mb-2 ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] ${msg.isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                    {!msg.isMine && (
                      <div className="flex items-center gap-2 mb-1 px-1">
                        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                          {msg.from.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-xs font-semibold text-indigo-400">
                          {msg.from}
                        </span>
                      </div>
                    )}
                    
                    <div className={`px-4 py-2.5 rounded-2xl shadow-lg ${
                      msg.isMine
                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-br-md'
                        : msg.type === 'private'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-bl-md'
                        : 'bg-gray-800 text-gray-200 border border-gray-700 rounded-bl-md'
                    }`}>
                      <p className="text-sm break-words whitespace-pre-wrap leading-relaxed">
                        {msg.text}
                      </p>
                      
                      <div className={`flex items-center gap-2 mt-1 text-xs opacity-75 ${
                        msg.isMine ? 'justify-end' : 'justify-start'
                      }`}>
                        {msg.type === 'private' && <span>🔒</span>}
                        <span>{formatTime(msg.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        
        {typingUsers.size > 0 && selectedUser === 'all' && (
          <div className="flex items-center gap-2 text-gray-500 text-sm px-1">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
            </div>
            <span>{Array.from(typingUsers).join(', ')} typing...</span>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder={selectedUser === 'all' ? 'Type a message...' : `Message ${selectedUser}...`}
            className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            maxLength={500}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all shadow-lg"
          >
            📤
          </button>
        </div>
        
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-xs text-gray-600">
            {selectedUser !== 'all' && '🔒 End-to-end encrypted'}
          </span>
          <span className="text-xs text-gray-600">{input.length}/500</span>
        </div>
      </div>
    </div>
  );
}