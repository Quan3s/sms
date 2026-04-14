const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const JWT_SECRET = process.env.JWT_SECRET || 'Z_CHAT_V8_ULTIMATE_SECRET';
const PORT = process.env.PORT || 3000;

// 1. CẤU HÌNH DATABASE (Fix lỗi SSL cho Render/Railway/Supabase)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/zchat',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Khởi tạo Database & Tự động sửa lỗi cấu trúc
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                password TEXT NOT NULL,
                num_id TEXT UNIQUE NOT NULL,
                avatar_color TEXT DEFAULT '#22d3ee',
                is_online BOOLEAN DEFAULT FALSE,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                room_id TEXT NOT NULL,
                sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                sender_name TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_room ON messages(room_id);
        `);
        console.log("✅ Hệ thống Database chuẩn hóa thành công.");
    } catch (e) { console.error("❌ Lỗi DB khởi tạo:", e.message); }
};
initDB();

app.use(express.json());

// --- API HỆ THỐNG (Đã sửa lỗi báo nhầm Đăng ký) ---

app.post('/api/auth/register', async (req, res) => {
    const { username, display_name, password } = req.body;
    if (!username || !display_name || !password) return res.status(400).json({ error: "Thiếu thông tin!" });
    
    try {
        const hashed = await bcrypt.hash(password, 10);
        const numId = Math.floor(100000 + Math.random() * 899999).toString();
        const colors = ['#f87171', '#fb923c', '#fbbf24', '#4ade80', '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        await pool.query(
            'INSERT INTO users (username, display_name, password, num_id, avatar_color) VALUES ($1, $2, $3, $4, $5)',
            [username.trim().toLowerCase(), display_name.trim(), hashed, numId, randomColor]
        );
        res.json({ success: true });
    } catch (e) {
        console.error("DEBUG REGISTER:", e.code, e.message);
        if (e.code === '23505') return res.status(400).json({ error: "Tên đăng nhập này đã tồn tại!" });
        res.status(500).json({ error: "Lỗi kết nối Database: " + e.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const r = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
        const u = r.rows[0];
        if (u && await bcrypt.compare(password, u.password)) {
            const token = jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '30d' });
            res.json({ success: true, token, user: { id: u.id, name: u.display_name, num_id: u.num_id, color: u.avatar_color } });
        } else res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/history/:room', async (req, res) => {
    const r = await pool.query('SELECT m.*, u.avatar_color FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.room_id = $1 ORDER BY m.created_at ASC LIMIT 100', [req.params.room]);
    res.json(r.rows);
});

app.get('/api/search', async (req, res) => {
    const r = await pool.query('SELECT num_id, display_name, avatar_color, is_online FROM users WHERE num_id = $1 OR display_name ILIKE $2 LIMIT 10', [req.query.q, `%${req.query.q}%`]);
    res.json(r.rows);
});

// --- GIAO DIỆN SPA (HTML/CSS/JS) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <title>Z-Chat Pro V8</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --p: #22d3ee; --s: #0ea5e9; --bg: #0f172a; --card: #1e293b; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, sans-serif; }
        body { background: var(--bg); color: #f1f5f9; height: 100vh; overflow: hidden; }
        
        .btn { background: linear-gradient(135deg, var(--p), var(--s)); color: #000; border: none; padding: 14px; border-radius: 12px; font-weight: 700; cursor: pointer; transition: 0.2s; }
        input { background: #0f172a; border: 1px solid #334155; color: white; padding: 14px; border-radius: 12px; width: 100%; margin-bottom: 12px; outline: none; font-size: 16px; }
        input:focus { border-color: var(--p); }

        .screen { display: none; height: 100vh; flex-direction: column; }
        .active { display: flex; }

        /* Auth */
        #auth-screen { align-items: center; justify-content: center; padding: 25px; background: radial-gradient(circle at top right, #1e293b, #0f172a); }
        .auth-card { background: var(--card); padding: 32px; border-radius: 28px; width: 100%; max-width: 380px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); text-align: center; }

        /* Main App */
        .header { height: 65px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; background: rgba(30, 41, 59, 0.8); backdrop-filter: blur(10px); border-bottom: 1px solid #334155; position: sticky; top: 0; z-index: 10; }
        .msg-list { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; background: #0f172a; }
        .bubble { max-width: 80%; padding: 12px 16px; border-radius: 20px; font-size: 15px; line-height: 1.5; }
        .me { align-self: flex-end; background: var(--p); color: #000; border-bottom-right-radius: 4px; }
        .other { align-self: flex-start; background: #334155; border-bottom-left-radius: 4px; }
        
        .input-bar { padding: 12px; background: #1e293b; display: flex; gap: 10px; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
        .input-bar input { margin: 0; border-radius: 25px; }
        
        .nav { height: 75px; display: flex; background: #020617; border-top: 1px solid #1e293b; padding-bottom: env(safe-area-inset-bottom); }
        .nav-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 11px; opacity: 0.5; cursor: pointer; }
        .nav-tab.on { opacity: 1; color: var(--p); font-weight: bold; }

        .list-item { background: var(--card); margin: 10px 15px; padding: 16px; border-radius: 18px; display: flex; align-items: center; gap: 15px; cursor: pointer; transition: 0.2s; }
        .avatar { width: 48px; height: 48px; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #000; font-size: 20px; flex-shrink: 0; position: relative; }
        .online-dot { width: 12px; height: 12px; border-radius: 50%; background: #22c55e; border: 2px solid var(--card); position: absolute; bottom: -2px; right: -2px; display: none; }
        .online-dot.on { display: block; }
    </style>
</head>
<body>

    <div id="auth-screen" class="screen active">
        <div class="auth-card">
            <h1 style="color:var(--p); font-size:36px; margin-bottom:10px">Z-Chat</h1>
            <p style="opacity:0.5; margin-bottom:30px">Kết nối chuyên nghiệp V8</p>
            <div id="l-box">
                <input id="u" placeholder="Username">
                <input id="p" type="password" placeholder="Mật khẩu">
                <button class="btn" style="width:100%" onclick="handleAuth('login')">Đăng nhập</button>
                <p style="margin-top:20px; font-size:14px; opacity:0.7" onclick="toggleAuth(true)">Chưa có tài khoản? <b>Đăng ký</b></p>
            </div>
            <div id="r-box" style="display:none">
                <input id="ru" placeholder="Username">
                <input id="rn" placeholder="Tên hiển thị">
                <input id="rp" type="password" placeholder="Mật khẩu">
                <button class="btn" style="width:100%" onclick="handleAuth('register')">Đăng ký ngay</button>
                <p style="margin-top:20px; font-size:14px; opacity:0.7" onclick="toggleAuth(false)">Quay lại <b>Đăng nhập</b></p>
            </div>
        </div>
    </div>

    <div id="app-screen" class="screen">
        <div class="header">
            <b style="font-size:20px; letter-spacing:-1px">Z-CHAT</b>
            <div id="my-profile" style="background:#334155; padding:6px 14px; border-radius:20px; font-size:12px; display:flex; gap:8px">
                <span id="me-n"></span> <b id="me-i" style="color:var(--p)"></b>
            </div>
        </div>
        <div id="tab-home" style="flex:1; overflow-y:auto">
            <div style="padding:15px 20px 5px; font-size:12px; font-weight:bold; opacity:0.4">CỘNG ĐỒNG</div>
            <div class="list-item" onclick="goRoom('global', 'Phòng Thế Giới')">
                <div class="avatar" style="background:var(--p)">🌍</div>
                <div><b>Phòng Toàn Cầu</b><br><small style="opacity:0.5">Chào mừng mọi người...</small></div>
            </div>
            <div style="padding:20px 20px 5px; font-size:12px; font-weight:bold; opacity:0.4">HỘI THOẠI RIÊNG</div>
            <div id="chat-list"></div>
        </div>
        <div id="tab-search" style="flex:1; display:none; padding:15px">
            <input id="sq" placeholder="Tìm #ID hoặc tên..." oninput="search()">
            <div id="search-results"></div>
        </div>
        <div class="nav">
            <div class="nav-tab on" id="nh" onclick="switchT('home', this)">💬<br>Chat</div>
            <div class="nav-tab" id="ns" onclick="switchT('search', this)">🔍<br>Tìm kiếm</div>
            <div class="nav-tab" onclick="logout()">🚪<br>Thoát</div>
        </div>
    </div>

    <div id="chat-view" class="screen" style="position:fixed; inset:0; z-index:1000; background:var(--bg); display:none">
        <div class="header">
            <button onclick="back()" style="background:none; border:none; color:white; font-size:26px">✕</button>
            <b id="chat-title">Phòng Chat</b>
            <div style="width:30px"></div>
        </div>
        <div class="msg-list" id="ml"></div>
        <div id="typing" style="padding:5px 20px; font-size:11px; color:var(--p); height:20px"></div>
        <div class="input-bar">
            <input id="mi" placeholder="Nhập tin nhắn..." autocomplete="off" oninput="isT()">
            <button class="btn" style="padding:0 20px" onclick="send()">Gửi</button>
        </div>
    </div>

    <script>
        const socket = io();
        let me = JSON.parse(localStorage.getItem('z_pro_v8_user'));
        let cr = '';

        if(me) start();

        function toggleAuth(reg) {
            document.getElementById('l-box').style.display = reg ? 'none' : 'block';
            document.getElementById('r-box').style.display = reg ? 'block' : 'none';
        }

        async function handleAuth(type) {
            const isL = type==='login';
            const b = isL ? {username:u.value, password:p.value} : {username:ru.value, display_name:rn.value, password:rp.value};
            
            try {
                const res = await fetch('/api/auth/'+type, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify(b)
                });
                const d = await res.json();
                if(d.success) {
                    if(isL) { localStorage.setItem('z_pro_v8_user', JSON.stringify(d.user)); me=d.user; start(); }
                    else { alert("Đăng ký thành công! Mời đăng nhập"); toggleAuth(false); }
                } else alert("Lỗi: " + d.error);
            } catch(e) { alert("Lỗi kết nối server!"); }
        }

        function start() {
            document.getElementById('auth-screen').classList.remove('active');
            document.getElementById('app-screen').classList.add('active');
            document.getElementById('me-n').innerText = me.name;
            document.getElementById('me-i').innerText = "#" + me.num_id;
            socket.emit('online', me.id);
        }

        function switchT(t, el) {
            document.getElementById('tab-home').style.display = t==='home'?'block':'none';
            document.getElementById('tab-search').style.display = t==='search'?'block':'none';
            document.querySelectorAll('.nav-tab').forEach(n=>n.classList.remove('on'));
            el.classList.add('on');
        }

        async function goRoom(r, t) {
            cr = r; document.getElementById('chat-title').innerText = t;
            document.getElementById('chat-view').style.display = 'flex';
            document.getElementById('ml').innerHTML = '<p style="text-align:center; opacity:0.2; margin-top:20px">Đang tải...</p>';
            socket.emit('join', r);
            const res = await fetch('/api/history/'+r);
            const his = await res.json();
            document.getElementById('ml').innerHTML = '';
            his.forEach(render);
        }

        function back() { document.getElementById('chat-view').style.display = 'none'; cr = ''; }

        function send() {
            if(!mi.value.trim()) return;
            socket.emit('msg', { r:cr, s_id:me.id, s_name:me.name, m:mi.value });
            mi.value = '';
        }

        socket.on('msg', d => { if(d.r === cr) render(d); });

        function render(d) {
            const isMe = (d.sender_id || d.s_id) === me.id;
            const dv = document.createElement('div');
            dv.className = 'bubble ' + (isMe?'me':'other');
            dv.style.alignSelf = isMe?'flex-end':'flex-start';
            dv.innerHTML = (!isMe?('<small style="display:block; font-size:10px; opacity:0.5; margin-bottom:4px">'+(d.sender_name||d.s_name)+'</small>'):'') + (d.content || d.m);
            const l = document.getElementById('ml');
            l.appendChild(dv); l.scrollTop = l.scrollHeight;
        }

        async function search() {
            if(sq.value.length < 2) return;
            const res = await fetch('/api/search?q='+sq.value);
            const us = await res.json();
            document.getElementById('search-results').innerHTML = us.map(u => \`
                <div class="list-item" onclick="goPrivate('\${u.num_id}', '\${u.display_name}')">
                    <div class="avatar" style="background:\${u.avatar_color}">\${u.display_name[0]}<div class="online-dot \${u.is_online?'on':''}"></div></div>
                    <div><b>\${u.display_name}</b><br><small style="opacity:0.5">#\${u.num_id}</small></div>
                </div>
            \`).join('');
        }

        function goPrivate(id, name) {
            const r = [me.num_id, id].sort().join('_');
            goRoom(r, name);
        }

        function isT() { socket.emit('typing', { r:cr, u:me.name }); }
        socket.on('typing', d => {
            if(d.r === cr && d.u !== me.name) {
                document.getElementById('typing').innerText = d.u + " đang nhập...";
                clearTimeout(window.tT); window.tT = setTimeout(()=>document.getElementById('typing').innerText='', 2000);
            }
        });

        document.getElementById('mi').addEventListener('keypress', e => { if(e.key==='Enter') send(); });
        function logout() { localStorage.clear(); location.reload(); }
    </script>
</body>
</html>
    `);
});

// --- REALTIME LOGIC (SOCKET.IO) ---
io.on('connection', (socket) => {
    socket.on('online', async (uid) => {
        socket.userId = uid;
        await pool.query('UPDATE users SET is_online = TRUE WHERE id = $1', [uid]);
    });

    socket.on('join', (r) => socket.join(r));

    socket.on('msg', async (d) => {
        try {
            await pool.query('INSERT INTO messages (room_id, sender_id, sender_name, content) VALUES ($1, $2, $3, $4)', [d.r, d.s_id, d.s_name, d.m]);
            io.to(d.r).emit('msg', d);
        } catch (e) { console.error("Lỗi socket:", e.message); }
    });

    socket.on('typing', (d) => socket.to(d.r).emit('typing', d));

    socket.on('disconnect', async () => {
        if (socket.userId) await pool.query('UPDATE users SET is_online = FALSE WHERE id = $1', [socket.userId]);
    });
});

server.listen(PORT, () => console.log('🚀 Z-Chat Pro V8 đã sẵn sàng trên cổng ' + PORT));
