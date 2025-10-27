# 🔒 DC Clone - Secure P2P File Sharing

> A secure, peer-to-peer file sharing application with end-to-end encryption. Share files directly between devices with military-grade encryption, built with WebSockets, React, and Electron.

## ✨ Features

### 🔐 Security First
- **AES-256-CBC Encryption** - Military-grade file encryption
- **RSA-2048 Key Exchange** - Secure public key cryptography
- **End-to-End Encrypted** - Files never exposed to hub server
- **Automatic Key Rotation** - Keys rotated on access revocation
- **SHA-256 Verification** - File integrity checking

### 🚀 Performance
- **P2P File Transfer** - Direct transfers between peers
- **Resume/Pause Downloads** - Never lose progress
- **Chunked Transfer** - Efficient large file handling
- **Real-time Progress** - Live download/upload tracking

### 💬 Communication
- **Public Chat** - Group messaging
- **Private Messaging** - Encrypted 1-on-1 chat
- **Typing Indicators** - See when others are typing
- **User Presence** - Real-time online status

### 🎯 User Experience
- **Cross-Platform** - Windows, macOS, Linux
- **Modern UI** - Beautiful React + TailwindCSS interface
- **Drag & Drop** - Easy folder selection
- **Activity Logs** - Track all file operations
- **Audit Trail** - Complete operation history

---

## 🖼️ Screenshots

<table>
  <tr>
    <td><img src="images\Screenshot 2025-10-27 180909.png" alt="Login"/></td>
    <td><img src="images\Screenshot 2025-10-27 180956.png" alt="Files"/></td>
  </tr>
  <tr>
    <td align="center"><b>🔐 Secure Login</b></td>
    <td align="center"><b>📁 File Management</b></td>
  </tr>
  <tr>
    <td><img src="images\Screenshot 2025-10-27 181004.png" alt="Downloads"/></td>
    <td><img src="images\Screenshot 2025-10-27 181014.png" alt="Chat"/></td>
  </tr>
  <tr>
    <td align="center"><b>⬇️ Download Manager</b></td>
    <td align="center"><b>💬 Real-time Chat</b></td>
  </tr>
</table>


## 🏗️ Architecture

```
┌─────────────────┐                                    ┌─────────────────┐
│                 │         WebSocket (Control)        │                 │
│   Client A      │◄──────────────────────────────────►│   Hub Server    │
│   (Electron)    │                                    │   (Node.js)     │
│                 │                                    │                 │
└────────┬────────┘                                    └────────▲────────┘
         │                                                      │
         │                                                      │
         │            P2P WebSocket                             │
         │         (File Transfer Direct)                       │
         │                                                      │
         ▼                                                      │
┌─────────────────┐         WebSocket (Control)        ┌──────┴──────────┐
│                 │◄──────────────────────────────────►│                 │
│   Client B      │                                    │                 │
│   (Electron)    │                                    │                 │
│                 │                                    │                 │
└─────────────────┘                                    └─────────────────┘
```

### Components

- **Hub Server**: Central coordinator for user discovery, key exchange, and messaging
- **Client App**: Electron desktop application with React UI
- **P2P Connection**: Direct WebSocket connection for encrypted file transfers
- **SQLite Database**: Stores file metadata, user keys, and audit logs

### Data Flow

1. **Registration**: Client generates RSA key pair, sends public key to hub
2. **File Sharing**: Owner encrypts file with AES, encrypts AES key with recipient's RSA public key
3. **Discovery**: Hub provides download tokens and peer addresses
4. **Transfer**: Direct P2P WebSocket transfer of encrypted file chunks
5. **Decryption**: Recipient decrypts file using their RSA private key

---

## 🔐 Security Model

### Encryption Layers

```
┌──────────────────────────────────────────┐
│  File Content (Your Data)                │
├──────────────────────────────────────────┤
│  AES-256-CBC Encryption                  │  ← Symmetric encryption
├──────────────────────────────────────────┤
│  RSA-2048 Key Wrapping                   │  ← Asymmetric encryption
├──────────────────────────────────────────┤
│  WebSocket TLS Transport                 │  ← Transport security
└──────────────────────────────────────────┘
```

### What's Encrypted

✅ **File Contents** - AES-256-CBC with random IV  
✅ **Encryption Keys** - RSA-2048 public key encryption  
✅ **Private Messages** - End-to-end encrypted  
✅ **File Chunks** - Verified with SHA-256 hashes  

### What Hub Can See

- Usernames (nicknames)
- File metadata (names, sizes, hashes)
- Who's sharing with whom
- Connection status

### What Hub CANNOT See

❌ File contents (encrypted)  
❌ Private keys (never leave device)  
❌ Decrypted messages  
❌ Your local folder structure  

---

## 💻 For Developers

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm (comes with Node.js)
- Git

