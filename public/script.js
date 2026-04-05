document.addEventListener("DOMContentLoaded", () => {
    const socket = io();
    
    // --- KHỞI TẠO LOCALSTORAGE & ID ---
    let myId = localStorage.getItem('chat_userId') || `@user_${Math.floor(Math.random() * 1000)}`;
    const inputUserId = document.getElementById('userId');
    inputUserId.value = myId;
    
    // Mặc định cho tất cả vào 1 phòng chung, có thể mở rộng sau
    const currentRoom = 'global_room'; 
    socket.emit('join_room', currentRoom);

    // Lưu ID khi bấm nút
    document.getElementById('btn-save-id').addEventListener('click', () => {
        const newId = inputUserId.value.trim();
        if(newId) {
            myId = newId;
            localStorage.setItem('chat_userId', myId);
            alert(`Đã đổi tên thành: ${myId}`);
        }
    });

    // --- LOGIC XỬ LÝ CHAT & FILE ---
    const msgInput = document.getElementById('msg-input');
    const fileInput = document.getElementById('file-input');

    // Nút Gửi tin nhắn text
    document.getElementById('btn-send').addEventListener('click', () => {
        sendTextMessage();
    });

    // Nút Like (Gửi nhanh icon)
    document.getElementById('btn-like').addEventListener('click', () => {
        sendRawMessage('👍', false);
    });

    // Gửi bằng phím Enter
    msgInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendTextMessage();
    });

    function sendTextMessage() {
        const text = msgInput.value.trim();
        if (!text) return;
        sendRawMessage(text, false);
        msgInput.value = '';
    }

    function sendRawMessage(content, isFile) {
        socket.emit('send_message', {
            userId: myId,
            room: currentRoom,
            message: content,
            isFile: isFile
        });
    }

    // --- LOGIC XỬ LÝ UPLOAD FILE TẠM THỜI ---
    document.getElementById('btn-plus').addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async function() {
        const file = this.files[0];
        if (!file) return;

        // Giới hạn Client-side: 5MB
        if (file.size > 5 * 1024 * 1024) {
            alert("Lỗi: Kích thước file vượt quá 5MB!");
            this.value = ''; // Reset input
            return;
        }

        const formData = new FormData();
        formData.append("file", file);

        try {
            // Thay đổi text input thành trạng thái đang tải
            msgInput.placeholder = "Đang tải file lên...";
            msgInput.disabled = true;

            const res = await fetch('/upload', { 
                method: 'POST', 
                body: formData 
            });
            const data = await res.json();

            if (data.link) {
                // Tạo thẻ link để hiển thị
                const fileHtml = `📎 <a href="${data.link}" class="file-link" target="_blank">Tải tệp: ${data.name}</a> (Sẽ tự hủy sau 2 lần tải)`;
                sendRawMessage(fileHtml, true);
            } else {
                alert("Lỗi tải file: " + (data.error || "Không xác định"));
            }
        } catch (err) {
            alert("Không thể kết nối đến server tải file.");
        } finally {
            msgInput.placeholder = "Nhập tin nhắn (hỗ trợ ký tự đặc biệt)...";
            msgInput.disabled = false;
            this.value = ''; // Reset input
        }
    });

    // --- LẮNG NGHE TIN NHẮN TỪ SERVER ---
    socket.on('receive_message', (data) => {
        const msgsContainer = document.getElementById('messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'msg-line';
        
        // Sử dụng innerHTML vì message đã được sanitize bằng thư viện xss ở backend
        // và phần link file HTML là do chính chúng ta tạo ra.
        msgDiv.innerHTML = `<span class="msg-author">${data.userId}:</span> <span class="msg-content">${data.message}</span>`;
        
        msgsContainer.appendChild(msgDiv);
        
        // Tự động cuộn xuống cuối
        msgsContainer.scrollTop = msgsContainer.scrollHeight;
    });

    // --- CANVAS ANIMATION BACKGROUND ---
    const canvas = document.getElementById('menuCanvas');
    const ctx = canvas.getContext('2d');
    
    let width, height;
    const particles = [];

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    // Tạo các hạt matrix lơ lửng
    for(let i = 0; i < 50; i++) {
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 2 + 1,
            speed: Math.random() * 1 + 0.5
        });
    }

    function drawAnimation() {
        // Tạo hiệu ứng vệt mờ (trail effect)
        ctx.fillStyle = 'rgba(15, 15, 26, 0.2)';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#00ffcc';
        ctx.beginPath();
        
        particles.forEach(p => {
            ctx.moveTo(p.x, p.y);
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2, true);
            p.y -= p.speed; // Bay lên trên
            
            // Nếu bay ra khỏi màn hình thì reset về dưới đáy
            if (p.y < 0) {
                p.y = height;
                p.x = Math.random() * width;
            }
        });
        ctx.fill();

        requestAnimationFrame(drawAnimation);
    }
    
    drawAnimation();
});
