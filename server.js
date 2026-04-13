const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const JWT_SECRET = 'Z_CHAT_SUPER_SECRET_TOKEN';
const PORT = process.env.PORT || 3000;

// 1. KẾT NỐI DATABASE (Sử dụng DATABASE_URL từ server deploy)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/zchat',
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false // Hỗ trợ SSL cho Render/Heroku
});

// Tự động tạo bảng nếu chưa có (Tránh lỗi Runtime)
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                password TEXT NOT NULL,
                num_id TEXT UNIQUE
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                room_id TEXT,
                sender_name TEXT,
                content TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Database đã sẵn sàng.");
    } catch (err) {
        console.error("Lỗi khởi tạo DB:", err);
    }
};
initDB();

app.use(express.json());

// --- API HỆ THỐNG ---

app.post('/api/register', async (req, res) => {
    const { username, display_name, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        const numId = Math.floor(100000 + Math.random() * 900000).toString();
        await pool.query(
            'INSERT INTO users (username, display_name, password, num_id) VALUES ($1, $2, $3, $4)',
            [username, display_name, hashed, numId]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Lỗi! Tên đăng nhập có thể đã tồn tại." }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ id: user.id }, JWT_SECRET);
            res.json({ success: true, token, user: { name: user.display_name, num_id: user.num_id } });
        } else res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu!" });
    } catch (e) { res.status(500).json({ error: "Lỗi Server" }); }
});

app.get('/api/history/:room', async (req, res) => {
    const history = await pool.query('SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at ASC LIMIT 50', [req.params.room]);
    res.json(history.rows);
});

