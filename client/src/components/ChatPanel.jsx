import { useState, useEffect, useRef } from 'react';

export default function ChatPanel({ nickname, users }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [selectedUser, setSelectedUser] = useState('all');
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  useEffect(() => {
    // Listen for chat messages
    if (window.electronAPI?.onMessage) {
      window.electronAPI.onMessage((data) => {
        if (data.type === 'chat') {
          setMessages(prev => [...prev, {
            id: Date.now() + Math.random(),
            from: data.from,
            text: data.text,
            timestamp: new Date(),
            type: 'public'
          }]);
        } else if (data.type === 'privateMessage') {
          setMessages(prev => [...prev, {
            id: Date.now() + Math.random(),
            from: data.from,
            to: data.to,
            text: data.text,
            timestamp: new Date(),
            type: 'private'
          }]);
        } else if (data.type === 'system') {
          setMessages(prev => [...prev, {
            id: Date.now() + Math.random(),
            text: data.text,
            timestamp: new Date(),
            type: 'system'
          }]);
        } else if (data.type === 'typing') {
          setTypingUsers(prev => new Set([...prev, data.from]));
          setTimeout(() => {
            setTypingUsers(prev => {
              const next = new Set(prev);
              next.delete(data.from);
              return next;
            });
          }, 3000);
        }
      });
    }

    // Add welcome message
    setMessages([{
      id: 'welcome',
      text: `Welcome ${nickname}! Start chatting with other users.`,
      timestamp: new Date(),
      type: 'system'
    }]);
  }, [nickname]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);

    // Emit typing indicator
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

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Stop typing after 2 seconds of inactivity
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

    // Send message via electron API
    if (window.electronAPI?.sendMessage) {
      window.electronAPI.sendMessage(message);
    }

    // Add to local messages
    setMessages(prev => [...prev, {
      id: Date.now() + Math.random(),
      from: nickname,
      to: selectedUser === 'all' ? undefined : selectedUser,
      text: input.trim(),
      timestamp: new Date(),
      type: selectedUser === 'all' ? 'public' : 'private',
      isMine: true
    }]);

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

  const formatDate = (date) => {
    const today = new Date();
    const messageDate = new Date(date);
    
    if (messageDate.toDateString() === today.toDateString()) {
      return 'Today';
    }
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (messageDate.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    
    return messageDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const filteredMessages = selectedUser === 'all' 
    ? messages.filter(m => m.type === 'public' || m.type === 'system')
    : messages.filter(m => 
        m.type === 'system' || 
        (m.type === 'private' && (m.from === selectedUser || m.to === selectedUser))
      );

  // Group messages by date
  const groupedMessages = filteredMessages.reduce((groups, msg) => {
    const date = formatDate(msg.timestamp);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(msg);
    return groups;
  }, {});

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
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        {Object.keys(groupedMessages).length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-6xl mb-4 opacity-20">💭</div>
            <p className="text-lg font-medium mb-1">
              {selectedUser === 'all' 
                ? 'No messages yet' 
                : `Start chatting with ${selectedUser}`
              }
            </p>
            <p className="text-sm text-gray-600">
              {selectedUser === 'all'
                ? 'Be the first to say something!'
                : 'Your messages are end-to-end encrypted'
              }
            </p>
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date}>
              {/* Date Separator */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-800"></div>
                <span className="text-xs text-gray-500 font-medium px-2">
                  {date}
                </span>
                <div className="flex-1 h-px bg-gray-800"></div>
              </div>

              {/* Messages for this date */}
              {msgs.map((msg) => (
                <div key={msg.id}>
                  {msg.type === 'system' ? (
                    <div className="flex justify-center py-2">
                      <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1.5 rounded-full border border-gray-700">
                        ℹ️ {msg.text}
                      </span>
                    </div>
                  ) : (
                    <div className={`flex mb-3 ${msg.isMine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] ${msg.isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                        {/* Sender info */}
                        {!msg.isMine && (
                          <div className="flex items-center gap-2 mb-1 px-1">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
                              {msg.from.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs font-semibold text-indigo-400">
                              {msg.from}
                            </span>
                            <span className="text-xs text-gray-600">
                              {formatTime(msg.timestamp)}
                            </span>
                          </div>
                        )}
                        
                        {/* Message bubble */}
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
                          
                          {/* Message footer */}
                          <div className={`flex items-center gap-2 mt-1 ${
                            msg.isMine ? 'justify-end' : 'justify-start'
                          }`}>
                            {msg.type === 'private' && (
                              <span className="text-xs opacity-75">🔒</span>
                            )}
                            {msg.isMine && (
                              <span className="text-xs opacity-75">
                                {formatTime(msg.timestamp)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
        
        {/* Typing indicator */}
        {typingUsers.size > 0 && selectedUser === 'all' && (
          <div className="flex items-center gap-2 text-gray-500 text-sm px-1">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
            <span>
              {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
            </span>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder={
              selectedUser === 'all' 
                ? 'Type a message...' 
                : `Message ${selectedUser}...`
            }
            className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-sm"
            maxLength={500}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all shadow-lg disabled:shadow-none flex items-center gap-2"
          >
            <span className="text-lg">📤</span>
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
        
        {/* Character count and info */}
        <div className="flex items-center justify-between mt-2 px-1">
          <div className="text-xs text-gray-600">
            {selectedUser !== 'all' && (
              <span className="flex items-center gap-1">
                🔒 End-to-end encrypted
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600">
            {input.length}/500
          </div>
        </div>
      </div>

      {/* No users warning */}
      {onlineUsers.length === 0 && (
        <div className="px-4 pb-3">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center">
            <p className="text-xs text-amber-400">
              ⚠️ No other users online. Messages will be visible when others connect.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}