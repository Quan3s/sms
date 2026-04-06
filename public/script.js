const socket = io();
let myId = "";
let currentPartner = "";

// --- CANVAS MENU ANIMATION ---
const canvas = document.getElementById('menuCanvas');
const ctx = canvas.getContext('2d');
let dots = [];

function initCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    for(let i=0; i<40; i++) {
        dots.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2 + 1,
            speed: Math.random() * 0.5 + 0.2
        });
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0, 255, 204, 0.5)";
    dots.forEach(d => {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.size, 0, Math.PI*2);
        ctx.fill();
        d.y -= d.speed;
        if(d.y < 0) d.y = canvas.height;
    });
    requestAnimationFrame(animate);
}

initCanvas();
animate();

// --- AUTH LOGIC (SQL) ---
async function auth(type) {
    const userId = document.getElementById('user-id').value;
    const password = document.getElementById('pass').value;

    if(!userId || !password) return alert("Vui lòng nhập đủ!");

    const res = await fetch(`/${type}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ userId, password })
    });

    const data = await res.json();
    if(data.success) {
        if(type === 'register') return alert("Đăng ký xong, hãy đăng nhập!");
        myId = userId;
        document.getElementById('auth-box').style.display = 'none';
        document.getElementById('chat-app').style.display = 'flex';
        document.getElementById('my-id-display').innerText = `Tôi: ${myId}`;
        socket.emit('auth', myId);
    } else {
        alert(data.error);
    }
}

// --- CHAT LOGIC ---
function addFriend() {
    const friendId = document.getElementById('friend-id').value;
    if(!friendId || friendId === myId) return;
    
    // Giả lập thêm vào danh sách hiển thị
    const list = document.getElementById('friend-list');
    const div = document.createElement('div');
    div.className = 'friend-item';
    div.innerText = friendId;
    div.onclick = () => selectPartner(friendId, div);
    list.appendChild(div);
}

function selectPartner(id, el) {
    currentPartner = id;
    document.getElementById('chat-target').innerText = `Đang chat với: ${id}`;
    document.querySelectorAll('.friend-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('messages').innerHTML = ""; // Xóa màn hình chat cũ
}

function send() {
    const msg = document.getElementById('msg-input').value;
    if(!msg || !currentPartner) return;

    socket.emit('send_private', { to: currentPartner, msg });
    document.getElementById('msg-input').value = "";
}

socket.on('new_msg', (data) => {
    // Chỉ hiển thị nếu tin nhắn đó thuộc về cặp hội thoại đang mở
    if(data.sender === currentPartner || data.sender === myId) {
        const box = document.getElementById('messages');
        const div = document.createElement('div');
        div.className = `msg-row ${data.sender === myId ? 'msg-right' : 'msg-left'}`;
        div.innerText = data.content;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }
});
