/**
 * KNOX HUB - Backend Server
 * Node.js + Express + WebSocket
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
const PORT = process.env.PORT || 3000;
const ADMIN_NAME = 'KNOX_UZ';
const MAX_PER_GROUP = 8;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ════════════════════════════════════════
// IN-MEMORY DATABASE
// (Replace with PostgreSQL/MongoDB in production)
// ════════════════════════════════════════
const db = {
  users: {},          // { userId: UserObject }
  messages: {         // { room: [MessageObject] }
    A: [],
    B: [],
    DM: {}            // { 'userId1_userId2': [messages] }
  },
  rooms: {
    A: { id: 'A', name: 'Group Alpha', icon: '🅰️', leader: null, pinned: null, created: Date.now() },
    B: { id: 'B', name: 'Group Bravo', icon: '🅱️', leader: null, pinned: null, created: Date.now() }
  },
  online: {},         // { userId: timestamp }
  typing: { A: {}, B: {} },
  voiceRooms: { A: {}, B: {} },
  banList: new Set()
};

// WebSocket clients map
const clients = new Map(); // userId -> ws

// ════════════════════════════════════════
// EXPRESS + MIDDLEWARE
// ════════════════════════════════════════
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ════════════════════════════════════════
// FILE UPLOAD
// ════════════════════════════════════════
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // Allow all file types
    cb(null, true);
  }
});

// ════════════════════════════════════════
// REST API ROUTES
// ════════════════════════════════════════

// Upload files
app.post('/api/upload', upload.array('files', 10), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files uploaded' });

  const files = req.files.map(f => ({
    name: f.originalname,
    type: f.mimetype,
    url: `/uploads/${f.filename}`,
    size: f.size
  }));

  res.json({ files });
});

// Get room messages
app.get('/api/rooms/:room/messages', (req, res) => {
  const { room } = req.params;
  if (!['A', 'B'].includes(room)) return res.status(400).json({ error: 'Invalid room' });
  const msgs = (db.messages[room] || []).slice(-100); // Last 100 messages
  res.json({ messages: msgs });
});

// Get all users (admin only)
app.get('/api/users', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  // Simple admin check - use JWT in production
  if (adminKey !== ADMIN_NAME) return res.status(403).json({ error: 'Forbidden' });
  res.json({ users: Object.values(db.users) });
});

// Get room info
app.get('/api/rooms', (req, res) => {
  const rooms = Object.values(db.rooms).map(r => ({
    ...r,
    memberCount: Object.values(db.users).filter(u => u.group === r.id && !u.banned).length,
    onlineCount: Object.values(db.users).filter(u => u.group === r.id && db.online[u.id]).length
  }));
  res.json({ rooms });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    users: Object.keys(db.users).length,
    online: Object.keys(db.online).length,
    messagesA: db.messages.A.length,
    messagesB: db.messages.B.length
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ════════════════════════════════════════
// WEBSOCKET SERVER
// ════════════════════════════════════════
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(data, filter = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      if (filter && !filter(client)) return;
      client.send(msg);
    }
  });
}

function sendToUser(userId, data) {
  const client = clients.get(userId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  }
}

function broadcastToRoom(room, data, excludeUserId = null) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.userId === excludeUserId) return;
    const user = db.users[client.userId];
    if (!user) return;
    // Send to room members or admins
    if (user.group === room || user.isAdmin) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws, req) => {
  ws.userId = null;
  ws.room = null;
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (rawData) => {
    let data;
    try { data = JSON.parse(rawData.toString()); }
    catch(e) { return; }

    handleMessage(ws, data);
  });

  ws.on('close', () => {
    if (ws.userId) {
      delete db.online[ws.userId];
      clients.delete(ws.userId);

      // Remove from typing
      if (ws.room && db.typing[ws.room]) {
        delete db.typing[ws.room][ws.userId];
      }

      // Remove from voice rooms
      Object.keys(db.voiceRooms).forEach(room => {
        delete db.voiceRooms[room][ws.userId];
      });

      broadcast({ type: 'user_leave', userId: ws.userId });
      console.log(`User disconnected: ${ws.userId}`);
    }
  });

  ws.on('error', (err) => console.error('WS error:', err));

  // Send initial data
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      rooms: db.rooms,
      users: db.users,
      online: db.online,
      messages: db.messages
    }
  }));
});

function handleMessage(ws, data) {
  switch(data.type) {
    case 'auth': {
      const user = db.users[data.userId];
      if (!user) return;
      ws.userId = user.id;
      ws.room = user.group;
      clients.set(user.id, ws);
      db.online[user.id] = Date.now();

      broadcast({ type: 'user_join', user }, null);
      console.log(`User authenticated: ${user.name} (${user.id})`);
      break;
    }

    case 'register': {
      const user = data.user;
      if (!user?.id) return;

      // Validate group capacity
      if (user.group !== 'ADMIN') {
        const groupCount = Object.values(db.users).filter(u => u.group === user.group && !u.banned).length;
        if (groupCount >= MAX_PER_GROUP) {
          ws.send(JSON.stringify({ type: 'error', message: `Group ${user.group} is full` }));
          return;
        }
      }

      db.users[user.id] = user;
      db.online[user.id] = Date.now();
      ws.userId = user.id;
      ws.room = user.group;
      clients.set(user.id, ws);

      broadcast({ type: 'user_join', user });
      console.log(`New user registered: ${user.name} → Group ${user.group}`);
      break;
    }

    case 'message': {
      const { room, data: msg } = data;
      if (!ws.userId || !msg) return;

      const sender = db.users[ws.userId];
      if (!sender || sender.banned || sender.warnings >= 3) return;

      // Validate room access
      if (!sender.isAdmin && sender.group !== room) return;

      // Store message
      if (!db.messages[room]) db.messages[room] = [];
      db.messages[room].push(msg);

      // Keep last 500 messages per room
      if (db.messages[room].length > 500) {
        db.messages[room] = db.messages[room].slice(-500);
      }

      broadcastToRoom(room, { type: 'message', room, data: msg });
      console.log(`Message in room ${room} from ${sender.name}: ${msg.text?.slice(0,50)}`);
      break;
    }

    case 'typing': {
      const { room, userId, userName, isTyping } = data;
      if (!room || !userId) return;

      if (!db.typing[room]) db.typing[room] = {};
      if (isTyping) db.typing[room][userId] = userName;
      else delete db.typing[room][userId];

      broadcastToRoom(room, { type: 'typing', room, userId, userName, isTyping }, userId);
      break;
    }

    case 'join_room': {
      ws.room = data.room;
      break;
    }

    case 'reaction': {
      const { room, msgId, emoji, userId } = data;
      if (!room || !msgId) return;

      const msg = db.messages[room]?.find(m => m.id === msgId);
      if (!msg) return;

      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

      const idx = msg.reactions[emoji].indexOf(userId);
      if (idx > -1) msg.reactions[emoji].splice(idx, 1);
      else msg.reactions[emoji].push(userId);

      broadcastToRoom(room, { type: 'reaction', room, msgId, emoji, userId });
      break;
    }

    case 'delete': {
      const { room, msgId } = data;
      if (!room || !msgId) return;

      const sender = db.users[ws.userId];
      const msgIdx = db.messages[room]?.findIndex(m => m.id === msgId);

      if (msgIdx === -1 || msgIdx === undefined) return;

      const msg = db.messages[room][msgIdx];

      // Only owner or admin can delete
      if (msg.userId !== ws.userId && !sender?.isAdmin) return;

      db.messages[room].splice(msgIdx, 1);
      broadcastToRoom(room, { type: 'delete', room, msgId });
      break;
    }

    case 'highlight': {
      const { room, msgId } = data;
      const sender = db.users[ws.userId];
      if (!sender?.isAdmin && !isLeader(ws.userId, room)) return;

      const msg = db.messages[room]?.find(m => m.id === msgId);
      if (msg) {
        msg.highlighted = !msg.highlighted;
        broadcastToRoom(room, { type: 'highlight', room, msgId });
      }
      break;
    }

    case 'pin': {
      const { room, message } = data;
      const sender = db.users[ws.userId];
      if (!sender?.isAdmin && !isLeader(ws.userId, room)) return;

      db.rooms[room].pinned = message;
      broadcastToRoom(room, { type: 'pin', room, message });
      break;
    }

    case 'broadcast': {
      const sender = db.users[ws.userId];
      if (!sender?.isAdmin) return;

      const { target, data: msg } = data;
      const rooms = target === 'all' ? ['A', 'B'] : [target];

      rooms.forEach(room => {
        db.messages[room] = db.messages[room] || [];
        db.messages[room].push(msg);
        broadcastToRoom(room, { type: 'message', room, data: msg });
      });
      break;
    }

    case 'warning': {
      const { targetId, warnings } = data;
      const sender = db.users[ws.userId];
      if (!sender?.isAdmin) return;

      const target = db.users[targetId];
      if (!target) return;

      target.warnings = Math.max(0, Math.min(3, warnings));
      if (target.warnings >= 3) target.banned = true;

      broadcast({ type: 'warning', targetId, warnings: target.warnings });
      break;
    }

    case 'kick': {
      const sender = db.users[ws.userId];
      if (!sender?.isAdmin) return;

      const { targetId } = data;
      broadcast({ type: 'kick', targetId });
      delete db.online[targetId];

      const targetWs = clients.get(targetId);
      if (targetWs) setTimeout(() => targetWs.close(), 500);
      break;
    }

    case 'ban': {
      const sender = db.users[ws.userId];
      if (!sender?.isAdmin) return;

      const { targetId, banned } = data;
      const target = db.users[targetId];
      if (target) {
        target.banned = banned;
        if (banned) delete db.online[targetId];
      }

      broadcast({ type: 'ban', targetId, banned });
      break;
    }

    case 'leader_assign': {
      const sender = db.users[ws.userId];
      if (!sender?.isAdmin) return;

      const { room, userId } = data;
      if (db.rooms[room]) {
        db.rooms[room].leader = userId;
        broadcast({ type: 'leader_assign', room, userId });
      }
      break;
    }

    case 'dm': {
      const { targetId, data: msg } = data;
      if (!ws.userId || !targetId) return;

      const key = [ws.userId, targetId].sort().join('_');
      if (!db.messages.DM[key]) db.messages.DM[key] = [];
      db.messages.DM[key].push(msg);

      // Send to target
      sendToUser(targetId, { type: 'dm', fromId: ws.userId, data: msg });
      break;
    }

    case 'voice_join': {
      const { room, userId, userName } = data;
      if (!db.voiceRooms[room]) db.voiceRooms[room] = {};
      db.voiceRooms[room][userId] = { userId, userName, muted: false };
      broadcastToRoom(room, { type: 'voice_join', room, userId, userName });
      break;
    }

    case 'voice_leave': {
      const { room, userId } = data;
      if (db.voiceRooms[room]) delete db.voiceRooms[room][userId];
      broadcastToRoom(room, { type: 'voice_leave', room, userId });
      break;
    }

    case 'voice_mute': {
      const { room, userId, muted } = data;
      if (db.voiceRooms[room]?.[userId]) {
        db.voiceRooms[room][userId].muted = muted;
      }
      broadcastToRoom(room, { type: 'voice_mute', room, userId, muted }, userId);
      break;
    }

    case 'webrtc_offer':
    case 'webrtc_answer':
    case 'webrtc_ice': {
      // Forward WebRTC signaling directly to target peer
      const { targetId } = data;
      if (targetId) sendToUser(targetId, { ...data, fromId: ws.userId });
      break;
    }

    case 'ping': {
      if (ws.userId) db.online[ws.userId] = Date.now();
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }

    case 'logout': {
      const { userId } = data;
      delete db.online[userId];
      clients.delete(userId);
      broadcast({ type: 'user_leave', userId });
      break;
    }
  }
}

// ════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════
function isLeader(userId, room) {
  return db.rooms[room]?.leader === userId;
}

// ════════════════════════════════════════
// HEARTBEAT
// ════════════════════════════════════════
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });

  // Clean stale online status (>2 min no ping)
  const now = Date.now();
  Object.keys(db.online).forEach(userId => {
    if (now - db.online[userId] > 120000) {
      delete db.online[userId];
    }
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ════════════════════════════════════════
// START
// ════════════════════════════════════════
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║           KNOX HUB SERVER            ║
╠══════════════════════════════════════╣
║  Port   : ${PORT}                        ║
║  Status : Running ✓                  ║
║  WS     : ws://localhost:${PORT}/ws     ║
║  HTTP   : http://localhost:${PORT}      ║
╚══════════════════════════════════════╝
  `);
});
