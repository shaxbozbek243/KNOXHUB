# 🔐 KNOX HUB — Deployment Guide

## 📁 Project Structure

```
knox-hub/
├── public/
│   └── index.html          ← Full frontend (single file)
├── server/
│   └── server.js           ← Node.js WebSocket backend
├── uploads/                ← Auto-created for file uploads
└── package.json
```

---

## 🚀 Quick Start (Local)

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
# or for development with auto-restart:
npm run dev
```

### 3. Open browser
```
http://localhost:3000
```

---

## 👑 Admin Access

To log in as admin:
- **Name**: `KNOX_UZ`  
- **Roblox Nickname**: anything  
- **Group**: any (admin bypasses groups)

The admin panel will appear in the sidebar automatically.

---

## 🌐 Production Deployment

### Option A: Railway (Recommended - Free)

1. Push code to GitHub
2. Go to [railway.app](https://railway.app)
3. Click **"New Project" → "Deploy from GitHub"**
4. Select your repo
5. Set environment variables:
   ```
   PORT=3000
   NODE_ENV=production
   ```
6. Railway auto-detects Node.js and deploys ✓

### Option B: Render (Free Tier)

1. Go to [render.com](https://render.com)
2. New → Web Service → Connect GitHub
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Done ✓

### Option C: VPS (DigitalOcean/Hetzner)

```bash
# On your server:
git clone https://github.com/yourname/knox-hub.git
cd knox-hub
npm install
npm install -g pm2

# Start with PM2 (keeps running after logout)
pm2 start server/server.js --name knox-hub
pm2 save
pm2 startup

# Setup Nginx reverse proxy
sudo nano /etc/nginx/sites-available/knox-hub
```

**Nginx config:**
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/knox-hub /etc/nginx/sites-enabled/
sudo certbot --nginx -d yourdomain.com  # HTTPS
sudo systemctl reload nginx
```

---

## 🔧 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment |
| `MAX_FILE_SIZE` | `50MB` | Upload limit |

---

## 🔥 Firebase Alternative (No Backend Needed)

If you don't want to run a server, replace the WebSocket logic with Firebase:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable:
   - **Realtime Database** (for messages)
   - **Storage** (for file uploads)
   - **Authentication** (anonymous auth)
3. Replace `connectWS()` in `index.html` with Firebase SDK calls
4. Host `index.html` on **Firebase Hosting** (free)

---

## 📡 WebRTC Voice Chat

The voice chat uses **WebRTC P2P** audio:

- The backend acts as a **signaling server** (relays offer/answer/ICE candidates)
- No media goes through your server — it's P2P
- Works out of the box on localhost
- For production, add a **STUN/TURN server** for NAT traversal:

```javascript
// In index.html, update RTCPeerConnection config:
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com',
      username: 'knox',
      credential: 'yourpassword'
    }
  ]
});
```

Free TURN servers: [Metered.ca](https://www.metered.ca/tools/openrelay/) offers a free TURN service.

---

## 📦 File Uploads

Files are stored in `/uploads/` folder on the server.

**For production**, replace with cloud storage:

### AWS S3
```bash
npm install @aws-sdk/client-s3 multer-s3
```

### Firebase Storage
```bash
npm install firebase
```

Update `server.js` multer config to use your cloud storage provider.

---

## 🔒 Security Notes for Production

1. **Add authentication tokens** — replace the simple name-based admin check with JWT
2. **Rate limiting** — add `express-rate-limit` to prevent spam
3. **Input sanitization** — add `xss` package for XSS prevention
4. **HTTPS** — always use SSL in production
5. **Message limits** — the server keeps last 500 messages per room; configure to your needs

```bash
npm install express-rate-limit xss helmet
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JS |
| Backend | Node.js, Express |
| Real-time | WebSocket (ws) |
| File Upload | Multer |
| Voice | WebRTC (P2P) |
| Storage | Local disk (swap with S3/Firebase) |

---

## ✅ Feature Checklist

- [x] User registration (no password)
- [x] Persistent session via localStorage
- [x] Group A & B chat rooms (max 8 users)
- [x] Real-time WebSocket messaging
- [x] Image / Video / File uploads with preview
- [x] Admin panel (KNOX_UZ)
- [x] Leader assignment system
- [x] Warning system (0/3 → auto-ban)
- [x] Kick & ban users
- [x] Broadcast messages
- [x] Pin messages
- [x] Highlight messages (leader privilege)
- [x] Message reactions (emoji)
- [x] Reply to messages
- [x] Delete messages
- [x] Typing indicators
- [x] Online status
- [x] Direct messages
- [x] Voice chat (WebRTC)
- [x] Mute/unmute microphone
- [x] Message search
- [x] Mobile-first responsive design
- [x] Dark mode (neon blue/purple theme)
- [x] Crown badge for leaders 👑
- [x] Image lightbox viewer
