let ws = null;
let username = '';

const nameScreen = document.getElementById('nameScreen');
const chatScreen = document.getElementById('chatScreen');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesList = document.getElementById('messagesList');
const currentUsernameEl = document.getElementById('currentUsername');
const onlineCountEl = document.getElementById('onlineCount');
const logoutBtn = document.getElementById('logoutBtn');
const messagesContainer = document.getElementById('messagesContainer');

joinBtn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
        alert('Enter your name!');
        return;
    }
    username = name;
    currentUsernameEl.textContent = name;
    connectWebSocket();
    nameScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
};

sendBtn.onclick = sendMessage;
messageInput.onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
};

logoutBtn.onclick = () => {
    if (ws) ws.close();
    chatScreen.classList.add('hidden');
    nameScreen.classList.remove('hidden');
    messagesList.innerHTML = '';
};

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:10000';
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        console.log('Connected');
        ws.send(JSON.stringify({
            type: 'join',
            username: username,
            timestamp: new Date().toISOString()
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
            data.messages.forEach(msg => {
                if (msg.type === 'message') addMessage(msg);
            });
        }
    };

    ws.onerror = (error) => {
        console.error('WS Error:', error);
    };

    ws.onclose = () => {
        console.log('Disconnected');
    };
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !ws) return;

    ws.send(JSON.stringify({
        type: 'message',
        text: text,
        username: username,
        timestamp: new Date().toISOString()
    }));

    messageInput.value = '';
}

function addMessage(data) {
    const div = document.createElement('div');
    div.className = 'message' + (data.username === username ? ' own' : '');
    
    const time = new Date(data.timestamp).toLocaleTimeString('ru', {hour: '2-digit', minute: '2-digit'});
    
    div.innerHTML = `
        <div class="message-header">
            <span class="message-author">${data.username}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${data.text}</div>
    `;
    
    messagesList.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addSystemMessage(text) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.innerHTML = `<div class="message-content">${text}</div>`;
    messagesList.appendChild(div);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}