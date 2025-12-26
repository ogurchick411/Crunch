let ws = null;
let token = null;
let username = '';
let userId = null;
let currentTheme = localStorage.getItem('crunch_theme') || 'dark';
let typingTimer = null;
let isTyping = false;
let selectedMessage = null;

const authScreen = document.getElementById('authScreen');
const chatScreen = document.getElementById('chatScreen');
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginBtn = document.getElementById('loginBtn');
const registerUsername = document.getElementById('registerUsername');
const registerPassword = document.getElementById('registerPassword');
const registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
const registerBtn = document.getElementById('registerBtn');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesList = document.getElementById('messagesList');
const currentUsernameEl = document.getElementById('currentUsername');
const onlineCountEl = document.getElementById('onlineCount');
const logoutBtn = document.getElementById('logoutBtn');
const messagesContainer = document.getElementById('messagesContainer');
const typingIndicator = document.getElementById('typingIndicator');
const searchBtn = document.getElementById('searchBtn');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const closeSearch = document.getElementById('closeSearch');
const themeBtn = document.getElementById('themeBtn');
const contextMenu = document.getElementById('contextMenu');
const editMsgBtn = document.getElementById('editMsg');
const deleteMsgBtn = document.getElementById('deleteMsg');

let editingMessageId = null;

document.body.className = currentTheme + '-theme';

loginTab.onclick = () => {
    loginTab.classList.add('active');
    registerTab.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
};

registerTab.onclick = () => {
    registerTab.classList.add('active');
    loginTab.classList.remove('active');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
};

loginBtn.onclick = async () => {
    const user = loginUsername.value.trim();
    const pass = loginPassword.value;
    
    if (!user || !pass) {
        showNotification('Fill all fields', 'error');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });

        const data = await response.json();

        if (!response.ok) {
            showNotification(data.error, 'error');
            return;
        }

        token = data.token;
        username = data.username;
        userId = data.userId;
        localStorage.setItem('crunch_token', token);
        
        showChat();
    } catch (error) {
        showNotification('Login failed', 'error');
    }
};

registerBtn.onclick = async () => {
    const user = registerUsername.value.trim();
    const pass = registerPassword.value;
    const passConfirm = registerPasswordConfirm.value;
    
    if (!user || !pass || !passConfirm) {
        showNotification('Fill all fields', 'error');
        return;
    }

    if (pass !== passConfirm) {
        showNotification('Passwords do not match', 'error');
        return;
    }

    if (pass.length < 6) {
        showNotification('Password min 6 characters', 'error');
        return;
    }

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });

        const data = await response.json();

        if (!response.ok) {
            showNotification(data.error, 'error');
            return;
        }

        token = data.token;
        username = data.username;
        userId = data.userId;
        localStorage.setItem('crunch_token', token);
        
        showChat();
    } catch (error) {
        showNotification('Registration failed', 'error');
    }
};

loginUsername.onkeypress = loginPassword.onkeypress = (e) => {
    if (e.key === 'Enter') loginBtn.click();
};

registerUsername.onkeypress = registerPassword.onkeypress = registerPasswordConfirm.onkeypress = (e) => {
    if (e.key === 'Enter') registerBtn.click();
};

sendBtn.onclick = sendMessage;
messageInput.onkeypress = (e) => {
    if (e.key === 'Enter' && !editingMessageId) sendMessage();
    if (e.key === 'Enter' && editingMessageId) editMessage();
};

messageInput.oninput = () => {
    handleTyping();
};

logoutBtn.onclick = () => {
    localStorage.removeItem('crunch_token');
    if (ws) ws.close();
    chatScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    messagesList.innerHTML = '';
    token = null;
    username = '';
    userId = null;
};

searchBtn.onclick = () => {
    searchBar.classList.toggle('hidden');
    if (!searchBar.classList.contains('hidden')) {
        searchInput.focus();
    } else {
        searchInput.value = '';
        clearSearch();
    }
};

closeSearch.onclick = () => {
    searchBar.classList.add('hidden');
    searchInput.value = '';
    clearSearch();
};

searchInput.oninput = () => {
    const query = searchInput.value.toLowerCase();
    const messages = document.querySelectorAll('.message:not(.system)');
    
    messages.forEach(msg => {
        const text = msg.querySelector('.message-content').textContent.toLowerCase();
        if (query && !text.includes(query)) {
            msg.style.opacity = '0.3';
        } else {
            msg.style.opacity = '1';
        }
    });
};

themeBtn.onclick = () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.className = currentTheme + '-theme';
    localStorage.setItem('crunch_theme', currentTheme);
};

document.onclick = (e) => {
    if (!contextMenu.contains(e.target)) {
        contextMenu.classList.add('hidden');
    }
};

editMsgBtn.onclick = () => {
    if (!selectedMessage) return;
    
    const content = selectedMessage.querySelector('.message-content');
    const text = content.textContent;
    
    if (content.querySelector('.edited-label')) {
        const editedLabel = content.querySelector('.edited-label');
        text = text.replace(editedLabel.textContent, '').trim();
    }
    
    messageInput.value = text;
    editingMessageId = selectedMessage.dataset.id;
    messageInput.focus();
    messageInput.placeholder = 'Edit message...';
    contextMenu.classList.add('hidden');
};