### Installation

```bash
# Clone repository
git clone https://github.com/ItsAbir005/DC-.git
cd dc-clone

# Install hub dependencies
cd hub
npm install

# Install client dependencies
cd ../client
npm install
```

### Running Locally

**Terminal 1 - Hub Server:**
```bash
cd hub
npm start
# Hub runs on http://localhost:8080
```

**Terminal 2 - Client App:**
```bash
cd client
npm run electron:dev
# Opens Electron app with hot reload
```

### Building for Production

```bash
cd client

# Build for current platform
npm run package

# Build for specific platforms
npm run package:win      # Windows (.exe)
npm run package:mac      # macOS (.dmg)
npm run package:linux    # Linux (.AppImage, .deb)
```

Output in `client/dist/`

### Project Structure

```
dc-clone/
├── hub/                      # Hub server
│   ├── hub.js               # Main WebSocket server
│   ├── db.js                # SQLite database
│   └── middleware/          # Server middleware
├── client/                   # Client application
│   ├── electron/            # Electron main process
│   ├── src/                 # React UI components
│   ├── controllers/         # Business logic
│   ├── middleware/          # Client middleware
│   ├── utils/               # Crypto utilities
│   └── uploaderServer.js    # P2P upload server
├── docs/                     # Documentation
└── README.md
```

---

## 🛠️ Tech Stack

### Hub Server
- **Runtime**: Node.js 18+
- **WebSocket**: ws (WebSocket library)
- **Database**: SQLite (better-sqlite3)
- **Auth**: JWT (jsonwebtoken)
- **Crypto**: Node.js built-in crypto

### Client Application
- **Framework**: Electron 28
- **UI**: React 18 + Vite
- **Styling**: TailwindCSS 3
- **State**: React Hooks
- **Crypto**: Node.js crypto API

---

## 🤝 Contributing

We love contributions! Here's how you can help:

1. **🍴 Fork** the repository
2. **🔧 Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **💻 Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **📤 Push** to branch (`git push origin feature/amazing-feature`)
5. **🎉 Open** a Pull Request

### Good First Issues

Look for issues tagged with `good-first-issue` - perfect for newcomers!

---

## 🗺️ Roadmap

### Version 1.1 (Next)
- [ ] Web-based client (browser version)
- [ ] File compression before encryption
- [ ] Bandwidth throttling controls
- [ ] Multi-language support

### Version 1.2
- [ ] Group file sharing
- [ ] File synchronization
- [ ] Mobile apps (React Native)
- [ ] Voice/video chat

### Future
- [ ] Blockchain-based file verification
- [ ] Distributed hub network
- [ ] IPFS integration
- [ ] Zero-knowledge proofs


---

## 🐛 Known Issues

- File sharing limited to 5GB per file (by design)
- P2P transfer requires both users online simultaneously
- Port 4000 must be available for uploads
- Large files may use significant memory

---

## 📊 Benchmarks

| File Size | Transfer Speed* | Memory Usage |
|-----------|----------------|--------------|
| 10 MB     | ~8-12 MB/s     | ~50 MB       |
| 100 MB    | ~15-25 MB/s    | ~100 MB      |
| 1 GB      | ~20-30 MB/s    | ~200 MB      |
| 5 GB      | ~25-35 MB/s    | ~400 MB      |

*Speeds vary based on network conditions and hardware

---

## ❓ FAQ

<details>
<summary><b>Is this really secure?</b></summary>

Yes! Files are encrypted with AES-256 (military-grade) before leaving your device. The hub server never sees your unencrypted files or private keys.
</details>

<details>
<summary><b>Do I need to open ports?</b></summary>

Port 4000 should be open for P2P uploads. Most home routers allow this by default. For strict firewalls, configure port forwarding.
</details>

<details>
<summary><b>Can I run my own hub?</b></summary>

Absolutely! The hub is just a Node.js server. Deploy to any cloud provider or run locally. See deployment docs.
</details>

<details>
<summary><b>What happens if hub goes down?</b></summary>

Active transfers continue (P2P), but you can't discover new users or request new downloads. Connect to a different hub.
</details>

<details>
<summary><b>Is there a file size limit?</b></summary>

Soft limit of 5GB per file to ensure stability. This can be increased in configuration.
</details>

---

## 📜 License

This project is licensed under the **MIT License** - see [LICENSE](LICENSE) file for details.

```
MIT License - you are free to use, modify, and distribute this software.
```

---

## 🙏 Acknowledgments

- Inspired by **DC++** and modern P2P protocols
- Built with open-source libraries (thank you!)
- Security best practices from **OWASP** guidelines
- UI/UX inspiration from modern messaging apps

### Special Thanks

- All contributors who make this project better
- Early testers who provided valuable feedback
- Open source community for amazing tools

---