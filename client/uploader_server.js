// uploader_server.js
const fs = require("fs");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const path = require("path");

const PORT = 4000;
const DOWNLOAD_SECRET = process.env.DOWNLOAD_SECRET || "download_secret_dev";
const CHUNK_SIZE = 64 * 1024; // 64KB

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`Uploader peer server listening ws://localhost:${PORT}`);
});

wss.on('connection', (ws) => {
  console.log('Peer connected');
  let engaged = false;

  ws.on('message', async (raw) => {
    if (engaged) return; // already serving

    let req;
    try {
      req = JSON.parse(raw.toString());
    } catch (err) {
      console.error('Invalid JSON from peer; closing');
      ws.close();
      return;
    }

    if (req.type !== 'downloadRequest' || !req.fileHash || !req.token) {
      console.error('Bad request, closing');
      ws.close();
      return;
    }

    // Verify token
    try {
      const decoded = jwt.verify(req.token, DOWNLOAD_SECRET);
      if (decoded.fileHash !== req.fileHash) {
        throw new Error('fileHash mismatch');
      }
      // token ok
      console.log(`Token valid for file ${req.fileHash}`);
    } catch (err) {
      console.error('Token invalid/expired:', err.message);
      ws.send(JSON.stringify({ type: 'error', text: 'Invalid or expired token' }));
      ws.close();
      return;
    }

    // locate encrypted file (.enc) — adjust path as needed
    const encPath = path.join(__dirname, 'downloads', `${req.fileHash}.enc`);
    if (!fs.existsSync(encPath)) {
      ws.send(JSON.stringify({ type: 'error', text: 'File not available on uploader' }));
      ws.close();
      return;
    }

    engaged = true;
    const stats = fs.statSync(encPath);
    const totalChunks = Math.max(1, Math.ceil(stats.size / CHUNK_SIZE));
    const readStream = fs.createReadStream(encPath, { highWaterMark: CHUNK_SIZE });
    let current = 0;

    readStream.on('data', (chunk) => {
      current++;
      const payload = {
        type: 'fileChunk',
        current,
        total: totalChunks,
        chunk: chunk.toString('base64'),
      };
      ws.send(JSON.stringify(payload));
    });

    readStream.on('end', () => {
      ws.send(JSON.stringify({ type: 'fileComplete', fileHash: req.fileHash }));
      console.log(`Finished sending ${req.fileHash}`);
    });

    readStream.on('error', (err) => {
      console.error('Stream error:', err.message);
      ws.close();
    });
  });

  ws.on('close', () => {
    console.log('Peer disconnected');
  });

  ws.on('error', (err) => {
    console.error('Peer socket error:', err.message);
  });
});