deleteMsgBtn.onclick = () => {
    if (!selectedMessage) return;
    
    if (confirm('Delete this message?')) {
        ws.send(JSON.stringify({
            type: 'delete',
            messageId: parseInt(selectedMessage.dataset.id)
        }));
    }
    
    contextMenu.classList.add('hidden');
};

async function checkAuth() {
    const savedToken = localStorage.getItem('crunch_token');
    
    if (!savedToken) return;

    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: savedToken })
        });

        const data = await response.json();

        if (response.ok && data.valid) {
            token = savedToken;
            username = data.username;
            userId = data.userId;
            showChat();
        } else {
            localStorage.removeItem('crunch_token');
        }
    } catch (error) {
        localStorage.removeItem('crunch_token');
    }
}

function showChat() {
    currentUsernameEl.textContent = username;
    authScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    connectWebSocket();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:10000';
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        console.log('Connected');
        ws.send(JSON.stringify({
            type: 'auth',
            token: token
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'message') {
            addMessage(data);
        } else if (data.type === 'userJoined') {
            addSystemMessage(`${data.username} joined`);
            onlineCountEl.textContent = data.onlineCount + ' online';
        } else if (data.type === 'userLeft') {
            addSystemMessage(`${data.username} left`);
            onlineCountEl.textContent = data.onlineCount + ' online';
        } else if (data.type === 'history') {
            data.messages.forEach(msg => addMessage(msg));
        } else if (data.type === 'typing') {
            handleTypingIndicator(data.users);
        } else if (data.type === 'messageEdited') {
            updateMessage(data);
        } else if (data.type === 'messageDeleted') {
            removeMessage(data.messageId);
        } else if (data.type === 'error') {
            showNotification(data.message, 'error');
        }
    };

    ws.onerror = (error) => {
        console.error('WS Error:', error);
    };

    ws.onclose = () => {
        console.log('Disconnected');
        setTimeout(() => {
            if (token) connectWebSocket();
        }, 3000);
    };
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !ws) return;

    ws.send(JSON.stringify({
        type: 'message',
        text: text
    }));

    messageInput.value = '';
    stopTyping();
}

function editMessage() {
    const text = messageInput.value.trim();
    if (!text || !editingMessageId) return;

    ws.send(JSON.stringify({
        type: 'edit',
        messageId: editingMessageId,
        text: text
    }));

    messageInput.value = '';
    messageInput.placeholder = 'Type a message...';
    editingMessageId = null;
}

function addMessage(data) {
    const existing = document.querySelector(`[data-id="${data.id}"]`);
    if (existing) return;

    const div = document.createElement('div');
    div.className = 'message' + (data.username === username ? ' own' : '');
    div.dataset.id = data.id;
    div.dataset.userId = data.userId;
    
    const time = new Date(data.timestamp).toLocaleTimeString('en', {hour: '2-digit', minute: '2-digit'});
    
    const editedLabel = data.edited ? '<span class="edited-label">(edited)</span>' : '';
    
    div.innerHTML = `
        <div class="message-header">
            <span class="message-author">${escapeHtml(data.username)}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${escapeHtml(data.text)} ${editedLabel}</div>
    `;

    if (data.userId === userId) {
        div.oncontextmenu = (e) => {
            e.preventDefault();
            selectedMessage = div;
            contextMenu.style.left = e.pageX + 'px';
            contextMenu.style.top = e.pageY + 'px';
            contextMenu.classList.remove('hidden');
        };
    }
    
    messagesList.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateMessage(data) {
    const msg = document.querySelector(`[data-id="${data.messageId}"]`);
    if (!msg) return;

    const content = msg.querySelector('.message-content');
    content.innerHTML = escapeHtml(data.text) + ' <span class="edited-label">(edited)</span>';
}

function removeMessage(messageId) {
    const msg = document.querySelector(`[data-id="${messageId}"]`);
    if (msg) {
        msg.style.animation = 'messageOut 0.3s ease';
        setTimeout(() => msg.remove(), 300);
    }
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
    messagesList.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function handleTyping() {
    if (!ws) return;

    clearTimeout(typingTimer);

    if (!isTyping) {
        isTyping = true;
        ws.send(JSON.stringify({
            type: 'typing',
            isTyping: true
        }));
    }

    typingTimer = setTimeout(() => {
        stopTyping();
    }, 1000);
}

function stopTyping() {
    if (isTyping && ws) {
        isTyping = false;
        ws.send(JSON.stringify({
            type: 'typing',
            isTyping: false
        }));
    }
}

function handleTypingIndicator(users) {
    const typingText = typingIndicator.querySelector('.typing-text');
    const filtered = users.filter(u => u !== username);
    
    if (filtered.length > 0) {
        const text = filtered.length === 1 
            ? `${filtered[0]} is typing...`
            : `${filtered.slice(0, 2).join(', ')} are typing...`;
        typingText.textContent = text;
        typingIndicator.classList.remove('hidden');
    } else {
        typingIndicator.classList.add('hidden');
    }
}

function clearSearch() {
    const messages = document.querySelectorAll('.message');
    messages.forEach(msg => {
        msg.style.opacity = '1';
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type}`;
    notification.classList.remove('hidden');
    
    setTimeout(() => {
        notification.classList.add('hidden');
    }, 3000);
}

checkAuth();