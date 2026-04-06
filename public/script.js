const token = localStorage.getItem('jwt_token');

// Vẽ Canvas cho đẹp
const ctx = document.getElementById('menuCanvas').getContext('2d');
// (Bạn có thể tái sử dụng hàm vẽ Canvas ở code cũ vào đây)

// Kiểm tra Session khi mở web
if (token) {
    document.getElementById('auth-box').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('my-name').innerText = localStorage.getItem('user_name');
    document.getElementById('my-num-id').innerText = localStorage.getItem('user_num_id');
}

// Chuyển UI Đăng nhập/Đăng ký
function showRegister() { document.getElementById('auth-box').style.display = 'none'; document.getElementById('reg-box').style.display = 'block'; }
function showLogin() { document.getElementById('reg-box').style.display = 'none'; document.getElementById('auth-box').style.display = 'block'; }

// API Đăng nhập
async function login() {
    const res = await fetch('/api/login', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
    });
    const data = await res.json();
    if(data.success) {
        localStorage.setItem('jwt_token', data.token);
        localStorage.setItem('user_name', data.user.name);
        localStorage.setItem('user_num_id', data.user.numId);
        location.reload();
    } else alert(data.error);
}

// Chuyển Tab Mobile
function switchTab(tabId, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    el.classList.add('active');
}

// Tìm kiếm bạn bè
async function searchUser() {
    const q = document.getElementById('searchInput').value;
    const res = await fetch(`/api/search?q=${q}`, { headers: { 'Authorization': `Bearer ${token}` } });
    if(res.status === 401 || res.status === 403) return logout();
    
    const users = await res.json();
    const box = document.getElementById('search-results');
    box.innerHTML = users.map(u => `
        <div class="user-item">
            <div>
                <strong>${u.display_name}</strong><br>
                <small>ID Số: ${u.numeric_id}</small>
            </div>
            <button class="btn-small" onclick="goToChat(${u.id})">Nhắn tin</button>
        </div>
    `).join('');
}

// Chuyển hướng sang trang CHAT riêng
async function goToChat(targetId) {
    const res = await fetch('/api/get-chat-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ targetId, type: 'private' })
    });
    const data = await res.json();
    if(data.link) window.location.href = data.link; // Redirect sang link ngẫu nhiên
}

function logout() { localStorage.clear(); location.reload(); }
