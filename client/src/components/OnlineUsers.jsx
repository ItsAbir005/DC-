// client/src/components/OnlineUsers.jsx
export default function OnlineUsers({ users }) {
  return (
    <div className="panel h-full">
      <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        👥 Online Users
        {users.length > 0 && (
          <span className="text-sm font-normal text-gray-400 bg-gray-800 px-2 py-1 rounded">
            {users.length}
          </span>
        )}
      </h2>
      
      <div className="space-y-2 overflow-y-auto h-[calc(100%-40px)]">
        {users.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No users online</p>
        ) : (
          users.map((user, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-indigo-500/50 transition-all duration-200"
            >
              {/* Avatar */}
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center text-lg font-bold shadow-lg relative">
                {user.nickname[0].toUpperCase()}
                {/* Online indicator */}
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 rounded-full border-2 border-gray-800"></div>
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{user.nickname}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  {user.publicKey ? (
                    <>🔐 <span>Verified</span></>
                  ) : (
                    <>⚠️ <span>No key</span></>
                  )}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}