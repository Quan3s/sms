const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const multer = require('multer');
const fs = require('fs').promises; // Dùng promises để tránh block thread
const path = require('path');
const xss = require('xss'); // Thư viện chống XSS

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cấu hình Redis (Render cung cấp URL qua biến môi trường)
const client = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
client.connect().catch(console.error);

app.use(express.static('public')); // Phục vụ file tĩnh

// Cấu hình Multer: Giới hạn 5MB
const upload = multer({ 
    dest: 'uploads/', 
    limits: { fileSize: 5 * 1024 * 1024 } 
});

// API Upload File
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Không có file" });
        const fileId = req.file.filename;
        const originalName = req.file.originalname;
        
        // Lưu trữ Redis: 2 lượt tải, hết hạn sau 86400s (1 ngày)
        await client.setEx(`file:${fileId}`, 86400, "2"); 
        await client.setEx(`filename:${fileId}`, 86400, originalName);

        res.json({ link: `/download/${fileId}`, name: originalName });
    } catch (err) {
        res.status(500).json({ error: "Lỗi máy chủ" });
    }
});

// API Download File
app.get('/download/:id', async (req, res) => {
    const fileId = req.params.id;
    try {
        const remaining = await client.get(`file:${fileId}`);
        if (!remaining || parseInt(remaining) <= 0) {
            return res.status(410).send("File đã bị xóa hoặc hết lượt tải.");
        }

        const filePath = path.join(__dirname, 'uploads', fileId);
        const originalName = await client.get(`filename:${fileId}`) || fileId;

        res.download(filePath, originalName, async (err) => {
            if (!err) {
                const newVal = await client.decr(`file:${fileId}`);
                if (newVal <= 0) {
                    try {
                        await fs.unlink(filePath); // Xóa file an toàn
                        await client.del(`file:${fileId}`);
                        await client.del(`filename:${fileId}`);
                    } catch (unlinkErr) {
                        console.error("Lỗi khi xóa file vật lý:", unlinkErr);
                    }
                }
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi xử lý file.");
    }
});

// Socket.io Logic
io.on('connection', (socket) => {
    socket.on('join_room', (roomName) => {
        socket.join(roomName);
    });

    socket.on('send_message', (data) => {
        // Chống XSS bằng cách sanitize nội dung text và ID
        const safeMsg = xss(data.message);
        const safeId = xss(data.userId);
        
        const messagePayload = {
            userId: safeId,
            message: safeMsg,
            avatar: data.avatar,
            isFile: data.isFile,
            timestamp: Date.now()
        };

        // Gửi tin nhắn tới những người trong cùng room (hoặc public)
        io.to(data.room).emit('receive_message', messagePayload);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
