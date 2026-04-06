const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const xss = require('xss');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Kết nối PostgreSQL (Lấy URL từ Render Dashboard)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static('public'));

// --- LOGIC DATABASE (Chạy 1 lần khi khởi động) ---
const initDB = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS friends (
            user_a VARCHAR(50),
            user_b VARCHAR(50),
            PRIMARY KEY (user_a, user_b)
        );
        CREATE TABLE IF NOT EXISTS chats (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(50),
            receiver VARCHAR(50),
            message TEXT,
            is_file BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
};
initDB();

// --- API ĐĂNG KÝ (MK 8-15 số) ---
app.post('/register', async (req, res) => {
    const { userId, password } = req.body;
    if (!/^\d+$/.test(password) || password.length < 8 || password.length > 15) {
        return res.status(400).json({ error: "Mật khẩu phải là 8-15 chữ số" });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [userId, hash]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "ID đã tồn tại" }); }
});

// --- API ĐĂNG NHẬP ---
app.post('/login', async (req, res) => {
    const { userId, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [userId]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        await pool.query('UPDATE users SET last_active = NOW() WHERE username = $1', [userId]);
        res.json({ success: true });
    } else res.status(401).json({ error: "Sai thông tin" });
});

// --- TỰ XÓA SAU 15 NGÀY ---
setInterval(async () => {
    await pool.query("DELETE FROM users WHERE last_active < NOW() - INTERVAL '15 days'");
    await pool.query("DELETE FROM chats WHERE created_at < NOW() - INTERVAL '1 day'");
}, 3600000);

// --- SOCKET REALTIME ---
io.on('connection', (socket) => {
    socket.on('auth', (id) => { 
        socket.join(id); 
        socket.myId = id; 
    });

    socket.on('send_private', async (data) => {
        const cleanMsg = xss(data.msg);
        await pool.query('INSERT INTO chats (sender, receiver, message) VALUES ($1, $2, $3)', 
            [socket.myId, data.to, cleanMsg]);
        io.to(data.to).to(socket.myId).emit('new_msg', { sender: socket.myId, content: cleanMsg });
    });
});

server.listen(process.env.PORT || 3000, () => console.log("Server is running..."));
