const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const JWT_SECRET = process.env.JWT_SECRET || 'Z_INFINITY_SECRET_KEY_2024';
const PORT = process.env.PORT || 3000;

// 1. DATABASE SETUP
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/zchat',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

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
        console.log("✅ Database Ready!");
    } catch (e) { console.error(e); }
};
initDB();

app.use(express.json());

// 2. API ROUTES
app.post('/api/auth/register', async (req, res) => {
    const { username, display_name, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        const numId = Math.floor(100000 + Math.random() * 899999).toString();
        await pool.query(
            'INSERT INTO users (username, display_name, password, num_id) VALUES ($1, $2, $3, $4)',
            [username, display_name, hashed, numId]
        );
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Tên đăng nhập đã tồn tại!" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const u = r.rows[0];
    if (u && await bcrypt.compare(password, u.password)) {
        const token = jwt.sign({ id: u.id }, JWT_SECRET);
        res.json({ success: true, token, user: { id: u.id, name: u.display_name, num_id: u.num_id, color: u.avatar_color } });
    } else res.status(401).json({ error: "Sai thông tin!" });
});

app.get('/api/search', async (req, res) => {
    const r = await pool.query('SELECT num_id, display_name, avatar_color, is_online FROM users WHERE num_id = $1 OR display_name ILIKE $2 LIMIT 10', [req.query.q, `%${req.query.q}%`]);
    res.json(r.rows);
});

app.get('/api/history/:room', async (req, res) => {
    const r = await pool.query('SELECT m.*, u.avatar_color FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.room_id = $1 ORDER BY m.created_at ASC LIMIT 100', [req.params.room]);
    res.json(r.rows);
});

// 3. FRONTEND UI
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <title>Z-Chat Infinity</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --p: #00f2fe; --s: #4facfe; --bg: #0a0f1e; --card: #161b2e; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, sans-serif; }
        body { background: var(--bg); color: #fff; height: 100vh; overflow: hidden; }
        .btn { background: linear-gradient(135deg, var(--p), var(--s)); color: #000; border: none; padding: 14px; border-radius: 12px; font-weight: 700; cursor: pointer; transition: 0.2s; }
        input { background: #1e253c; border: 1px solid #2d3655; color: white; padding: 14px; border-radius: 12px; width: 100%; margin-bottom: 12px; outline: none; }
        input:focus { border-color: var(--p); }

        .screen { display: none; height: 100vh; flex-direction: column; }
        .active { display: flex; }

        /* UI Chat */
        .header { height: 60px; padding: 0 15px; display: flex; align-items: center; justify-content: space-between; background: rgba(22, 27, 46, 0.9); border-bottom: 1px solid #2d3655; backdrop-filter: blur(10px); }
        .msg-list { flex: 1; overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 12px; background-image: radial-gradient(#1e253c 1px, transparent 1px); background-size: 20px 20px; }
        .bubble { max-width: 80%; padding: 10px 14px; border-radius: 18px; font-size: 15px; line-height: 1.4; word-wrap: break-word; }
        .me { align-self: flex-end; background: var(--s); color: #000; border-bottom-right-radius: 2px; }
        .other { align-self: flex-start; background: var(--card); border-bottom-left-radius: 2px; }
        .img-msg { max-width: 100%; border-radius: 10px; margin-top: 5px; }

        .item { background: var(--card); padding: 15px; border-radius: 16px; margin: 10px 15px; display: flex; align-items: center; gap: 12px; cursor: pointer; transition: 0.2s; border: 1px solid transparent; }
        .item:active { background: #232a45; }
        .dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--bg); position: absolute; bottom: 0; right: 0; background: #94a3b8; }
        .dot.on { background: #22c55e; box-shadow: 0 0 10px #22c55e; }
        .avt { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #000; position: relative; flex-shrink: 0; }
        
        .nav { height: 75px; display: flex; background: #070b16; border-top: 1px solid #2d3655; padding-bottom: env(safe-area-inset-bottom); }
        .tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 11px; opacity: 0.4; transition: 0.3s; }
        .tab.on { opacity: 1; color: var(--p); }
        .input-bar { padding: 10px 15px; background: #161b2e; display: flex; gap: 10px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); }
        .input-bar input { margin: 0; border-radius: 25px; }
    </style>
</head>
<body>
    <!-- AUTH SCREEN -->
    <div id="auth" class="screen active" style="justify-content:center; padding:30px;">
        <div style="background:var(--card); padding:35px; border-radius:30px; border:1px solid #2d3655; text-align:center; box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
            <h1 style="color:var(--p); font-size:40px; margin-bottom:10px; letter-spacing:-1px">Z-CHAT</h1>
            <p style="opacity:0.5; margin-bottom:30px">Infinity Edition V7</p>
            <div id="l-box">
                <input id="u" placeholder="Tên đăng nhập">
                <input id="p" type="password" placeholder="Mật khẩu">
                <button class="btn" style="width:100%" onclick="auth('login')">Đăng Nhập</button>
                <p style="margin-top:20px; font-size:14px; opacity:0.6" onclick="toggleA(1)">Chưa có tài khoản? <b>Đăng ký</b></p>
            </div>
            <div id="r-box" style="display:none">
                <input id="ru" placeholder="Username">
                <input id="rn" placeholder="Tên hiển thị">
                <input id="rp" type="password" placeholder="Mật khẩu">
                <button class="btn" style="width:100%" onclick="auth('register')">Đăng Ký</button>
                <p style="margin-top:20px; font-size:14px; opacity:0.6" onclick="toggleA(0)">Quay lại <b>Đăng nhập</b></p>
            </div>
        </div>
    </div>

    <!-- MAIN APP -->
    <div id="app" class="screen">
        <div class="header">
            <b style="font-size:20px">Z-CHAT</b>
            <div id="my-chip" style="background:#2d3655; padding:6px 15px; border-radius:20px; font-size:12px; display:flex; gap:8px">
                <span id="mn"></span> <span style="color:var(--p)" id="mi"></span>
            </div>
        </div>
        <div id="tab-h" style="flex:1; overflow-y:auto;">
            <div class="item" onclick="go('global','Cộng Đồng')">
                <div class="avt" style="background:var(--p)">🌍</div>
                <div style="flex:1"><b>Phòng Toàn Cầu</b><br><small style="opacity:0.5">Mọi người cùng chat...</small></div>
            </div>
            <div style="padding:15px 20px 5px; font-size:12px; opacity:0.4; font-weight:bold">HỘI THOẠI</div>
            <div id="recent"></div>
        </div>
        <div id="tab-s" style="flex:1; display:none; padding:15px;">
            <input id="sq" placeholder="Tìm ID số hoặc Tên..." oninput="search()">
            <div id="sr"></div>
        </div>
        <div class="nav">
            <div class="tab on" id="nh" onclick="tab('h')">💬<br>Trò chuyện</div>
            <div class="tab" id="ns" onclick="tab('s')">🔍<br>Tìm kiếm</div>
            <div class="tab" onclick="logout()">🚪<br>Thoát</div>
        </div>
    </div>

    <!-- CHAT VIEW -->
    <div id="chat" class="screen" style="position:fixed; inset:0; z-index:1000; background:var(--bg)">
        <div class="header">
            <button onclick="back()" style="background:none; border:none; color:white; font-size:24px">✕</button>
            <b id="ct"></b>
            <div id="online-st" style="width:10px; height:10px; border-radius:50%; background:#94a3b8"></div>
        </div>
        <div class="msg-list" id="ml"></div>
        <div id="ty" style="padding:5px 20px; font-size:11px; color:var(--p); height:20px"></div>
        <div class="input-bar">
            <input id="mi-input" placeholder="Nhập tin nhắn..." autocomplete="off" oninput="isT()">
            <button class="btn" style="padding:0 20px" onclick="send()">Gửi</button>
        </div>
    </div>

    <script>
        const socket = io();
        let me = JSON.parse(localStorage.getItem('z_infinity_user'));
        let cr = '';

        if(me) start();

        function toggleA(r){ document.getElementById('l-box').style.display=r?'none':'block'; document.getElementById('r-box').style.display=r?'block':'none'; }

        async function auth(t){
            const l=t==='login';
            const b = l ? {username:u.value, password:p.value} : {username:ru.value, display_name:rn.value, password:rp.value};
            const res = await fetch('/api/auth/'+t, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b)});
            const d = await res.json();
            if(d.success){
                if(l){ localStorage.setItem('z_infinity_user', JSON.stringify(d.user)); me=d.user; start(); }
                else { alert("Xong! Đăng nhập đi bạn"); toggleA(0); }
            } else alert(d.error);
        }

        function start(){
            document.getElementById('auth').classList.remove('active');
            document.getElementById('app').classList.add('active');
            document.getElementById('mn').innerText = me.name;
            document.getElementById('mi').innerText = "#"+me.num_id;
            socket.emit('online', me.id);
        }

        function tab(t){
            document.getElementById('tab-h').style.display = t==='h'?'block':'none';
            document.getElementById('tab-s').style.display = t==='s'?'block':'none';
            document.getElementById('nh').classList.toggle('on', t==='h');
            document.getElementById('ns').classList.toggle('on', t==='s');
        }

        async function go(r, t){
            cr = r; document.getElementById('ct').innerText = t;
            document.getElementById('chat').classList.add('active');
            document.getElementById('ml').innerHTML = '';
            socket.emit('join', r);
            const res = await fetch('/api/history/'+r);
            const his = await res.json();
            his.forEach(render);
        }

        function back(){ document.getElementById('chat').classList.remove('active'); cr=''; }

        function send(){
            const m = document.getElementById('mi-input').value.trim();
            if(!m) return;
            socket.emit('msg', { r:cr, s_id:me.id, s_name:me.name, m });
            document.getElementById('mi-input').value = '';
        }

        socket.on('msg', d => { if(d.r === cr) render(d); });

        function render(d){
            const isMe = (d.sender_id || d.s_id) === me.id;
            const dv = document.createElement('div');
            dv.className = 'bubble ' + (isMe?'me':'other');
            dv.style.alignSelf = isMe?'flex-end':'flex-start';
            
            let content = d.content || d.m;
            // Nhận diện Link ảnh
            if(content.match(/\\.(jpeg|jpg|gif|png)$/) != null || content.startsWith('http')){
               if(content.match(/\\.(jpeg|jpg|gif|png)$/) != null) content = \`<img src="\${content}" class="img-msg" />\`;
               else content = \`<a href="\${content}" target="_blank" style="color:inherit">\${content}</a>\`;
            }

            dv.innerHTML = \`<small style="display:block; font-size:10px; opacity:0.5; margin-bottom:3px">\${isMe?'':(d.sender_name||d.s_name)}</small>\` + content;
            const l = document.getElementById('ml');
            l.appendChild(dv); l.scrollTop = l.scrollHeight;
        }

        async function search(){
            if(sq.value.length < 2) return;
            const res = await fetch('/api/search?q='+sq.value);
            const us = await res.json();
            document.getElementById('sr').innerHTML = us.map(u => \`
                <div class="item" onclick="goP('\${u.num_id}','\${u.display_name}')">
                    <div class="avt" style="background:\${u.avatar_color}">\${u.display_name[0]}<div class="dot \${u.is_online?'on':''}"></div></div>
                    <div><b>\${u.display_name}</b><br><small style="opacity:0.5">#\${u.num_id}</small></div>
                </div>
            \`).join('');
        }

        function goP(id, name){
            const r = [me.num_id, id].sort().join('_');
            go(r, name);
        }

        function isT(){ socket.emit('typing', {r:cr, u:me.name}); }
        socket.on('typing', d => {
            if(d.r === cr && d.u !== me.name){
                document.getElementById('ty').innerText = d.u + " đang nhập...";
                clearTimeout(window.tyT); window.tyT = setTimeout(()=>document.getElementById('ty').innerText='', 2000);
            }
        });

        document.getElementById('mi-input').addEventListener('keypress', e => { if(e.key==='Enter') send(); });
        function logout(){ localStorage.clear(); location.reload(); }
    </script>
</body>
</html>
    `);
});

// 4. SERVER ENGINE
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
        } catch (e) { console.error(e); }
    });

    socket.on('typing', (d) => socket.to(d.r).emit('typing', d));

    socket.on('disconnect', async () => {
        if (socket.userId) {
            await pool.query('UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE id = $1', [socket.userId]);
        }
    });
});

server.listen(PORT, () => console.log('🚀 Z-Chat V7 Infinity Online on port ' + PORT));