// --- PHẦN GIAO DIỆN (HTML/CSS/JS GỘP) ---

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <title>Z-Chat Ultra</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --primary: #00d2ff; --bg: #0a0a12; --glass: rgba(255, 255, 255, 0.05); }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
        body { background: var(--bg); color: white; height: 100vh; overflow: hidden; }
        
        .btn { background: var(--primary); color: #000; border: none; padding: 12px; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.3s; }
        .btn:active { transform: scale(0.95); }
        input { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 12px; border-radius: 10px; outline: none; margin-bottom: 15px; width: 100%; }
        input:focus { border-color: var(--primary); }

        /* Auth */
        #auth-screen { display: flex; align-items: center; justify-content: center; height: 100vh; padding: 20px; }
        .card { background: var(--glass); backdrop-filter: blur(20px); padding: 30px; border-radius: 25px; width: 100%; max-width: 400px; border: 1px solid rgba(255,255,255,0.1); text-align: center; }

        /* App */
        #app-screen { display: none; flex-direction: column; height: 100vh; }
        .header { height: 60px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.1); }
        .main-view { flex: 1; overflow-y: auto; padding: 20px; }

        /* Chat Room */
        #chat-view { display: none; position: fixed; inset: 0; background: var(--bg); flex-direction: column; z-index: 1000; }
        .msgs { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
        .m { max-width: 80%; padding: 10px 15px; border-radius: 15px; font-size: 15px; line-height: 1.4; }
        .m-me { align-self: flex-end; background: var(--primary); color: #000; border-bottom-right-radius: 2px; }
        .m-other { align-self: flex-start; background: rgba(255,255,255,0.1); border-bottom-left-radius: 2px; }

        .input-bar { padding: 15px; display: flex; gap: 10px; background: #161625; padding-bottom: calc(15px + env(safe-area-inset-bottom)); }
        .input-bar input { margin: 0; }

        /* Navigation */
        .bottom-nav { height: 70px; display: flex; background: #000; border-top: 1px solid #333; padding-bottom: env(safe-area-inset-bottom); }
        .nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 11px; opacity: 0.5; cursor: pointer; }
        .nav-item.active { opacity: 1; color: var(--primary); }
    </style>
</head>
<body>
    <div id="auth-screen">
        <div class="card" id="login-box">
            <h1 style="color:var(--primary); margin-bottom:10px">Z-Chat</h1>
            <p style="opacity:0.6; margin-bottom:20px">Đăng nhập để kết nối</p>
            <input type="text" id="u" placeholder="Tên đăng nhập">
            <input type="password" id="p" placeholder="Mật khẩu">
            <button class="btn" style="width:100%" onclick="auth('login')">Đăng Nhập</button>
            <p style="margin-top:20px; font-size:13px" onclick="toggleAuth(true)">Chưa có tài khoản? Đăng ký ngay</p>
        </div>
        <div class="card" id="reg-box" style="display:none">
            <h2>Tạo tài khoản</h2><br>
            <input type="text" id="ru" placeholder="Username">
            <input type="text" id="rn" placeholder="Tên hiển thị">
            <input type="password" id="rp" placeholder="Mật khẩu">
            <button class="btn" style="width:100%" onclick="auth('reg')">Xác Nhận</button>
            <p style="margin-top:20px; font-size:13px" onclick="toggleAuth(false)">Quay lại Đăng nhập</p>
        </div>
    </div>

    <div id="app-screen">
        <div class="header">
            <span id="my-name" style="font-weight:bold">Z-Chat</span>
            <span id="my-id" style="color:var(--primary); font-size:12px; border:1px solid; padding:2px 8px; border-radius:10px"></span>
        </div>
        <div class="main-view" id="main-view">
            <div id="tab-home">
                <div class="card" style="width:100%; text-align:left; padding:20px; margin-bottom:15px" onclick="joinChat('global')">
                    <h3 style="color:var(--primary)">🌍 Phòng Toàn Cầu</h3>
                    <p style="font-size:12px; opacity:0.6">Nơi mọi người trò chuyện tự do</p>
                </div>
            </div>
            <div id="tab-search" style="display:none">
                <input type="text" id="s-input" placeholder="Tìm ID số hoặc tên...">
                <div id="s-results"></div>
            </div>
        </div>
        <div class="bottom-nav">
            <div class="nav-item active" onclick="tab('home',this)">🏠<br>Trang chủ</div>
            <div class="nav-item" onclick="tab('search',this)">🔍<br>Tìm kiếm</div>
            <div class="nav-item" onclick="logout()">🚪<br>Thoát</div>
        </div>
    </div>

    <div id="chat-view">
        <div class="header">
            <button onclick="leaveChat()" style="background:none; border:none; color:white; font-size:22px">←</button>
            <span id="room-name">Phòng Chat</span>
            <div style="width:30px"></div>
        </div>
        <div class="msgs" id="msgs"></div>
        <div id="typing" style="padding:5px 20px; font-size:11px; color:var(--primary); height:20px"></div>
        <div class="input-bar">
            <input type="text" id="m" placeholder="Nhập tin nhắn..." oninput="isTyping()">
            <button class="btn" onclick="send()">Gửi</button>
        </div>
    </div>

    <script>
        const socket = io();
        let me = JSON.parse(localStorage.getItem('z_user'));
        let currentRoom = '';
        let tT;

        if(me) showApp();

        function toggleAuth(reg) {
            document.getElementById('login-box').style.display = reg ? 'none' : 'block';
            document.getElementById('reg-box').style.display = reg ? 'block' : 'none';
        }

        async function auth(type) {
            const isL = type==='login';
            const body = isL ? {username:u.value, password:p.value} : {username:ru.value, display_name:rn.value, password:rp.value};
            const res = await fetch('/api/'+(isL?'login':'register'), {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if(data.success) {
                if(isL) {
                    localStorage.setItem('z_user', JSON.stringify(data.user));
                    me = data.user;
                    showApp();
                } else { alert("Đã đăng ký! Mời đăng nhập"); toggleAuth(false); }
            } else alert(data.error);
        }

        function showApp() {
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app-screen').style.display = 'flex';
            document.getElementById('my-name').innerText = me.name;
            document.getElementById('my-id').innerText = "#" + me.num_id;
        }

        function tab(t, el) {
            document.getElementById('tab-home').style.display = t==='home'?'block':'none';
            document.getElementById('tab-search').style.display = t==='search'?'block':'none';
            document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
            el.classList.add('active');
        }

        async function joinChat(r) {
            currentRoom = r;
            document.getElementById('chat-view').style.display = 'flex';
            document.getElementById('msgs').innerHTML = 'Đang tải...';
            socket.emit('j', r);
            const res = await fetch('/api/history/'+r);
            const his = await res.json();
            document.getElementById('msgs').innerHTML = '';
            his.forEach(render);
        }

        function leaveChat() { document.getElementById('chat-view').style.display = 'none'; }

        function send() {
            if(!m.value) return;
            socket.emit('c', { r:currentRoom, s:me.name, m:m.value });
            m.value = '';
        }

        socket.on('m', render);
        socket.on('t', d => {
            if(d.u !== me.name) {
                document.getElementById('typing').innerText = d.u + " đang nhập...";
                clearTimeout(tT); tT = setTimeout(()=>document.getElementById('typing').innerText='', 2000);
            }
        });

        function render(d) {
            const dv = document.createElement('div');
            const isMe = (d.sender_name || d.s) === me.name;
            dv.className = 'm ' + (isMe ? 'm-me' : 'm-other');
            dv.innerHTML = \`<small style="font-size:9px; display:block; opacity:0.6">\${d.sender_name || d.s}</small>\${d.content || d.m}\`;
            const ms = document.getElementById('msgs');
            ms.appendChild(dv); ms.scrollTop = ms.scrollHeight;
        }

        function isTyping() { socket.emit('t', { r:currentRoom, u:me.name }); }
        function logout() { localStorage.clear(); location.reload(); }
    </script>
</body>
</html>
    `);
});

// --- LOGIC REALTIME (SOCKET.IO) ---

io.on('connection', (socket) => {
    socket.on('j', (r) => socket.join(r));

    socket.on('c', async (data) => {
        try {
            // Lưu tin nhắn vào Database để khi F5 không bị mất
            await pool.query('INSERT INTO messages (room_id, sender_name, content) VALUES ($1, $2, $3)', [data.r, data.s, data.m]);
            io.to(data.r).emit('m', data);
        } catch (e) { console.error("Lỗi socket:", e); }
    });

    socket.on('t', (data) => {
        socket.to(data.r).emit('t', data);
    });
});

server.listen(PORT, () => console.log('Server đã sẵn sàng tại port ' + PORT));
