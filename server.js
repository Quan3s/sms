const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cấu hình Database (Nhập DATABASE_URL từ Render vào Biến môi trường)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-2-hours';

app.use(express.json());
app.use(express.static('public'));

// --- KHỞI TẠO DATABASE ---
const initDB = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            numeric_id INT UNIQUE DEFAULT floor(random() * 900000 + 100000),
            username VARCHAR(50) UNIQUE NOT NULL,
            display_name VARCHAR(100),
            password VARCHAR(255) NOT NULL,
            last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS groups (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(100) NOT NULL
        );
        CREATE TABLE IF NOT EXISTS group_members (
            group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
            user_id INT REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(20) DEFAULT 'member', -- owner, admin, manager, member
            PRIMARY KEY (group_id, user_id)
        );
    `);
};
initDB();

// --- MIDDLEWARE XÁC THỰC (SESSION 2 TIẾNG) ---
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "Chưa đăng nhập!" });
    try {
        req.user = jwt.verify(token.split(' ')[1], JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ error: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại!" });
    }
};

// --- API AUTH ---
app.post('/api/register', async (req, res) => {
    const { username, password, displayName } = req.body;
    if (!/^\d+$/.test(password) || password.length < 8 || password.length > 15) {
        return res.status(400).json({ error: "Mật khẩu phải từ 8-15 số." });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, display_name) VALUES ($1, $2, $3)', 
            [username, hash, displayName || username]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "ID đã tồn tại!" }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length > 0 && await bcrypt.compare(password, result.rows[0].password)) {
        const user = result.rows[0];
        // Cấp JWT Token hạn 2 tiếng
        const token = jwt.sign({ id: user.id, username: user.username, num_id: user.numeric_id }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ success: true, token, user: { numId: user.numeric_id, name: user.display_name } });
    } else res.status(401).json({ error: "Sai thông tin!" });
});

// --- API TÍNH NĂNG ---
app.get('/api/search', verifyToken, async (req, res) => {
    const { q } = req.query;
    // Tìm theo numeric_id hoặc username
    const result = await pool.query(
        'SELECT id, numeric_id, username, display_name FROM users WHERE username ILIKE $1 OR numeric_id::text = $1 LIMIT 10', 
        [`%${q}%`]
    );
    res.json(result.rows);
});

app.post('/api/update-profile', verifyToken, async (req, res) => {
    const { newName, newPassword } = req.body;
    if(newName) await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [newName, req.user.id]);
    if(newPassword) {
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, req.user.id]);
    }
    res.json({ success: true });
});

app.post('/api/create-group', verifyToken, async (req, res) => {
    const { groupName } = req.body;
    const groupRes = await pool.query('INSERT INTO groups (name) VALUES ($1) RETURNING id', [groupName]);
    const groupId = groupRes.rows[0].id;
    // Set người tạo làm Owner
    await pool.query('INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)', [groupId, req.user.id, 'owner']);
    res.json({ success: true, groupId });
});

// Chuyển hướng chat ngẫu nhiên
app.post('/api/get-chat-link', verifyToken, (req, res) => {
    const randomRoom = 'room_' + Math.random().toString(36).substr(2, 9);
    res.json({ link: `/chat.html?room=${randomRoom}&target=${req.body.targetId}&type=${req.body.type}` });
});

// --- SOCKET.IO REALTIME ---
// Middleware Socket kiểm tra JWT
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error"));
    try {
        socket.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) { next(new Error("Token expired")); }
});

io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => { socket.join(roomId); });
    socket.on('send_message', (data) => {
        // Broadcast tin nhắn vào phòng
        io.to(data.room).emit('receive_message', {
            senderId: socket.user.num_id,
            senderName: socket.user.username,
            text: data.text
        });
    });
});

server.listen(process.env.PORT || 3000, () => console.log("Server running..."));
